import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import type {
    VideoProvider,
    CreateTaskParams,
    CreateTaskResult,
    TaskStatusResult,
    TaskStatus,
    ProviderSettingSchema,
    ModelInfo,
    ModelCapabilities,
} from '../provider.js';

const BASE_URL = 'https://aihubmix.com';
const MODELS_API_URL = 'https://aihubmix.com/api/v1/models';

type AIHubMixStatus = 'queued' | 'in_progress' | 'completed' | 'failed';

const STATUS_MAP: Record<AIHubMixStatus, TaskStatus> = {
    queued: 'pending',
    in_progress: 'running',
    completed: 'success',
    failed: 'failed',
};

/** API 模型列表返回的单个模型 */
interface APIModel {
    model_id: string;
    desc?: string;
    types: string;
    input_modalities?: string;
    features?: string;
}

export interface AIHubMixProviderOptions {
    apiKey: string;
}

/** 已知模型的详细能力定义（根据文档） */
const KNOWN_MODELS: Record<string, { displayName: string; capabilities: ModelCapabilities; disabled?: boolean; disabledReason?: string }> = {
    // ── Sora ──
    'sora-2': {
        displayName: 'Sora 2',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
            durationRange: [4, 12], durationOptions: [4, 8, 12],
            autoDuration: false, defaultResolution: '720x1280',
        },
    },
    'sora-2-pro': {
        displayName: 'Sora 2 Pro',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
            durationRange: [4, 12], durationOptions: [4, 8, 12],
            autoDuration: false, defaultResolution: '720x1280',
        },
    },
    // ── Google Veo ──
    'veo-3.1-generate-preview': {
        displayName: 'Veo 3.1',
        capabilities: {
            i2v: true, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: ['1280x720', '1920x1080'],
            durationRange: [4, 8], durationOptions: [4, 6, 8],
            i2vDurationOptions: [8],
            autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'veo-3.1-fast-generate-preview': {
        displayName: 'Veo 3.1 Fast',
        capabilities: {
            i2v: true, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: ['1280x720', '1920x1080'],
            durationRange: [4, 8], durationOptions: [4, 6, 8],
            i2vDurationOptions: [8],
            autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'veo-3.0-generate-preview': {
        displayName: 'Veo 3.0',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: ['1280x720', '1920x1080'],
            durationRange: [4, 8], durationOptions: [4, 6, 8],
            autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'veo-2.0-generate-001': {
        displayName: 'Veo 2.0',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: ['1280x720', '1920x1080'],
            durationRange: [5, 8],
            autoDuration: false, defaultResolution: '1280x720',
        },
    },
    // ── 通义万相 (Wan) ──
    'wan2.6-t2v': {
        displayName: '通义万相 2.6 文生视频',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: [
                '1280x720', '720x1280', '960x960', '1088x832', '832x1088',
                '1920x1080', '1080x1920', '1440x1440', '1632x1248', '1248x1632',
            ],
            durationRange: [2, 15], autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'wan2.6-i2v': {
        displayName: '通义万相 2.6 图生视频',
        disabled: true, disabledReason: '图片上传格式不兼容，暂不可用',
        capabilities: {
            i2v: true, i2vOnly: true, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: [
                '1280x720', '720x1280', '960x960', '1088x832', '832x1088',
                '1920x1080', '1080x1920', '1440x1440', '1632x1248', '1248x1632',
            ],
            durationRange: [2, 15], autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'wan2.5-t2v-preview': {
        displayName: '通义万相 2.5 文生视频',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: [
                '832x480', '480x832', '624x624',
                '1280x720', '720x1280', '960x960', '1088x832', '832x1088',
                '1920x1080', '1080x1920', '1440x1440', '1632x1248', '1248x1632',
            ],
            durationRange: [5, 10], durationOptions: [5, 10],
            autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'wan2.5-i2v-preview': {
        displayName: '通义万相 2.5 图生视频',
        disabled: true, disabledReason: '图片上传格式不兼容，暂不可用',
        capabilities: {
            i2v: true, i2vOnly: true, firstLastFrame: false, referenceImage: false,
            audio: true, cameraFixed: false, draft: false,
            resolutions: [
                '832x480', '480x832', '624x624',
                '1280x720', '720x1280', '960x960', '1088x832', '832x1088',
                '1920x1080', '1080x1920', '1440x1440', '1632x1248', '1248x1632',
            ],
            durationRange: [5, 10], durationOptions: [5, 10],
            autoDuration: false, defaultResolution: '1280x720',
        },
    },
    'wan2.2-t2v-plus': {
        displayName: '通义万相 2.2 文生视频',
        capabilities: {
            i2v: false, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: [
                '832x480', '480x832', '624x624',
                '1920x1080', '1080x1920', '1440x1440', '1632x1248', '1248x1632',
            ],
            durationRange: [5, 5], autoDuration: false, defaultResolution: '1920x1080',
        },
    },
    'wan2.2-i2v-plus': {
        displayName: '通义万相 2.2 图生视频',
        disabled: true, disabledReason: '图片上传格式不兼容，暂不可用',
        capabilities: {
            i2v: true, i2vOnly: true, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: [
                '832x480', '480x832', '624x624',
                '1920x1080', '1080x1920', '1440x1440', '1632x1248', '1248x1632',
            ],
            durationRange: [5, 5], autoDuration: false, defaultResolution: '1920x1080',
        },
    },
    // ── 即梦 AI ──
    'jimeng-3.0-pro': {
        displayName: '即梦 3.0 Pro',
        capabilities: {
            i2v: true, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: [
                '16:9', '9:16', '4:3', '3:4', '1:1', '21:9',
                '1920x1080', '1080x1920', '1664x1248', '1248x1664', '1440x1440', '2176x928',
            ],
            durationRange: [5, 10], durationOptions: [5, 10], autoDuration: false, defaultResolution: '16:9',
        },
    },
    'jimeng-3.0-1080p': {
        displayName: '即梦 3.0 1080P',
        capabilities: {
            i2v: true, firstLastFrame: false, referenceImage: false,
            audio: false, cameraFixed: false, draft: false,
            resolutions: [
                '16:9', '9:16', '4:3', '3:4', '1:1', '21:9',
                '1920x1080', '1080x1920', '1664x1248', '1248x1664', '1440x1440', '2176x928',
            ],
            durationRange: [5, 10], durationOptions: [5, 10], autoDuration: false, defaultResolution: '16:9',
        },
    },
};

/** 根据 API 模型列表中的已知模型 ID 生成静态备用模型信息 */
const STATIC_FALLBACK_MODELS: ModelInfo[] = Object.entries(KNOWN_MODELS).map(
    ([id, info]) => ({
        id,
        displayName: info.displayName,
        capabilities: info.capabilities,
        ...(info.disabled ? { disabled: info.disabled, disabledReason: info.disabledReason } : {}),
    }),
);

export class AIHubMixProvider implements VideoProvider {
    readonly name = 'aihubmix';
    readonly displayName = 'AIHubMix';

    private apiKey: string;
    private cachedAPIModels: APIModel[] = [];
    private cachedModelInfos: ModelInfo[] = STATIC_FALLBACK_MODELS;
    private modelsUpdatedAt: Date | null = null;

    constructor(options: AIHubMixProviderOptions) {
        this.apiKey = options.apiKey;
    }

    get models(): string[] {
        return this.cachedModelInfos.map((m) => m.id);
    }

    getModelsInfo(): ModelInfo[] {
        return this.cachedModelInfos;
    }

    getSettingsSchema(): ProviderSettingSchema[] {
        return [
            {
                key: 'api_key',
                label: 'API Key',
                secret: true,
                required: true,
                description: 'AIHubMix 平台的 API Key',
            },
        ];
    }

    applySettings(settings: Record<string, string>): void {
        if (settings.api_key) {
            this.apiKey = settings.api_key;
        }
        // 加载缓存的模型列表
        if (settings._cached_models) {
            try {
                const apiModels: APIModel[] = JSON.parse(settings._cached_models);
                this.cachedAPIModels = apiModels;
                this.cachedModelInfos = this.buildModelInfos(apiModels);
            } catch { /* ignore invalid cache */ }
        }
        if (settings._models_updated_at) {
            this.modelsUpdatedAt = new Date(settings._models_updated_at);
        }
    }

    getCurrentSettings(): Record<string, string> {
        return {
            api_key: this.getMaskedApiKey(),
        };
    }

    private getMaskedApiKey(): string {
        if (!this.apiKey) return '';
        if (this.apiKey.length <= 8) return '****';
        return this.apiKey.slice(0, 4) + '****' + this.apiKey.slice(-4);
    }

    // ── 任务操作 ──────────────────────────────

    async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
        const extra = params.extra ?? {};
        const body: Record<string, unknown> = {
            model: params.model ?? this.models[0],
            prompt: params.prompt,
        };

        // seconds: 支持直接传 seconds (string) 或从 duration (number) 转换
        if (extra.seconds !== undefined) {
            body.seconds = String(extra.seconds);
        } else if (extra.duration !== undefined) {
            body.seconds = String(extra.duration);
        }

        // size: 支持直接传 size 或从 resolution 转换
        if (extra.size !== undefined) {
            body.size = extra.size;
        } else if (extra.resolution !== undefined) {
            body.size = extra.resolution;
        }

        // 图生视频：input_reference（URL 直接传字符串，base64 转对象格式）
        if (params.imageUrl) {
            const dataUrlMatch = params.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (dataUrlMatch) {
                body.input_reference = {
                    mime_type: dataUrlMatch[1],
                    data: dataUrlMatch[2],
                };
            } else {
                body.input_reference = params.imageUrl;
            }
        }

        const res = await fetch(`${BASE_URL}/v1/videos`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = this.extractErrorMessage(errBody);
            throw new Error(`AIHubMix createTask 失败 (${res.status}): ${errMsg}`);
        }

        const data = (await res.json()) as { id: string };
        return { providerTaskId: data.id };
    }

    async getStatus(providerTaskId: string): Promise<TaskStatusResult> {
        const res = await fetch(
            `${BASE_URL}/v1/videos/${encodeURIComponent(providerTaskId)}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            },
        );

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = this.extractErrorMessage(errBody);
            throw new Error(`AIHubMix getStatus 失败 (${res.status}): ${errMsg}`);
        }

        const data = (await res.json()) as {
            id: string;
            status: AIHubMixStatus;
            url?: string;
            error?: { message?: string } | string;
        };

        const status = STATUS_MAP[data.status] ?? 'failed';
        const result: TaskStatusResult = { status };

        if (status === 'success') {
            // 始终使用 AIHubMix 的 content 端点，不使用响应中的 url（可能指向上游 Provider）
            result.videoUrl =
                `${BASE_URL}/v1/videos/${encodeURIComponent(providerTaskId)}/content`;
        }

        if (status === 'failed') {
            if (typeof data.error === 'string') {
                result.errorMessage = data.error;
            } else if (data.error?.message) {
                result.errorMessage = data.error.message;
            } else {
                result.errorMessage = '未知错误';
            }
        }

        return result;
    }

    async downloadVideo(videoUrl: string, targetPath: string): Promise<void> {
        const res = await fetch(videoUrl, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!res.ok || !res.body) {
            throw new Error(
                `AIHubMix downloadVideo 失败 (${res.status}): 无法下载 ${videoUrl}`,
            );
        }

        await mkdir(dirname(targetPath), { recursive: true });

        const reader = res.body.getReader();
        const writable = createWriteStream(targetPath);

        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                writable.write(value);
            }
        } finally {
            writable.end();
            await new Promise<void>((resolve, reject) => {
                writable.on('finish', resolve);
                writable.on('error', reject);
            });
        }
    }

    // ── 动态模型管理 ──────────────────────────

    /** 是否需要刷新模型列表（无缓存或缓存超过1天） */
    needsModelRefresh(): boolean {
        if (!this.modelsUpdatedAt || this.cachedAPIModels.length === 0) {
            return true;
        }
        const oneDayMs = 24 * 60 * 60 * 1000;
        return Date.now() - this.modelsUpdatedAt.getTime() > oneDayMs;
    }

    /** 从 API 获取最新的视频模型列表 */
    async refreshModels(): Promise<ModelInfo[]> {
        const res = await fetch(`${MODELS_API_URL}?type=video`, {
            headers: this.apiKey
                ? { 'Authorization': `Bearer ${this.apiKey}` }
                : {},
        });

        if (!res.ok) {
            throw new Error(`AIHubMix 获取模型列表失败 (${res.status})`);
        }

        const data = (await res.json()) as { success: boolean; data: APIModel[] };
        if (!data.success || !Array.isArray(data.data)) {
            throw new Error('AIHubMix 获取模型列表失败: 响应格式异常');
        }

        this.cachedAPIModels = data.data;
        this.modelsUpdatedAt = new Date();
        this.cachedModelInfos = this.buildModelInfos(data.data);

        return this.cachedModelInfos;
    }

    /** 获取缓存数据以便持久化到数据库 */
    getCacheData(): Record<string, string> | undefined {
        if (this.cachedAPIModels.length === 0 || !this.modelsUpdatedAt) {
            return undefined;
        }
        return {
            _cached_models: JSON.stringify(this.cachedAPIModels),
            _models_updated_at: this.modelsUpdatedAt.toISOString(),
        };
    }

    // ── 内部方法 ──────────────────────────────

    /** 将 API 模型列表转换为 ModelInfo 数组 */
    private buildModelInfos(apiModels: APIModel[]): ModelInfo[] {
        return apiModels.map((m) => {
            const known = KNOWN_MODELS[m.model_id];
            if (known) {
                return {
                    id: m.model_id,
                    displayName: known.displayName,
                    capabilities: known.capabilities,
                    ...(known.disabled ? { disabled: known.disabled, disabledReason: known.disabledReason } : {}),
                };
            }
            // 未知模型：根据 input_modalities 推断基础能力
            const modalities = (m.input_modalities ?? '').split(',').map((s) => s.trim());
            const supportsImage = modalities.includes('image');
            return {
                id: m.model_id,
                displayName: this.humanizeModelId(m.model_id),
                capabilities: {
                    i2v: supportsImage,
                    firstLastFrame: false,
                    referenceImage: false,
                    audio: false,
                    cameraFixed: false,
                    draft: false,
                    resolutions: ['1280x720', '720x1280', '1920x1080', '1080x1920'],
                    durationRange: [4, 8] as [number, number],
                    autoDuration: false,
                    defaultResolution: '1280x720',
                },
            };
        });
    }

    /** 将模型 ID 转换为更友好的显示名称 */
    private humanizeModelId(modelId: string): string {
        return modelId
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    /** 从不同格式的错误响应中提取错误信息 */
    private extractErrorMessage(body: unknown): string {
        if (!body || typeof body !== 'object') return '未知错误';
        const obj = body as Record<string, unknown>;

        // OpenAI format: { error: { message: "..." } }
        if (obj.error && typeof obj.error === 'object') {
            const errObj = obj.error as Record<string, unknown>;
            if (typeof errObj.message === 'string') return errObj.message;
        }

        // String error: { error: "..." }
        if (typeof obj.error === 'string') return obj.error;

        // Simple message: { message: "..." }
        if (typeof obj.message === 'string') return obj.message;

        return '未知错误';
    }
}
