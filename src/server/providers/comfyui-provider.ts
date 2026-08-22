import {
    getAllWorkflowTemplates,
    getWorkflowTemplateById,
    type WorkflowTemplateRecord,
} from '../comfy-workflow-model.js';
import {
    checkComfyWorkflowCompatibility,
    createSafeHttpTarget,
    downloadSafeHttpUrl,
    normalizeComfyUiBaseUrl,
    requestSafeHttpUrl,
    validateSafeHttpTarget,
    type ComfyDnsResolver,
    type SafeHttpTarget,
} from '../comfyui-connection.js';
import {
    parseWorkflowTemplateDocument,
    type ComfyApiWorkflow,
} from '../comfy-workflow-template.js';
import {
    renderWorkflowTemplate,
    renderWorkflowWithValues,
} from '../comfy-workflow-renderer.js';
import { uploadComfyImage } from '../comfyui-images.js';
import { getTaskByIdIncludingDeleted } from '../task-model.js';
import type {
    CreateTaskParams,
    CreateTaskResult,
    ModelInfo,
    ProviderTaskContext,
    ProviderSettingSchema,
    TaskStatusResult,
    VideoProvider,
} from '../provider.js';

interface ComfyTaskSnapshot {
    comfyuiBaseUrl: string;
    workflow: ComfyApiWorkflow;
    primaryOutput: { nodeId: string; field: string; index: number };
    comfyuiSafeTarget?: SafeHttpTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function taskSnapshot(extra: Record<string, unknown> | undefined): ComfyTaskSnapshot {
    if (!extra || typeof extra.comfyuiBaseUrl !== 'string' || !isRecord(extra.workflow)) {
        throw new Error('ComfyUI 任务快照不完整');
    }
    const output = extra.primaryOutput;
    if (
        !isRecord(output)
        || typeof output.nodeId !== 'string'
        || typeof output.field !== 'string'
        || !Number.isInteger(output.index)
        || (output.index as number) < 0
    ) {
        throw new Error('ComfyUI 任务快照缺少有效主输出声明');
    }
    return {
        comfyuiBaseUrl: normalizeComfyUiBaseUrl(extra.comfyuiBaseUrl),
        workflow: extra.workflow as ComfyApiWorkflow,
        primaryOutput: output as ComfyTaskSnapshot['primaryOutput'],
        comfyuiSafeTarget: isRecord(extra.comfyuiSafeTarget)
            ? extra.comfyuiSafeTarget as unknown as SafeHttpTarget
            : undefined,
    };
}

function parseJsonBody(body: Buffer, label: string): Record<string, unknown> {
    let value: unknown;
    try {
        value = JSON.parse(body.toString('utf8'));
    } catch {
        throw new Error(`${label}返回了无效 JSON`);
    }
    if (!isRecord(value)) throw new Error(`${label}返回了无效数据`);
    return value;
}

function nodeValidationErrors(value: unknown): string[] {
    if (!isRecord(value)) return [];
    const messages: string[] = [];
    for (const [nodeId, nodeValue] of Object.entries(value)) {
        if (!isRecord(nodeValue) || !Array.isArray(nodeValue.errors)) continue;
        const errors = nodeValue.errors.flatMap((entry) => {
            if (!isRecord(entry) || typeof entry.message !== 'string') return [];
            const details = typeof entry.details === 'string' && entry.details
                ? ` (${entry.details})`
                : '';
            return [`${entry.message}${details}`];
        });
        if (errors.length > 0) messages.push(`节点 ${nodeId}: ${errors.join('; ')}`);
    }
    return messages;
}

function executionErrorMessage(status: Record<string, unknown>): string {
    if (!Array.isArray(status.messages)) return 'ComfyUI 执行失败';
    for (const message of status.messages) {
        if (!Array.isArray(message) || message[0] !== 'execution_error' || !isRecord(message[1])) {
            continue;
        }
        const nodeId = typeof message[1].node_id === 'string' ? message[1].node_id : '未知';
        const detail = typeof message[1].exception_message === 'string'
            ? message[1].exception_message
            : '未知错误';
        return `节点 ${nodeId} 执行失败：${detail}`;
    }
    return 'ComfyUI 执行失败';
}

function queueContains(value: unknown, promptId: string): boolean {
    return Array.isArray(value) && value.some((item) => (
        Array.isArray(item) && item[1] === promptId
    ));
}

function outputVideoUrl(snapshot: ComfyTaskSnapshot, history: Record<string, unknown>): string {
    const outputs = isRecord(history.outputs) ? history.outputs : {};
    const nodeOutput = Object.hasOwn(outputs, snapshot.primaryOutput.nodeId)
        && isRecord(outputs[snapshot.primaryOutput.nodeId])
        ? outputs[snapshot.primaryOutput.nodeId] as Record<string, unknown>
        : undefined;
    const field = nodeOutput?.[snapshot.primaryOutput.field];
    const descriptor = Array.isArray(field) ? field[snapshot.primaryOutput.index] : undefined;
    if (!isRecord(descriptor)) {
        throw new Error(
            `主输出缺失：节点 ${snapshot.primaryOutput.nodeId} 的 `
            + `${snapshot.primaryOutput.field}[${snapshot.primaryOutput.index}] 不存在`
        );
    }
    const filename = typeof descriptor.filename === 'string' ? descriptor.filename : '';
    const subfolder = typeof descriptor.subfolder === 'string' ? descriptor.subfolder : '';
    const type = typeof descriptor.type === 'string' ? descriptor.type : '';
    if (
        !filename
        || filename === '.'
        || filename === '..'
        || filename.includes('/')
        || filename.includes('\\')
        || /[\u0000-\u001f\u007f]/.test(filename)
    ) {
        throw new Error('主输出文件描述无效：filename 非法');
    }
    if (
        subfolder.includes('\\')
        || subfolder.split('/').some((segment) => segment === '..' || segment === '.')
        || subfolder.startsWith('/')
    ) {
        throw new Error('主输出文件描述无效：subfolder 非法');
    }
    if (!['input', 'output', 'temp'].includes(type)) {
        throw new Error('主输出文件描述无效：type 非法');
    }
    const query = new URLSearchParams({ filename, subfolder, type });
    return `${snapshot.comfyuiBaseUrl}/view?${query.toString()}`;
}

function toModelInfo(record: WorkflowTemplateRecord): ModelInfo | undefined {
    const parsed = parseWorkflowTemplateDocument(record.document);
    if (!parsed.template) return undefined;
    const { metadata } = parsed.template;
    return {
        id: record.id,
        displayName: record.name,
        parameterSchema: {
            kind: 'comfyui-workflow',
            variables: metadata.variables,
            primaryDescription: metadata.primaryDescription,
            primaryOutput: metadata.primaryOutput,
        },
    };
}

export class ComfyTaskPreparationError extends Error {
    constructor(public readonly errors: string[]) {
        super(errors.join('\n'));
        this.name = 'ComfyTaskPreparationError';
    }
}

export interface ComfyUIProviderOptions {
    fetcher?: typeof fetch;
    resolver?: ComfyDnsResolver;
    dataDir?: string;
}

function compatibilityErrors(result: Awaited<ReturnType<typeof checkComfyWorkflowCompatibility>>): string[] {
    return [
        ...result.missingNodeTypes.map((classType) => `缺少节点类型：${classType}`),
        ...result.missingRequiredInputs.map(
            (issue) => `节点 ${issue.nodeId}（${issue.classType}）缺少必填输入：${issue.input}`
        ),
        ...result.incompatibleInputs.map(
            (issue) => issue.reason
                ? `节点 ${issue.nodeId}（${issue.classType}）输入 ${issue.input} 不兼容：${issue.reason}`
                : `节点 ${issue.nodeId}（${issue.classType}）包含不可识别输入：${issue.input}`
        ),
    ];
}

export class ComfyUIProvider implements VideoProvider {
    readonly name = 'comfyui';
    readonly displayName = 'ComfyUI';
    private baseUrl = '';

