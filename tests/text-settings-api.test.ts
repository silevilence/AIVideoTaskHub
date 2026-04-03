import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { initDb } from '../src/server/database.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { MockProvider } from '../src/server/providers/mock-provider.js';
import {
    saveTextProviders,
    savePromptTemplate,
    getTextSettings,
    type TextProviderConfig,
} from '../src/server/text-settings.js';

describe('text-settings API routes', () => {
    let app: ReturnType<typeof createApp>;

    beforeEach(() => {
        initDb(':memory:');
        const registry = new ProviderRegistry();
        registry.register(new MockProvider());
        app = createApp(registry);
    });

    // ── GET /api/text-settings ──────────────────────────

    describe('GET /api/text-settings', () => {
        it('返回默认文本设置', async () => {
            const res = await request(app).get('/api/text-settings');
            expect(res.status).toBe(200);
            expect(res.body.providers).toEqual([]);
            expect(res.body.streaming).toBe(false);
            expect(res.body.promptLanguage).toBe('中文');
            expect(res.body.presetProviders).toHaveLength(4);
        });

        it('返回已保存的提供商', async () => {
            saveTextProviders([
                {
                    name: 'deepseek',
                    displayName: 'DeepSeek',
                    baseUrl: 'https://api.deepseek.com',
                    apiKey: 'sk-test',
                    apiKeySource: 'own',
                    models: [],
                    isPreset: true,
                    type: 'openai',
                },
            ]);
            const res = await request(app).get('/api/text-settings');
            expect(res.body.providers).toHaveLength(1);
            expect(res.body.providers[0].name).toBe('deepseek');
        });
    });

    // ── PUT /api/text-settings ──────────────────────────

    describe('PUT /api/text-settings', () => {
        it('更新流式设置', async () => {
            const res = await request(app)
                .put('/api/text-settings')
                .send({ streaming: true });
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(getTextSettings().streaming).toBe(true);
        });

        it('更新语言设置', async () => {
            const res = await request(app)
                .put('/api/text-settings')
                .send({ promptLanguage: 'English' });
            expect(res.status).toBe(200);
            expect(getTextSettings().promptLanguage).toBe('English');
        });

        it('更新提供商列表', async () => {
            const providers: TextProviderConfig[] = [
                {
                    name: 'test',
                    displayName: 'Test',
                    baseUrl: 'https://test.com',
                    apiKey: 'sk-test',
                    apiKeySource: 'own',
                    models: [],
                    isPreset: false,
                    type: 'openai',
                },
            ];
            const res = await request(app)
                .put('/api/text-settings')
                .send({ providers });
            expect(res.status).toBe(200);
            expect(getTextSettings().providers).toHaveLength(1);
        });

        it('保存无 input 占位符的模板返回 400', async () => {
            const res = await request(app)
                .put('/api/text-settings')
                .send({ promptTemplate: '没有占位符的模板' });
            expect(res.status).toBe(400);
        });

        it('保存有 input 占位符的模板成功', async () => {
            const res = await request(app)
                .put('/api/text-settings')
                .send({ promptTemplate: '优化: ${input}' });
            expect(res.status).toBe(200);
        });
    });

    // ── Model Language overrides ──────────────────────────

    describe('model language overrides', () => {
        it('GET 获取语言覆盖', async () => {
            const res = await request(app)
                .get('/api/text-settings/model-languages')
                .query({ videoProvider: 'volcengine', modelId: 'model-1' });
            expect(res.status).toBe(200);
            expect(res.body.language).toBeNull();
        });

        it('PUT 设置语言覆盖', async () => {
            await request(app)
                .put('/api/text-settings/model-languages')
                .send({ videoProvider: 'volcengine', modelId: 'model-1', language: 'English' });

            const res = await request(app)
                .get('/api/text-settings/model-languages')
                .query({ videoProvider: 'volcengine', modelId: 'model-1' });
            expect(res.body.language).toBe('English');
        });

        it('PUT 清除语言覆盖', async () => {
            await request(app)
                .put('/api/text-settings/model-languages')
                .send({ videoProvider: 'volcengine', modelId: 'model-1', language: 'English' });
            await request(app)
                .put('/api/text-settings/model-languages')
                .send({ videoProvider: 'volcengine', modelId: 'model-1', language: '' });

            const res = await request(app)
                .get('/api/text-settings/model-languages')
                .query({ videoProvider: 'volcengine', modelId: 'model-1' });
            expect(res.body.language).toBeNull();
        });
    });

    // ── POST /api/prompt/optimize ──────────────────────────

    describe('POST /api/prompt/optimize', () => {
        it('缺少 input 返回 400', async () => {
            const res = await request(app)
                .post('/api/prompt/optimize')
                .send({ providerName: 'test', modelId: 'model' });
            expect(res.status).toBe(400);
        });

        it('缺少 providerName 返回 400', async () => {
            const res = await request(app)
                .post('/api/prompt/optimize')
                .send({ input: '一只猫', modelId: 'model' });
            expect(res.status).toBe(400);
        });

        it('未配置提供商返回 400', async () => {
            const res = await request(app)
                .post('/api/prompt/optimize')
                .send({ input: '一只猫', providerName: 'nonexistent', modelId: 'model' });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('未配置');
        });

        it('提供商无 API Key 返回 400', async () => {
            saveTextProviders([
                {
                    name: 'test',
                    displayName: 'Test',
                    baseUrl: 'https://test.com',
                    apiKey: '',
                    apiKeySource: 'own',
                    models: [],
                    isPreset: false,
                    type: 'openai',
                },
            ]);
            const res = await request(app)
                .post('/api/prompt/optimize')
                .send({ input: '一只猫', providerName: 'test', modelId: 'model' });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('API Key');
        });
    });

    // ── POST /api/text-settings/fetch-models ──────────────────────────

    describe('POST /api/text-settings/fetch-models', () => {
        it('无 baseUrl 且无已保存 providerName 时返回 400', async () => {
            const res = await request(app)
                .post('/api/text-settings/fetch-models')
                .send({});
            expect(res.status).toBe(400);
        });

        it('传 baseUrl + apiKeySource=video:xxx 但无视频 API Key 时返回 400', async () => {
            const res = await request(app)
                .post('/api/text-settings/fetch-models')
                .send({
                    providerName: 'volcengine-text',
                    baseUrl: 'https://ark.cn-beijing.volces.com/api',
                    apiKeySource: 'video:volcengine',
                    apiKey: '',
                });
            expect(res.status).toBe(400);
        });
    });

    // ── POST /api/prompt/optimize/abort ──────────────────────────

    describe('POST /api/prompt/optimize/abort', () => {
        it('无活跃请求时也可调用', async () => {
            const res = await request(app)
                .post('/api/prompt/optimize/abort')
                .send({});
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });
    });
});
