import {
    getAllWorkflowTemplates,
    type WorkflowTemplateRecord,
} from '../comfy-workflow-model.js';
import { normalizeComfyUiBaseUrl } from '../comfyui-connection.js';
import { parseWorkflowTemplateDocument } from '../comfy-workflow-template.js';
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

export class ComfyUIProvider implements VideoProvider {
    readonly name = 'comfyui';
    readonly displayName = 'ComfyUI';
    private baseUrl = '';

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
