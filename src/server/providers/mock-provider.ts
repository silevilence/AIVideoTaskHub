import { randomUUID } from 'crypto';
import type {
    VideoProvider,
    CreateTaskParams,
    CreateTaskResult,
    TaskStatusResult,
} from '../provider.js';

export interface MockProviderOptions {
    /** 模拟生成延迟（毫秒），默认 30000 */
    delayMs?: number;
    /** 模拟失败概率 0~1，默认 0 */
    failRate?: number;
}

interface MockTask {
    id: string;
    prompt: string;
    createdAt: number;
    shouldFail: boolean;
}

export class MockProvider implements VideoProvider {
    readonly name = 'mock';
    readonly models = ['mock-model'];
    private readonly delayMs: number;
    private readonly failRate: number;
    private readonly tasks = new Map<string, MockTask>();

    constructor(options?: MockProviderOptions) {
        this.delayMs = options?.delayMs ?? 30_000;
        this.failRate = options?.failRate ?? 0;
    }

    async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
        const id = `mock-${randomUUID()}`;
        this.tasks.set(id, {
            id,
            prompt: params.prompt,
            createdAt: Date.now(),
            shouldFail: Math.random() < this.failRate,
        });
        return { providerTaskId: id };
    }

    async getStatus(providerTaskId: string): Promise<TaskStatusResult> {
        const task = this.tasks.get(providerTaskId);
        if (!task) {
            return {
                status: 'failed',
                errorMessage: `任务 ${providerTaskId} 不存在`,
            };
        }

        const elapsed = Date.now() - task.createdAt;
        if (elapsed < this.delayMs) {
            return { status: elapsed < this.delayMs / 2 ? 'pending' : 'running' };
        }

        if (task.shouldFail) {
            return {
                status: 'failed',
                errorMessage: 'Mock 模拟生成失败',
            };
        }

        return {
            status: 'success',
            videoUrl: `https://mock.example.com/videos/${task.id}.mp4`,
        };
    }

    async downloadVideo(_videoUrl: string, _targetPath: string): Promise<void> {
        // Mock 模式不做真实下载
    }
}
