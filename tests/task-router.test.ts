import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { initDb, closeDb } from '../src/server/database.js';
import { insertTask, updateTaskStatus } from '../src/server/task-model.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { createTaskRouter } from '../src/server/task-router.js';
import type { VideoProvider } from '../src/server/provider.js';

function createMockProvider(name = 'mock', models = ['model-a']): VideoProvider {
    return {
        name,
        displayName: name,
        models,
        createTask: vi.fn().mockResolvedValue({ providerTaskId: 'prov-123' }),
        getStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
        downloadVideo: vi.fn().mockResolvedValue(undefined),
        getSettingsSchema: vi.fn().mockReturnValue([]),
        applySettings: vi.fn(),
        getCurrentSettings: vi.fn().mockReturnValue({}),
    };
}

function setupApp(registry: ProviderRegistry) {
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(registry));
    return app;
}

describe('任务路由 API', () => {
    let registry: ProviderRegistry;
    let mockProvider: VideoProvider;
    let app: ReturnType<typeof express>;

    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        mockProvider = createMockProvider();
        registry.register(mockProvider);
        app = setupApp(registry);
    });

    describe('POST /api/tasks', () => {
        it('应创建任务并返回 201', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '一只猫在跳舞' });

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.provider).toBe('mock');
            expect(res.body.prompt).toBe('一只猫在跳舞');
            expect(res.body.status).toBe('pending');
            expect(res.body.provider_task_id).toBe('prov-123');
        });

        it('应调用 provider.createTask 并保存 provider_task_id', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '测试', model: 'test-model' });

            expect(mockProvider.createTask).toHaveBeenCalledWith({
                prompt: '测试',
                model: 'test-model',
                imageUrl: undefined,
            });
            expect(res.body.provider_task_id).toBe('prov-123');
        });

        it('缺少 provider 参数应返回 400', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({ prompt: '测试' });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        it('缺少 prompt 参数应返回 400', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock' });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        it('使用不存在的 provider 应返回 400', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({ provider: 'nonexistent', prompt: '测试' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('nonexistent');
        });

        it('provider.createTask 失败时应返回 500 且任务标记为 failed', async () => {
            (mockProvider.createTask as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('API 调用失败')
            );

            const res = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '测试' });

            expect(res.status).toBe(500);
            expect(res.body).toHaveProperty('error');
        });

        it('应支持 imageUrl 参数', async () => {
            const res = await request(app)
                .post('/api/tasks')
                .send({
                    provider: 'mock',
                    prompt: '让图片动起来',
                    imageUrl: 'https://example.com/img.png',
                });

            expect(res.status).toBe(201);
            expect(res.body.image_url).toBe('https://example.com/img.png');
        });
    });

    describe('GET /api/tasks', () => {
        it('无任务时应返回空数组', async () => {
            const res = await request(app).get('/api/tasks');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('应按创建时间倒序返回所有任务', async () => {
            await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '任务1' });
            await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '任务2' });
            await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '任务3' });

            const res = await request(app).get('/api/tasks');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(3);
            // 倒序：最新的在前
            expect(res.body[0].prompt).toBe('任务3');
            expect(res.body[2].prompt).toBe('任务1');
        });
    });

    describe('GET /api/tasks/:id', () => {
        it('应返回指定任务', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '详情测试' });

            const res = await request(app).get(`/api/tasks/${createRes.body.id}`);
            expect(res.status).toBe(200);
            expect(res.body.prompt).toBe('详情测试');
        });

        it('不存在的 id 应返回 404', async () => {
            const res = await request(app).get('/api/tasks/99999');
            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty('error');
        });

        it('无效 id 格式应返回 400', async () => {
            const res = await request(app).get('/api/tasks/abc');
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
    });

    describe('POST /api/tasks/:id/retry', () => {
        it('应重试 failed 任务并重置为 pending', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '重试测试' });

            // 将任务标记为 failed
            updateTaskStatus(createRes.body.id, 'failed', {
                errorMessage: '模拟失败',
            });

            const res = await request(app).post(
                `/api/tasks/${createRes.body.id}/retry`
            );
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('pending');
        });

        it('非 failed 状态的任务不应允许重试', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '重试测试' });

            const res = await request(app).post(
                `/api/tasks/${createRes.body.id}/retry`
            );
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('failed');
        });

        it('不存在的任务应返回 404', async () => {
            const res = await request(app).post('/api/tasks/99999/retry');
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /api/tasks/:id', () => {
        it('应删除指定任务', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '删除测试' });

            const res = await request(app).delete(
                `/api/tasks/${createRes.body.id}`
            );
            expect(res.status).toBe(204);

            // 确认已删除
            const getRes = await request(app).get(
                `/api/tasks/${createRes.body.id}`
            );
            expect(getRes.status).toBe(404);
        });

        it('不存在的任务应返回 404', async () => {
            const res = await request(app).delete('/api/tasks/99999');
            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/providers', () => {
        it('应返回已注册的 provider 列表', async () => {
            const res = await request(app).get('/api/providers');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ name: 'mock', displayName: 'mock' }]);
        });

        it('注册多个 provider 时应全部返回', async () => {
            const anotherProvider = createMockProvider('siliconflow');
            registry.register(anotherProvider);

            const res = await request(app).get('/api/providers');
            expect(res.status).toBe(200);
            const names = res.body.map((p: { name: string }) => p.name);
            expect(names).toContain('mock');
            expect(names).toContain('siliconflow');
        });
    });

    describe('GET /api/providers/models', () => {
        it('应返回每个 provider 的模型列表', async () => {
            const res = await request(app).get('/api/providers/models');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('mock');
            expect(res.body.mock).toEqual(['model-a']);
        });

        it('多个 provider 应各自返回模型', async () => {
            registry.register(createMockProvider('sf', ['m1', 'm2']));
            const res = await request(app).get('/api/providers/models');
            expect(res.body.sf).toEqual(['m1', 'm2']);
        });
    });

    describe('POST /api/upload', () => {
        it('应成功上传图片并返回 URL', async () => {
            const buf = Buffer.from('fake-png-data');
            const res = await request(app)
                .post('/api/upload')
                .set('Content-Type', 'image/png')
                .send(buf);

            expect(res.status).toBe(200);
            expect(res.body.url).toMatch(/^\/uploads\/[\w-]+\.png$/);
            expect(res.body.base64).toMatch(/^data:image\/png;base64,/);
        });

        it('非图片类型应返回 400', async () => {
            const res = await request(app)
                .post('/api/upload')
                .set('Content-Type', 'application/json')
                .send('{}');

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/settings', () => {
        it('应返回所有 Provider 设置信息', async () => {
            // 注册一个带设置的 provider
            const sfProvider = createMockProvider('siliconflow');
            (sfProvider.getSettingsSchema as ReturnType<typeof vi.fn>).mockReturnValue([
                { key: 'api_key', label: 'API Key', secret: true, required: true },
            ]);
            (sfProvider.getCurrentSettings as ReturnType<typeof vi.fn>).mockReturnValue({ api_key: 'sk-****1234' });
            registry.register(sfProvider);

            const res = await request(app).get('/api/settings');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('siliconflow');
            expect(res.body.siliconflow.schema).toHaveLength(1);
            expect(res.body.siliconflow.values.api_key).toBe('sk-****1234');
        });
    });

    describe('PUT /api/settings/:provider', () => {
        it('应成功更新 Provider 设置', async () => {
            const sfProvider = createMockProvider('siliconflow');
            (sfProvider.getSettingsSchema as ReturnType<typeof vi.fn>).mockReturnValue([
                { key: 'api_key', label: 'API Key', secret: true },
            ]);
            registry.register(sfProvider);

            const res = await request(app)
                .put('/api/settings/siliconflow')
                .send({ api_key: 'sk-test-key' });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(sfProvider.applySettings).toHaveBeenCalledWith({ api_key: 'sk-test-key' });
        });

        it('不存在的 provider 应返回 404', async () => {
            const res = await request(app)
                .put('/api/settings/nonexistent')
                .send({ api_key: 'test' });
            expect(res.status).toBe(404);
        });
    });
});
