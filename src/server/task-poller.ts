import path from 'path';
import type { ProviderRegistry } from './provider-registry.js';
import type { VideoProvider } from './provider.js';
import { getRunningTasks, updateTaskStatus, type Task } from './task-model.js';

export interface TaskPollerOptions {
    registry: ProviderRegistry;
    /** 轮询间隔（毫秒），默认 5000 */
    intervalMs?: number;
    /** 视频存储目录，默认 data/videos */
    dataDir?: string;
    /** 最大重试次数，默认 3 */
    maxRetries?: number;
}

export class TaskPoller {
    private readonly registry: ProviderRegistry;
    private readonly intervalMs: number;
    private readonly dataDir: string;
    private readonly maxRetries: number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private processing = false;

    constructor(options: TaskPollerOptions) {
        this.registry = options.registry;
        this.intervalMs = options.intervalMs ?? 5000;
        this.dataDir = options.dataDir ?? 'data/videos';
        this.maxRetries = options.maxRetries ?? 3;
    }

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => this.poll(), this.intervalMs);
        console.log(`[poller] started, interval: ${this.intervalMs}ms`);
        // 立即执行一次轮询，处理重启前遗留的任务
        this.poll();
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[poller] stopped');
        }
    }

    isRunning(): boolean {
        return this.timer !== null;
    }

    async poll(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        try {
            const tasks = getRunningTasks();
            for (const task of tasks) {
                await this.processTask(task);
            }
        } catch (err) {
            console.error('[poller] poll error:', err);
        } finally {
            this.processing = false;
        }
    }

    private async processTask(task: Task): Promise<void> {
        const provider = this.registry.get(task.provider);
        if (!provider) {
            updateTaskStatus(task.id, 'failed', {
                errorMessage: `Provider "${task.provider}" 不存在`,
            });
            return;
        }

        // 没有 provider_task_id：需要重新提交任务到 Provider
        if (!task.provider_task_id) {
            await this.resubmitTask(task, provider);
            return;
        }

        try {
            const statusResult = await provider.getStatus(task.provider_task_id);

            if (statusResult.status === 'success' && statusResult.videoUrl) {
                const filename = `${task.provider}-${task.id}-${Date.now()}.mp4`;
                const targetPath = path.join(this.dataDir, filename);

                try {
                    await provider.downloadVideo(statusResult.videoUrl, targetPath);
                    updateTaskStatus(task.id, 'success', {
                        resultUrl: `/videos/${filename}`,
                    });
                } catch (downloadErr) {
                    const errMsg = `视频下载失败: ${(downloadErr as Error).message}`;
                    console.error(`[poller] download error for task ${task.id}: ${errMsg}, url: ${statusResult.videoUrl}`);
                    if (task.retry_count < this.maxRetries) {
                        // 保持 running 状态，下次轮询自动重试下载
                        updateTaskStatus(task.id, 'running', {
                            errorMessage: errMsg,
                            incrementRetry: true,
                        });
                    } else {
                        updateTaskStatus(task.id, 'failed', {
                            errorMessage: `${errMsg}（已达最大重试次数）`,
                        });
                    }
                }
            } else if (statusResult.status === 'failed') {
                if (task.retry_count < this.maxRetries) {
                    updateTaskStatus(task.id, 'failed', {
                        errorMessage: statusResult.errorMessage ?? '未知错误',
                        incrementRetry: true,
                    });
                } else {
                    updateTaskStatus(task.id, 'failed', {
                        errorMessage: statusResult.errorMessage ?? '未知错误（已达最大重试次数）',
                    });
                }
            } else if (statusResult.status !== task.status) {
                updateTaskStatus(task.id, statusResult.status);
            }
        } catch (err) {
            console.error(`[poller] processTask error for task ${task.id}:`, err);
        }
    }

    /** 重新提交没有 provider_task_id 的任务（创建时失败的重试） */
    private async resubmitTask(task: Task, provider: VideoProvider): Promise<void> {
        try {
            const extra = task.extra_params ? JSON.parse(task.extra_params) : undefined;
            const result = await provider.createTask({
                prompt: task.prompt,
                model: task.model ?? undefined,
                imageUrl: task.image_url ?? undefined,
                extra,
            });
            updateTaskStatus(task.id, 'pending', {
                providerTaskId: result.providerTaskId,
            });
            console.log(`[poller] resubmitted task ${task.id}, provider_task_id: ${result.providerTaskId}`);
        } catch (err) {
            console.error(`[poller] resubmit error for task ${task.id}:`, err);
            updateTaskStatus(task.id, 'failed', {
                errorMessage: `重试创建失败: ${(err as Error).message}`,
                incrementRetry: true,
            });
        }
    }
}
