import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import type {
    VideoProvider,
    CreateTaskParams,
    CreateTaskResult,
    TaskStatusResult,
    TaskStatus,
} from '../provider.js';

const BASE_URL = 'https://api.siliconflow.cn/v1/video';

type SiliconFlowStatus = 'Succeed' | 'InQueue' | 'InProgress' | 'Failed';

const STATUS_MAP: Record<SiliconFlowStatus, TaskStatus> = {
    InQueue: 'pending',
    InProgress: 'running',
    Succeed: 'success',
    Failed: 'failed',
};

export type ImageSize = '1280x720' | '720x1280' | '960x960';

export interface SiliconFlowProviderOptions {
    apiKey: string;
    defaultModel?: string;
    defaultImageSize?: ImageSize;
}

export class SiliconFlowProvider implements VideoProvider {
    readonly name = 'siliconflow';
    private readonly apiKey: string;
    private readonly defaultModel: string;
    private readonly defaultImageSize: ImageSize;

    constructor(options: SiliconFlowProviderOptions) {
        this.apiKey = options.apiKey;
        this.defaultModel = options.defaultModel ?? 'Wan-AI/Wan2.2-T2V-A14B';
        this.defaultImageSize = options.defaultImageSize ?? '1280x720';
    }

    async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
        const body: Record<string, unknown> = {
            model: params.model ?? this.defaultModel,
            prompt: params.prompt,
            image_size: this.defaultImageSize,
        };

        if (params.imageUrl) {
            body.image = params.imageUrl;
        }

        const res = await fetch(`${BASE_URL}/submit`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(
                `SiliconFlow createTask 失败 (${res.status}): ${(errBody as Record<string, string>).message ?? '未知错误'}`
            );
        }

        const data = (await res.json()) as { requestId: string };
        return { providerTaskId: data.requestId };
    }

    async getStatus(providerTaskId: string): Promise<TaskStatusResult> {
        const res = await fetch(`${BASE_URL}/status`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requestId: providerTaskId }),
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(
                `SiliconFlow getStatus 失败 (${res.status}): ${(errBody as Record<string, string>).message ?? '未知错误'}`
            );
        }

        const data = (await res.json()) as {
            status: SiliconFlowStatus;
            reason?: string;
            results?: { videos?: { url: string }[] };
        };

        const status = STATUS_MAP[data.status] ?? 'failed';
        const result: TaskStatusResult = { status };

        if (status === 'success' && data.results?.videos?.[0]?.url) {
            result.videoUrl = data.results.videos[0].url;
        }

        if (status === 'failed' && data.reason) {
            result.errorMessage = data.reason;
        }

        return result;
    }

    async downloadVideo(videoUrl: string, targetPath: string): Promise<void> {
        const res = await fetch(videoUrl);
        if (!res.ok || !res.body) {
            throw new Error(
                `SiliconFlow downloadVideo 失败 (${res.status}): 无法下载 ${videoUrl}`
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
}