    constructor(private readonly options: ComfyUIProviderOptions = {}) {}

    get models(): string[] {
        return this.getModelsInfo().map((model) => model.id);
    }

    getModelsInfo(): ModelInfo[] {
        return getAllWorkflowTemplates()
            .filter((template) => template.enabled)
            .map(toModelInfo)
            .filter((model): model is ModelInfo => model !== undefined);
    }

    getSettingsSchema(): ProviderSettingSchema[] {
        return [{
            key: 'base_url',
            label: 'ComfyUI 地址',
            required: true,
            defaultValue: 'http://127.0.0.1:8188',
            description: 'ComfyUI HTTP/HTTPS Base URL；创建任务时可临时覆盖。',
        }];
    }

    normalizeSettings(settings: Record<string, string>): Record<string, string> {
        if (settings.base_url === undefined) return settings;
        return { ...settings, base_url: normalizeComfyUiBaseUrl(settings.base_url) };
    }

    applySettings(settings: Record<string, string>): void {
        if (settings.base_url !== undefined) {
            this.baseUrl = normalizeComfyUiBaseUrl(settings.base_url);
        }
    }

    getCurrentSettings(): Record<string, string> {
        return this.baseUrl ? { base_url: this.baseUrl } : {};
    }

    resolveBaseUrl(temporaryBaseUrl?: string): string {
        const value = temporaryBaseUrl?.trim() ? temporaryBaseUrl : this.baseUrl;
        if (!value) throw new Error('请先设置默认 ComfyUI 地址');
        return normalizeComfyUiBaseUrl(value);
    }

