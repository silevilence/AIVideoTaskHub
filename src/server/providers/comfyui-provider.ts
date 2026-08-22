import {
    getAllWorkflowTemplates,
    getWorkflowTemplateById,
    type WorkflowTemplateRecord,
} from '../comfy-workflow-model.js';
import {
    checkComfyWorkflowCompatibility,
    createSafeHttpTarget,
    normalizeComfyUiBaseUrl,
    type ComfyDnsResolver,
} from '../comfyui-connection.js';
import { parseWorkflowTemplateDocument } from '../comfy-workflow-template.js';
import {
    renderWorkflowTemplate,
    renderWorkflowWithValues,
} from '../comfy-workflow-renderer.js';
import { uploadComfyImage } from '../comfyui-images.js';
import type {
    CreateTaskParams,
    CreateTaskResult,
    ModelInfo,
    ProviderSettingSchema,
    TaskStatusResult,
    VideoProvider,
} from '../provider.js';

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
        const record = getWorkflowTemplateById(params.model);
        if (!record || !record.enabled) throw new Error('所选 ComfyUI 工作流模板不存在或已停用');
        const parsed = parseWorkflowTemplateDocument(record.document);
        if (!parsed.template) throw new Error(parsed.errors.join('\n') || '工作流模板无效');

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
                templateId: record.id,
                templateName: record.name,
                templateDocument: record.document,
                comfyuiBaseUrl: baseUrl,
                workflowInputs: rendered.values,
                resolvedWorkflowInputs,
                imageResolutions,
                workflow: renderWorkflowWithValues(parsed.template, resolvedWorkflowInputs),
                primaryOutput: parsed.template.metadata.primaryOutput,
            },
        };
    }

    async createTask(_params: CreateTaskParams): Promise<CreateTaskResult> {
        throw new Error('ComfyUI 任务执行尚未接通');
    }

    async getStatus(_providerTaskId: string): Promise<TaskStatusResult> {
        throw new Error('ComfyUI 任务状态查询尚未接通');
    }

    async downloadVideo(_videoUrl: string, _targetPath: string): Promise<void> {
        throw new Error('ComfyUI 视频下载尚未接通');
    }
}
