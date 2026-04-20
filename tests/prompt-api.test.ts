import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { initDb, closeDb } from '../src/server/database.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { createTaskRouter } from '../src/server/task-router.js';
import { initSystemPrompts, createPrompt, SYSTEM_PROMPTS } from '../src/server/prompt-model.js';
import type { VideoProvider } from '../src/server/provider.js';

function createMockProvider(): VideoProvider {
    return {
        name: 'mock',
        displayName: 'Mock',
        models: ['model-a'],
        createTask: vi.fn().mockResolvedValue({ providerTaskId: 'prov-123' }),
        getStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
        downloadVideo: vi.fn().mockResolvedValue(undefined),
        getSettingsSchema: vi.fn().mockReturnValue([]),
        getModelsInfo: vi.fn().mockReturnValue([{ id: 'model-a', displayName: 'Model A' }]),
        applySettings: vi.fn(),
        getCurrentSettings: vi.fn().mockReturnValue({}),
    };
}

function setupApp() {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider());
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(registry));
    return app;
}

describe('Prompt API 路由', () => {
    let app: ReturnType<typeof express>;

    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        initSystemPrompts();
        app = setupApp();
    });

    // ── GET /api/prompts ──────────────────

    describe('GET /api/prompts', () => {
        it('返回所有 Prompt（含系统预置）', async () => {
            const res = await request(app).get('/api/prompts');
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(SYSTEM_PROMPTS.length);
            expect(res.body[0].is_system).toBe(true);
        });

        it('支持搜索', async () => {
            createPrompt({ name: '自定义测试', content: '${input}' });
            const res = await request(app).get('/api/prompts').query({ q: '自定义' });
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            expect(res.body[0].name).toBe('自定义测试');
        });
    });

    // ── POST /api/prompts ──────────────────

    describe('POST /api/prompts', () => {
        it('创建自定义 Prompt', async () => {
            const res = await request(app)
                .post('/api/prompts')
                .send({ name: '新建', content: '内容 ${input} ${lang}', tags: ['标签'] });
            expect(res.status).toBe(201);
            expect(res.body.prompt.name).toBe('新建');
            expect(res.body.prompt.is_system).toBe(false);
            expect(res.body.warnings).toEqual([]);
        });

        it('缺少 ${input} 占位符时报错', async () => {
            const res = await request(app)
                .post('/api/prompts')
                .send({ name: 'Bad', content: '无占位符的内容' });
            expect(res.status).toBe(400);
        });

        it('缺少 ${lang} 时返回警告', async () => {
            const res = await request(app)
                .post('/api/prompts')
                .send({ name: 'No Lang', content: '内容 ${input}' });
            expect(res.status).toBe(201);
            expect(res.body.warnings.length).toBeGreaterThan(0);
        });

        it('缺少 name 时报错', async () => {
            const res = await request(app)
                .post('/api/prompts')
                .send({ content: '${input}' });
            expect(res.status).toBe(400);
        });
    });

    // ── PUT /api/prompts/:id ──────────────────

    describe('PUT /api/prompts/:id', () => {
        it('更新自定义 Prompt', async () => {
            const prompt = createPrompt({ name: '原始', content: '${input}' });
            const res = await request(app)
                .put(`/api/prompts/${prompt.id}`)
                .send({ name: '更新后', content: '新内容 ${input} ${lang}' });
            expect(res.status).toBe(200);
            expect(res.body.prompt.name).toBe('更新后');
        });

        it('不能更新系统 Prompt', async () => {
            const res = await request(app).get('/api/prompts');
            const systemPrompt = res.body.find((p: { is_system: boolean }) => p.is_system);
            const updateRes = await request(app)
                .put(`/api/prompts/${systemPrompt.id}`)
                .send({ name: '修改系统' });
            expect(updateRes.status).toBe(403);
        });

        it('更新不存在的 Prompt 返回 404', async () => {
            const res = await request(app)
                .put('/api/prompts/9999')
                .send({ name: '不存在' });
            expect(res.status).toBe(404);
        });
    });

    // ── DELETE /api/prompts/:id ──────────────────

    describe('DELETE /api/prompts/:id', () => {
        it('删除自定义 Prompt', async () => {
            const prompt = createPrompt({ name: '待删除', content: '${input}' });
            const res = await request(app).delete(`/api/prompts/${prompt.id}`);
            expect(res.status).toBe(200);
        });

        it('不能删除系统 Prompt', async () => {
            const listRes = await request(app).get('/api/prompts');
            const systemPrompt = listRes.body.find((p: { is_system: boolean }) => p.is_system);
            const res = await request(app).delete(`/api/prompts/${systemPrompt.id}`);
            expect(res.status).toBe(403);
        });

        it('删除不存在的 Prompt 返回 404', async () => {
            const res = await request(app).delete('/api/prompts/9999');
            expect(res.status).toBe(404);
        });

        it('删除全局默认 Prompt 时自动清空默认设置', async () => {
            const prompt = createPrompt({ name: 'Default', content: '${input}' });
            // 先设为默认
            await request(app)
                .put('/api/prompts/config/default')
                .send({ promptId: prompt.id });
            // 删除
            await request(app).delete(`/api/prompts/${prompt.id}`);
            // 检查默认已清空
            const defaultRes = await request(app).get('/api/prompts/config/default');
            expect(defaultRes.body.defaultPromptId).toBeNull();
        });
    });

    // ── GET/PUT /api/prompts/config/default ──────────────────

    describe('默认 Prompt 配置', () => {
        it('初始无默认 Prompt', async () => {
            const res = await request(app).get('/api/prompts/config/default');
            expect(res.status).toBe(200);
            expect(res.body.defaultPromptId).toBeNull();
        });

        it('设置默认 Prompt', async () => {
            const prompt = createPrompt({ name: 'Default', content: '${input}' });
            const res = await request(app)
                .put('/api/prompts/config/default')
                .send({ promptId: prompt.id });
            expect(res.status).toBe(200);

            const getRes = await request(app).get('/api/prompts/config/default');
            expect(getRes.body.defaultPromptId).toBe(prompt.id);
        });

        it('清空默认 Prompt', async () => {
            const prompt = createPrompt({ name: 'Default', content: '${input}' });
            await request(app)
                .put('/api/prompts/config/default')
                .send({ promptId: prompt.id });
            await request(app)
                .put('/api/prompts/config/default')
                .send({ promptId: null });

            const getRes = await request(app).get('/api/prompts/config/default');
            expect(getRes.body.defaultPromptId).toBeNull();
        });

        it('设置不存在的 Prompt 为默认时返回 404', async () => {
            const res = await request(app)
                .put('/api/prompts/config/default')
                .send({ promptId: 9999 });
            expect(res.status).toBe(404);
        });
    });

    // ── 目录 API ──────────────────

    describe('Prompt 目录 API', () => {
        it('GET /api/prompt-folders 返回空列表', async () => {
            const res = await request(app).get('/api/prompt-folders');
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it('POST /api/prompt-folders 创建目录', async () => {
            const res = await request(app)
                .post('/api/prompt-folders')
                .send({ name: '新目录' });
            expect(res.status).toBe(201);
            expect(res.body.name).toBe('新目录');
        });

        it('PUT /api/prompt-folders/:id 重命名目录', async () => {
            const createRes = await request(app)
                .post('/api/prompt-folders')
                .send({ name: '旧名' });
            const res = await request(app)
                .put(`/api/prompt-folders/${createRes.body.id}`)
                .send({ name: '新名' });
            expect(res.status).toBe(200);
        });

        it('DELETE /api/prompt-folders/:id 删除目录', async () => {
            const createRes = await request(app)
                .post('/api/prompt-folders')
                .send({ name: '待删除' });
            const res = await request(app)
                .delete(`/api/prompt-folders/${createRes.body.id}`);
            expect(res.status).toBe(200);
        });

        it('创建目录时缺少名称报错', async () => {
            const res = await request(app)
                .post('/api/prompt-folders')
                .send({});
            expect(res.status).toBe(400);
        });
    });
});