    async prepareTask(params: CreateTaskParams): Promise<CreateTaskParams> {
        if (!params.model) throw new Error('请选择 ComfyUI 工作流模板');
        if (params.extra?.sourceSnapshot !== undefined) {
            throw new Error('历史套用不接受 sourceSnapshot，请使用 sourceTaskId');
        }
        const sourceTaskId = params.extra?.sourceTaskId;
        if (
            sourceTaskId !== undefined
            && (!Number.isInteger(sourceTaskId) || (sourceTaskId as number) <= 0)
        ) {
            throw new Error('sourceTaskId 必须是正整数');
        }
        let historical: Record<string, unknown> | undefined;
        if (typeof sourceTaskId === 'number') {
            const sourceTask = getTaskByIdIncludingDeleted(sourceTaskId);
            if (
                !sourceTask
                || sourceTask.provider !== 'comfyui'
                || sourceTask.model !== params.model
                || !sourceTask.extra_params
            ) {
                throw new Error('历史来源任务不存在或与所选模板不匹配');
            }
            try {
                const parsedSnapshot = JSON.parse(sourceTask.extra_params) as unknown;
                if (!isRecord(parsedSnapshot)) throw new Error('not an object');
                historical = parsedSnapshot;
            } catch {
                throw new Error('历史来源任务的工作流快照无效');
            }
        }
        if (historical && (
            historical.snapshotVersion !== 1
            || typeof historical.templateId !== 'string'
            || historical.templateId !== params.model
            || typeof historical.templateName !== 'string'
            || typeof historical.templateDocument !== 'string'
        )) {
            throw new Error('历史工作流快照无效或与所选模板不匹配');
        }
        const record = getWorkflowTemplateById(params.model);
        if ((!record || !record.enabled) && !historical) {
            throw new Error('所选 ComfyUI 工作流模板不存在或已停用');
        }
        const document = historical && typeof historical.templateDocument === 'string'
            ? historical.templateDocument
            : record?.document;
        if (!document) throw new Error('历史工作流快照缺少模板文档');
        const parsed = parseWorkflowTemplateDocument(document);
        if (!parsed.template) throw new Error(parsed.errors.join('\n') || '工作流模板无效');
        const templateId = historical && typeof historical.templateId === 'string'
            ? historical.templateId
            : record?.id ?? params.model;
        const templateName = historical && typeof historical.templateName === 'string'
            ? historical.templateName
            : record?.name ?? parsed.template.metadata.name;

        const extra = params.extra;
        const workflowInputs = extra?.workflowInputs;
        if (!workflowInputs || typeof workflowInputs !== 'object' || Array.isArray(workflowInputs)) {
            throw new Error('缺少工作流变量 workflowInputs');
        }
        const temporaryBaseUrl = extra?.comfyuiBaseUrl;
        if (temporaryBaseUrl !== undefined && typeof temporaryBaseUrl !== 'string') {
            throw new Error('本次 ComfyUI 地址必须是字符串');
        }
        const rendered = renderWorkflowTemplate(
            parsed.template,
            workflowInputs as Record<string, unknown>
        );
        const baseUrl = this.resolveBaseUrl(temporaryBaseUrl as string | undefined);
        let compatibility;
        let safeTarget;
        try {
            safeTarget = await createSafeHttpTarget(
                baseUrl,
                this.options.resolver,
                'ComfyUI 地址'
            );
            compatibility = await checkComfyWorkflowCompatibility(
                baseUrl,
                rendered.workflow,
                this.options.fetcher,
                this.options.resolver,
                safeTarget
            );
        } catch (error) {
            throw new ComfyTaskPreparationError([(error as Error).message]);
        }
        if (!compatibility.ok) {
            throw new ComfyTaskPreparationError(compatibilityErrors(compatibility));
        }

        const resolvedEntries = Object.entries(rendered.values);
        const imageResolutions = [];
        for (const variable of parsed.template.metadata.variables) {
            if (variable.type !== 'image') continue;
            const source = rendered.values[variable.key] as string;
            let resolution;
            try {
                resolution = await uploadComfyImage({
                    baseUrl,
                    source,
                    variableKey: variable.key,
                    fetcher: this.options.fetcher,
                    resolver: this.options.resolver,
                    dataDir: this.options.dataDir,
                    safeTarget,
                });
            } catch (error) {
                throw new ComfyTaskPreparationError([
                    `图片变量 ${variable.key} 上传失败：${(error as Error).message}`,
                ]);
            }
            const entry = resolvedEntries.find(([key]) => key === variable.key);
            if (entry) entry[1] = resolution.fileIdentifier;
            imageResolutions.push({ variableKey: variable.key, ...resolution });
        }
        const resolvedWorkflowInputs = Object.fromEntries(resolvedEntries);
        return {
            ...params,
            prompt: rendered.primaryDescription,
            extra: {
                snapshotVersion: 1,
                templateId,
                templateName,
                templateDocument: document,
                comfyuiBaseUrl: baseUrl,
                comfyuiSafeTarget: safeTarget,
                workflowInputs: rendered.values,
                resolvedWorkflowInputs,
                imageResolutions,
                workflow: renderWorkflowWithValues(parsed.template, resolvedWorkflowInputs),
                primaryOutput: parsed.template.metadata.primaryOutput,
            },
        };
    }

