import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.js';
import { initDb } from '../src/server/database.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { MockProvider } from '../src/server/providers/mock-provider.js';
import fs from 'fs';
import path from 'path';
import {
    saveTextProviders,
    savePromptTemplate,
    getTextSettings,
    type TextProviderConfig,
} from '../src/server/text-settings.js';

// Mock LLM 客户端，捕获实际调用参数验证图片路径解析
const mockCallLLM = vi.hoisted(() =>
    vi.fn().mockResolvedValue({ content: '优化结果', finishReason: 'stop' })
);
vi.mock('../src/server/llm-client.js', () => ({
    callLLM: mockCallLLM,
    callLLMStream: vi.fn(),
    fetchLLMModels: vi.fn().mockResolvedValue([]),
}));

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

        it('策略 A：/uploads/ 路径自动转为 base64 再发送给 LLM', async () => {
            // 准备测试图片
            const testDir = path.resolve(process.env.DATA_DIR || 'data', 'uploads');
            fs.mkdirSync(testDir, { recursive: true });
            const testFile = path.join(testDir, 'test-optimize-resolve.png');
            const pngData = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNl7BcQAAAABJRU5ErkJggg==',
                'base64',
            );
            fs.writeFileSync(testFile, pngData);

            // 配置 vision=true 的文本提供商
            const providers: TextProviderConfig[] = [{
                name: 'test-vision',
                displayName: 'TestVision',
                baseUrl: 'https://api.test.com',
                apiKey: 'sk-test',
                apiKeySource: 'own',
                models: [{ id: 'vision-model', displayName: 'Vision', reasoning: false, vision: true }],
                isPreset: false,
                type: 'openai',
            }];
            saveTextProviders(providers);

            try {
                mockCallLLM.mockClear();
                const res = await request(app)
                    .post('/api/prompt/optimize')
                    .send({
                        input: '一只猫',
                        providerName: 'test-vision',
                        modelId: 'vision-model',
                        images: ['/uploads/test-optimize-resolve.png', 'https://example.com/ref.jpg'],
                    });

                expect(res.status).toBe(200);
                // callLLM 应被调用，且第2个 contentPart 的图片 URL 已转为 base64
                const callArgs = mockCallLLM.mock.calls[0][0];
                const contentParts = callArgs.messages[0].content;
                expect(contentParts[1].type).toBe('image_url');
                expect(contentParts[1].image_url.url).toMatch(/^data:image\/png;base64,/);
                // 第3个 contentPart（外部 URL）保持不变
                expect(contentParts[2].image_url.url).toBe('https://example.com/ref.jpg');
            } finally {
                if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
            }
        });

        it('策略 A：纯外部 URL 和 base64 图片不受影响', async () => {
            const providers: TextProviderConfig[] = [{
                name: 'test-vision',
                displayName: 'TestVision',
                baseUrl: 'https://api.test.com',
                apiKey: 'sk-test',
                apiKeySource: 'own',
                models: [{ id: 'vision-model', displayName: 'Vision', reasoning: false, vision: true }],
                isPreset: false,
                type: 'openai',
            }];
            saveTextProviders(providers);

            mockCallLLM.mockClear();
            const res = await request(app)
                .post('/api/prompt/optimize')
                .send({
                    input: '一只猫',
                    providerName: 'test-vision',
                    modelId: 'vision-model',
                    images: ['https://example.com/ref.jpg', 'data:image/png;base64,aGVsbG8='],
                });

            expect(res.status).toBe(200);
            const callArgs = mockCallLLM.mock.calls[0][0];
            const contentParts = callArgs.messages[0].content;
            expect(contentParts[1].image_url.url).toBe('https://example.com/ref.jpg');
            expect(contentParts[2].image_url.url).toBe('data:image/png;base64,aGVsbG8=');
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
