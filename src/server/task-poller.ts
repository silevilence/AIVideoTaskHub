import path from 'path';
import type { ProviderRegistry } from './provider-registry.js';
import type { VideoProvider } from './provider.js';
import { getRunningTasks, updateTaskStatus, type Task } from './task-model.js';
import { logger } from './logger.js';
import { resolveCreateTaskImages } from './image-utils.js';

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
        // 立即执行一次轮询，处理重启前遗留的任务
        this.poll();
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('轮询器已停止');
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
            logger.error(`轮询出错: ${err}`);
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
                    logger.taskStatusChanged(task.id, task.status, 'success');
                } catch (downloadErr) {
                    const errMsg = `视频下载失败: ${(downloadErr as Error).message}`;
                    logger.error(`任务 ${task.id} 视频下载失败: ${errMsg}, URL: ${statusResult.videoUrl}`);
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
                logger.taskStatusChanged(task.id, task.status, 'failed');
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
                logger.taskStatusChanged(task.id, task.status, statusResult.status);
                updateTaskStatus(task.id, statusResult.status);
            }
        } catch (err) {
            logger.error(`任务 ${task.id} 处理出错: ${err}`);
        }
    }

    /** 重新提交没有 provider_task_id 的任务（创建时失败的重试） */
    private async resubmitTask(task: Task, provider: VideoProvider): Promise<void> {
        try {
            const extra = task.extra_params ? JSON.parse(task.extra_params) : undefined;
            const { resolvedImageUrl, resolvedExtra } = resolveCreateTaskImages(
                task.image_url ?? undefined,
                extra,
            );
            const result = await provider.createTask({
                prompt: task.prompt,
                model: task.model ?? undefined,
                imageUrl: resolvedImageUrl,
                extra: resolvedExtra,
            });
            updateTaskStatus(task.id, 'pending', {
                providerTaskId: result.providerTaskId,
            });
            logger.info(`任务 ${task.id} 重新提交成功, provider_task_id: ${result.providerTaskId}`);
        } catch (err) {
            logger.error(`任务 ${task.id} 重新提交失败: ${err}`);
            updateTaskStatus(task.id, 'failed', {
                errorMessage: `重试创建失败: ${(err as Error).message}`,
                incrementRetry: true,
            });
        }
    }
}
