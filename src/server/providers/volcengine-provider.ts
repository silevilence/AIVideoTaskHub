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
} from '../provider.js';

const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';

type VolcEngineStatus = 'queued' | 'running' | 'cancelled' | 'succeeded' | 'failed' | 'expired';

const STATUS_MAP: Record<VolcEngineStatus, TaskStatus> = {
    queued: 'pending',
    running: 'running',
    succeeded: 'success',
    failed: 'failed',
    cancelled: 'failed',
    expired: 'failed',
};

export interface VolcEngineProviderOptions {
    apiKey: string;
}

export class VolcEngineProvider implements VideoProvider {
    readonly name = 'volcengine';
    readonly displayName = '火山引擎 Seedance';
    readonly models = [
        'doubao-seedance-2-0-260128',
        'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-1-5-pro-251215',
        'doubao-seedance-1-0-pro-250528',
        'doubao-seedance-1-0-pro-fast-251015',
        'doubao-seedance-1-0-lite-t2v-250428',
        'doubao-seedance-1-0-lite-i2v-250428',
    ];
    private apiKey: string;

    constructor(options: VolcEngineProviderOptions) {
        this.apiKey = options.apiKey;
    }

    private static readonly RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];

    private static readonly MODEL_INFOS: ModelInfo[] = [
        {
            id: 'doubao-seedance-2-0-260128',
            displayName: 'Seedance 2.0',
            capabilities: {
                i2v: true,
                i2vOnly: true,
                firstLastFrame: true,
                referenceImage: true,
                audio: true,
                cameraFixed: true,
                draft: true,
                resolutions: ['480p', '720p'],
                durationRange: [4, 15],
                autoDuration: true,
                defaultResolution: '720p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
        {
            id: 'doubao-seedance-2-0-fast-260128',
            displayName: 'Seedance 2.0 Fast',
            capabilities: {
                i2v: true,
                i2vOnly: true,
                firstLastFrame: true,
                referenceImage: true,
                audio: true,
                cameraFixed: true,
                draft: true,
                resolutions: ['480p', '720p'],
                durationRange: [4, 15],
                autoDuration: true,
                defaultResolution: '720p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
        {
            id: 'doubao-seedance-1-5-pro-251215',
            displayName: 'Seedance 1.5 Pro',
            capabilities: {
                i2v: true,
                firstLastFrame: true,
                referenceImage: false,
                audio: true,
                cameraFixed: true,
                draft: true,
                resolutions: ['480p', '720p', '1080p'],
                durationRange: [4, 12],
                autoDuration: true,
                defaultResolution: '720p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
        {
            id: 'doubao-seedance-1-0-pro-250528',
            displayName: 'Seedance 1.0 Pro',
            capabilities: {
                i2v: true,
                firstLastFrame: true,
                referenceImage: false,
                audio: false,
                cameraFixed: true,
                draft: false,
                resolutions: ['480p', '720p', '1080p'],
                durationRange: [2, 12],
                autoDuration: false,
                defaultResolution: '1080p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
        {
            id: 'doubao-seedance-1-0-pro-fast-251015',
            displayName: 'Seedance 1.0 Pro Fast',
            capabilities: {
                i2v: true,
                firstLastFrame: false,
                referenceImage: false,
                audio: false,
                cameraFixed: true,
                draft: false,
                resolutions: ['480p', '720p', '1080p'],
                durationRange: [2, 12],
                autoDuration: false,
                defaultResolution: '1080p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
        {
            id: 'doubao-seedance-1-0-lite-t2v-250428',
            displayName: 'Seedance 1.0 Lite (文生视频)',
            capabilities: {
                i2v: false,
                firstLastFrame: false,
                referenceImage: false,
                audio: false,
                cameraFixed: true,
                draft: false,
                resolutions: ['480p', '720p'],
                durationRange: [2, 12],
                autoDuration: false,
                defaultResolution: '720p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
        {
            id: 'doubao-seedance-1-0-lite-i2v-250428',
            displayName: 'Seedance 1.0 Lite (图生视频)',
            capabilities: {
                i2v: true,
                firstLastFrame: true,
                referenceImage: true,
                audio: false,
                cameraFixed: false,
                draft: false,
                resolutions: ['480p', '720p'],
                durationRange: [2, 12],
                autoDuration: false,
                defaultResolution: '720p',
                ratios: VolcEngineProvider.RATIOS,
            },
        },
    ];

    getModelsInfo(): ModelInfo[] {
        return VolcEngineProvider.MODEL_INFOS;
    }

    getSettingsSchema(): ProviderSettingSchema[] {
        return [
            {
                key: 'api_key',
                label: 'API Key',
                secret: true,
                required: true,
                description: '火山引擎方舟平台的 API Key',
            },
        ];
    }

    applySettings(settings: Record<string, string>): void {
        if (settings.api_key) {
            this.apiKey = settings.api_key;
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

    async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
        const extra = params.extra ?? {};
        const content = this.buildContent(params);

        const body: Record<string, unknown> = {
            model: params.model ?? this.models[0],
            content,
        };

        // 可选参数
        if (extra.resolution !== undefined) body.resolution = extra.resolution;
        if (extra.ratio !== undefined) body.ratio = extra.ratio;
        if (extra.duration !== undefined) body.duration = extra.duration;
        if (extra.seed !== undefined) body.seed = extra.seed;
        if (extra.watermark !== undefined) body.watermark = extra.watermark;
        if (extra.cameraFixed !== undefined) body.camera_fixed = extra.cameraFixed;
        if (extra.returnLastFrame !== undefined) body.return_last_frame = extra.returnLastFrame;
        if (extra.generateAudio !== undefined) body.generate_audio = extra.generateAudio;
        if (extra.serviceTier !== undefined) body.service_tier = extra.serviceTier;
        if (extra.draft !== undefined) body.draft = extra.draft;

        const res = await fetch(BASE_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = (errBody as { error?: { message?: string } }).error?.message ?? '未知错误';
            throw new Error(`火山引擎 createTask 失败 (${res.status}): ${errMsg}`);
        }

        const data = (await res.json()) as { id: string };
        return { providerTaskId: data.id };
    }

    async getStatus(providerTaskId: string): Promise<TaskStatusResult> {
        const res = await fetch(`${BASE_URL}/${encodeURIComponent(providerTaskId)}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = (errBody as { error?: { message?: string } }).error?.message ?? '未知错误';
            throw new Error(`火山引擎 getStatus 失败 (${res.status}): ${errMsg}`);
        }

        const data = (await res.json()) as {
            id: string;
            status: VolcEngineStatus;
            error: { code: string; message: string } | null;
            content?: { video_url?: string; last_frame_url?: string };
        };

        const status = STATUS_MAP[data.status] ?? 'failed';
        const result: TaskStatusResult = { status };

        if (status === 'success' && data.content?.video_url) {
            result.videoUrl = data.content.video_url;
        }

        if (status === 'failed') {
            if (data.error?.message) {
                result.errorMessage = data.error.message;
            } else if (data.status === 'expired') {
                result.errorMessage = '任务超时(expired)';
            } else if (data.status === 'cancelled') {
                result.errorMessage = '任务已取消(cancelled)';
            } else {
                result.errorMessage = '未知错误';
            }
        }

        return result;
    }

    async downloadVideo(videoUrl: string, targetPath: string): Promise<void> {
        const res = await fetch(videoUrl);
        if (!res.ok || !res.body) {
            throw new Error(
                `火山引擎 downloadVideo 失败 (${res.status}): 无法下载 ${videoUrl}`
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

    private buildContent(params: CreateTaskParams): unknown[] {
        const content: unknown[] = [];
        const extra = params.extra ?? {};

        // 文本提示词
        if (params.prompt) {
            content.push({ type: 'text', text: params.prompt });
        }

        // 参考图模式（优先判断）
        const referenceImageUrls = extra.referenceImageUrls as string[] | undefined;
        if (referenceImageUrls && referenceImageUrls.length > 0) {
            for (const url of referenceImageUrls) {
                content.push({
                    type: 'image_url',
                    image_url: { url },
                    role: 'reference_image',
                });
            }
            return content;
        }

        // 首尾帧模式
        const lastFrameImageUrl = extra.lastFrameImageUrl as string | undefined;
        if (params.imageUrl && lastFrameImageUrl) {
            content.push({
                type: 'image_url',
                image_url: { url: params.imageUrl },
                role: 'first_frame',
            });
            content.push({
                type: 'image_url',
                image_url: { url: lastFrameImageUrl },
                role: 'last_frame',
            });
            return content;
        }

        // 首帧模式
        if (params.imageUrl) {
            content.push({
                type: 'image_url',
                image_url: { url: params.imageUrl },
                role: 'first_frame',
            });
        }

        return content;
    }
}
