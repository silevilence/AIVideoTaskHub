import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '../src/server/providers/mock-provider.js';
import type { VideoProvider, TaskStatusResult } from '../src/server/provider.js';

describe('MockProvider', () => {
    let provider: MockProvider;

    beforeEach(() => {
        // 使用极短的延迟以加速测试
        provider = new MockProvider({ delayMs: 50 });
    });

    it('应实现 VideoProvider 接口', () => {
        const p: VideoProvider = provider;
        expect(p.name).toBe('mock');
        expect(typeof p.createTask).toBe('function');
        expect(typeof p.getStatus).toBe('function');
        expect(typeof p.downloadVideo).toBe('function');
    });

    describe('createTask', () => {
        it('应返回唯一的 providerTaskId', async () => {
            const result = await provider.createTask({
                prompt: '一只猫在跳舞',
            });
            expect(result.providerTaskId).toBeTruthy();
            expect(typeof result.providerTaskId).toBe('string');
        });

        it('多次创建应返回不同的 taskId', async () => {
            const r1 = await provider.createTask({ prompt: 'test1' });
            const r2 = await provider.createTask({ prompt: 'test2' });
            expect(r1.providerTaskId).not.toBe(r2.providerTaskId);
        });
    });

    describe('getStatus', () => {
        it('刚创建的任务状态应为 pending 或 running', async () => {
            const { providerTaskId } = await provider.createTask({
                prompt: '测试状态',
            });
            const status = await provider.getStatus(providerTaskId);
            expect(['pending', 'running']).toContain(status.status);
        });

        it('延迟过后任务状态应变为 success 并带有 videoUrl', async () => {
            const { providerTaskId } = await provider.createTask({
                prompt: '测试完成',
            });

            // 等待超过延迟时间
            await sleep(80);

            const status = await provider.getStatus(providerTaskId);
            expect(status.status).toBe('success');
            expect(status.videoUrl).toBeTruthy();
        });

        it('查询不存在的 taskId 应返回 failed 状态', async () => {
            const status = await provider.getStatus('nonexistent-id');
            expect(status.status).toBe('failed');
            expect(status.errorMessage).toBeTruthy();
        });
    });

    describe('downloadVideo', () => {
        it('应成功完成下载（Mock 模式仅创建空文件）', async () => {
            // Mock 的 downloadVideo 不做真实下载，仅验证不抛异常
            await expect(
                provider.downloadVideo(
                    'https://mock.example.com/video.mp4',
                    '/tmp/test-video.mp4'
                )
            ).resolves.toBeUndefined();
        });
    });

    describe('getModelsInfo', () => {
        it('应返回与 models 一致的模型信息', () => {
            const infos = provider.getModelsInfo();
            expect(infos).toHaveLength(1);
            expect(infos[0].id).toBe('mock-model');
            expect(infos[0].displayName).toBe('mock-model');
        });
    });
});

describe('MockProvider 失败模式', () => {
    it('配置 failRate=1 时任务应最终变为 failed', async () => {
        const provider = new MockProvider({ delayMs: 50, failRate: 1 });
        const { providerTaskId } = await provider.createTask({
            prompt: '测试失败',
        });

        await sleep(80);

        const status = await provider.getStatus(providerTaskId);
        expect(status.status).toBe('failed');
        expect(status.errorMessage).toBeTruthy();
    });
});

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
