import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDb, closeDb } from '../src/server/database.js';
import { insertTask, getTaskById, updateTaskStatus } from '../src/server/task-model.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { MockProvider } from '../src/server/providers/mock-provider.js';
import { TaskPoller } from '../src/server/task-poller.js';
import type { VideoProvider, TaskStatusResult } from '../src/server/provider.js';

/** 创建一个可控的 stub provider */
function createStubProvider(
    name: string,
    overrides: {
        getStatus?: (id: string) => Promise<TaskStatusResult>;
        downloadVideo?: (url: string, path: string) => Promise<void>;
    } = {}
): VideoProvider {
    return {
        name,
        createTask: vi.fn().mockResolvedValue({ providerTaskId: 'stub-id' }),
        getStatus: overrides.getStatus ?? vi.fn().mockResolvedValue({ status: 'running' }),
        downloadVideo: overrides.downloadVideo ?? vi.fn().mockResolvedValue(undefined),
    };
}

describe('TaskPoller', () => {
    let registry: ProviderRegistry;
    let poller: TaskPoller;

    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
    });

    afterEach(() => {
        poller?.stop();
        closeDb();
    });

    describe('start / stop', () => {
        it('start 后 isRunning 应返回 true', () => {
            registry.register(new MockProvider());
            poller = new TaskPoller({ registry, intervalMs: 60_000 });

            expect(poller.isRunning()).toBe(false);
            poller.start();
            expect(poller.isRunning()).toBe(true);
        });

        it('stop 后 isRunning 应返回 false', () => {
            registry.register(new MockProvider());
            poller = new TaskPoller({ registry, intervalMs: 60_000 });

            poller.start();
            poller.stop();
            expect(poller.isRunning()).toBe(false);
        });

        it('重复 start 不应创建多个定时器', () => {
            registry.register(new MockProvider());
            poller = new TaskPoller({ registry, intervalMs: 60_000 });

            poller.start();
            poller.start();
            expect(poller.isRunning()).toBe(true);
            // stop 一次即可停止
            poller.stop();
            expect(poller.isRunning()).toBe(false);
        });
    });

    describe('poll - 状态同步', () => {
        it('无活跃任务时 poll 应正常返回', async () => {
            registry.register(new MockProvider());
            poller = new TaskPoller({ registry });
            await expect(poller.poll()).resolves.toBeUndefined();
        });

        it('应将 pending 任务状态更新为 running', async () => {
            const stubProvider = createStubProvider('stub', {
                getStatus: vi.fn().mockResolvedValue({ status: 'running' }),
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test' });
            updateTaskStatus(task.id, 'pending', { providerTaskId: 'remote-1' });

            poller = new TaskPoller({ registry });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('running');
        });

        it('如果 provider 不存在，应将任务标记为 failed', async () => {
            // 注册一个无关的 provider
            registry.register(new MockProvider());

            const task = insertTask({ provider: 'nonexistent', prompt: 'test' });
            updateTaskStatus(task.id, 'pending', { providerTaskId: 'remote-42' });

            poller = new TaskPoller({ registry });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('failed');
            expect(updated.error_message).toContain('不存在');
        });

        it('没有 provider_task_id 的任务应跳过', async () => {
            const stubProvider = createStubProvider('stub');
            registry.register(stubProvider);

            insertTask({ provider: 'stub', prompt: 'test' });
            // 不设置 provider_task_id

            poller = new TaskPoller({ registry });
            await poller.poll();

            // getStatus 不应被调用，因为没有 provider_task_id
            expect(stubProvider.getStatus).not.toHaveBeenCalled();
        });
    });

    describe('poll - 成功下载', () => {
        it('状态为 success 时应下载视频并更新 result_url', async () => {
            const downloadFn = vi.fn().mockResolvedValue(undefined);
            const stubProvider = createStubProvider('stub', {
                getStatus: vi.fn().mockResolvedValue({
                    status: 'success',
                    videoUrl: 'https://example.com/video.mp4',
                }),
                downloadVideo: downloadFn,
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test video' });
            updateTaskStatus(task.id, 'running', { providerTaskId: 'remote-ok' });

            poller = new TaskPoller({ registry, dataDir: 'data/videos' });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('success');
            expect(updated.result_url).toMatch(/^\/videos\/stub-\d+-\d+\.mp4$/);
            expect(downloadFn).toHaveBeenCalledOnce();
            expect(downloadFn.mock.calls[0][0]).toBe('https://example.com/video.mp4');
        });

        it('下载失败时应标记 failed 并增加 retry_count', async () => {
            const stubProvider = createStubProvider('stub', {
                getStatus: vi.fn().mockResolvedValue({
                    status: 'success',
                    videoUrl: 'https://example.com/video.mp4',
                }),
                downloadVideo: vi.fn().mockRejectedValue(new Error('网络超时')),
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test' });
            updateTaskStatus(task.id, 'running', { providerTaskId: 'remote-dl' });

            poller = new TaskPoller({ registry });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('failed');
            expect(updated.error_message).toContain('视频下载失败');
            expect(updated.retry_count).toBe(1);
        });
    });

    describe('poll - 失败与重试', () => {
        it('任务失败且未达重试上限时应标记 failed 并增加 retry_count', async () => {
            const stubProvider = createStubProvider('stub', {
                getStatus: vi.fn().mockResolvedValue({
                    status: 'failed',
                    errorMessage: '内容审核不通过',
                }),
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test' });
            updateTaskStatus(task.id, 'running', { providerTaskId: 'remote-fail' });

            poller = new TaskPoller({ registry, maxRetries: 3 });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('failed');
            expect(updated.error_message).toBe('内容审核不通过');
            expect(updated.retry_count).toBe(1);
        });

        it('任务失败且已达重试上限时不再增加 retry_count', async () => {
            const stubProvider = createStubProvider('stub', {
                getStatus: vi.fn().mockResolvedValue({
                    status: 'failed',
                    errorMessage: '持续失败',
                }),
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test' });
            // 模拟已重试 3 次
            updateTaskStatus(task.id, 'running', { providerTaskId: 'remote-max' });
            updateTaskStatus(task.id, 'running', { incrementRetry: true });
            updateTaskStatus(task.id, 'running', { incrementRetry: true });
            updateTaskStatus(task.id, 'running', { incrementRetry: true });

            poller = new TaskPoller({ registry, maxRetries: 3 });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('failed');
            expect(updated.retry_count).toBe(3); // 不再增加
        });
    });

    describe('poll - 并发安全', () => {
        it('同时调用 poll 不应重叠执行', async () => {
            let callCount = 0;
            const slowGetStatus = vi.fn().mockImplementation(async () => {
                callCount++;
                await new Promise((r) => setTimeout(r, 50));
                return { status: 'running' as const };
            });
            const stubProvider = createStubProvider('stub', {
                getStatus: slowGetStatus,
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test' });
            updateTaskStatus(task.id, 'pending', { providerTaskId: 'remote-cc' });

            poller = new TaskPoller({ registry });
            // 同时发起两个 poll
            const [r1, r2] = await Promise.all([poller.poll(), poller.poll()]);

            // 只有一个 poll 实际执行了
            expect(callCount).toBe(1);
        });
    });

    describe('poll - provider getStatus 异常', () => {
        it('getStatus 抛出异常时不应导致任务被标记 failed', async () => {
            const stubProvider = createStubProvider('stub', {
                getStatus: vi.fn().mockRejectedValue(new Error('API 超时')),
            });
            registry.register(stubProvider);

            const task = insertTask({ provider: 'stub', prompt: 'test' });
            updateTaskStatus(task.id, 'running', { providerTaskId: 'remote-err' });

            poller = new TaskPoller({ registry });
            await poller.poll();

            // 任务状态不变，等待下次轮询重试
            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('running');
        });
    });
});