    async prepareRetry(params: CreateTaskParams): Promise<CreateTaskParams> {
        const snapshot = taskSnapshot(params.extra);
        const safeTarget = await this.safeTarget(snapshot);
        let compatibility;
        try {
            compatibility = await checkComfyWorkflowCompatibility(
                snapshot.comfyuiBaseUrl,
                snapshot.workflow,
                this.options.fetcher,
                this.options.resolver,
                safeTarget
            );
        } catch (error) {
            throw new ComfyTaskPreparationError([(error as Error).message]);
        }
        if (!compatibility.ok) {
            throw new ComfyTaskPreparationError(compatibilityErrors(compatibility));
        }
        return {
            ...params,
            extra: {
                ...params.extra,
                comfyuiBaseUrl: snapshot.comfyuiBaseUrl,
                comfyuiSafeTarget: safeTarget,
            },
        };
    }

    private async safeTarget(
        snapshot: ComfyTaskSnapshot,
        useSnapshotTarget = false
    ): Promise<SafeHttpTarget> {
        if (useSnapshotTarget && snapshot.comfyuiSafeTarget) {
            return validateSafeHttpTarget(
                snapshot.comfyuiBaseUrl,
                snapshot.comfyuiSafeTarget,
                'ComfyUI 地址'
            );
        }
        return createSafeHttpTarget(
            snapshot.comfyuiBaseUrl,
            this.options.resolver,
            'ComfyUI 地址'
        );
    }

    async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
        const snapshot = taskSnapshot(params.extra);
        const safeTarget = await this.safeTarget(snapshot, true);
        const response = await requestSafeHttpUrl(`${snapshot.comfyuiBaseUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: snapshot.workflow }),
            targetLabel: 'ComfyUI /prompt',
            safeTarget,
        }, this.options.fetcher, this.options.resolver);
        const data = parseJsonBody(response.body, 'ComfyUI /prompt');
        if (response.status < 200 || response.status >= 300) {
            const errors = nodeValidationErrors(data.node_errors);
            if (errors.length > 0) throw new Error(errors.join('\n'));
            const fallback = isRecord(data.error) && typeof data.error.message === 'string'
                ? data.error.message
                : `HTTP ${response.status}`;
            throw new Error(`ComfyUI /prompt 提交失败：${fallback}`);
        }
        if (typeof data.prompt_id !== 'string' || !data.prompt_id) {
            throw new Error('ComfyUI /prompt 未返回 prompt_id');
        }
        return { providerTaskId: data.prompt_id };
    }

    async getStatus(
        providerTaskId: string,
        context?: ProviderTaskContext
    ): Promise<TaskStatusResult> {
        const snapshot = taskSnapshot(context?.extra);
        const safeTarget = await this.safeTarget(snapshot, true);
        const historyResponse = await requestSafeHttpUrl(
            `${snapshot.comfyuiBaseUrl}/history/${encodeURIComponent(providerTaskId)}`,
            {
                targetLabel: 'ComfyUI /history',
                safeTarget,
            },
            this.options.fetcher,
            this.options.resolver
        );
        if (historyResponse.status < 200 || historyResponse.status >= 300) {
            throw new Error(`ComfyUI /history 请求失败（HTTP ${historyResponse.status}）`);
        }
        const historyData = parseJsonBody(historyResponse.body, 'ComfyUI /history');
        const history = Object.hasOwn(historyData, providerTaskId)
            && isRecord(historyData[providerTaskId])
            ? historyData[providerTaskId] as Record<string, unknown>
            : undefined;
        if (history) {
            const status = isRecord(history.status) ? history.status : {};
            if (status.status_str === 'error') {
                return { status: 'failed', errorMessage: executionErrorMessage(status) };
            }
            if (status.completed === true || status.status_str === 'success') {
                try {
                    return { status: 'success', videoUrl: outputVideoUrl(snapshot, history) };
                } catch (error) {
                    return { status: 'failed', errorMessage: (error as Error).message };
                }
            }
            return { status: 'running' };
        }

        const queueResponse = await requestSafeHttpUrl(`${snapshot.comfyuiBaseUrl}/queue`, {
            targetLabel: 'ComfyUI /queue',
            safeTarget,
        }, this.options.fetcher, this.options.resolver);
        if (queueResponse.status < 200 || queueResponse.status >= 300) {
            throw new Error(`ComfyUI /queue 请求失败（HTTP ${queueResponse.status}）`);
        }
        const queue = parseJsonBody(queueResponse.body, 'ComfyUI /queue');
        if (queueContains(queue.queue_running, providerTaskId)) return { status: 'running' };
        return { status: 'pending' };
    }

    async downloadVideo(
        videoUrl: string,
        targetPath: string,
        context?: ProviderTaskContext
    ): Promise<void> {
        const snapshot = taskSnapshot(context?.extra);
        const safeTarget = await this.safeTarget(snapshot, true);
        await downloadSafeHttpUrl(videoUrl, targetPath, {
            targetLabel: 'ComfyUI 视频下载',
            maxResponseBytes: 2 * 1024 * 1024 * 1024,
            allowedContentTypes: ['video/', 'application/octet-stream'],
            safeTarget,
        }, this.options.fetcher, this.options.resolver);
    }
}
