import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VideoProvider } from '../src/server/provider.js';
import { AIHubMixProvider } from '../src/server/providers/aihubmix-provider.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock openai module
const mockVideosCreate = vi.fn();
const mockVideosRetrieve = vi.fn();
const mockVideosDownloadContent = vi.fn();

vi.mock('openai', () => {
    return {
        default: class MockOpenAI {
            videos = {
                create: mockVideosCreate,
                retrieve: mockVideosRetrieve,
                downloadContent: mockVideosDownloadContent,
            };
            constructor(public opts: Record<string, unknown>) {}
        },
    };
});

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        body: null,
    } as unknown as Response;
}

describe('AIHubMixProvider', () => {
    let provider: AIHubMixProvider;
    const apiKey = 'test-aihubmix-api-key-123';

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AIHubMixProvider({ apiKey });
    });

    it('应实现 VideoProvider 接口', () => {
        const p: VideoProvider = provider;
        expect(p.name).toBe('aihubmix');
        expect(p.displayName).toBe('AIHubMix');
        expect(typeof p.createTask).toBe('function');
        expect(typeof p.getStatus).toBe('function');
        expect(typeof p.downloadVideo).toBe('function');
    });

    it('应包含静态备用模型', () => {
        expect(provider.models.length).toBeGreaterThan(0);
    });

    describe('getSettingsSchema', () => {
        it('应返回 API Key 设置项', () => {
            const schema = provider.getSettingsSchema();
            expect(schema.length).toBeGreaterThanOrEqual(1);
            const apiKeySetting = schema.find((s) => s.key === 'api_key');
            expect(apiKeySetting).toBeDefined();
            expect(apiKeySetting!.secret).toBe(true);
            expect(apiKeySetting!.required).toBe(true);
        });

        it('不应暴露 App Code 设置项', () => {
            const schema = provider.getSettingsSchema();
            const appCodeSetting = schema.find((s) => s.key === 'app_code');
            expect(appCodeSetting).toBeUndefined();
        });

        it('应包含接入方式设置项', () => {
            const schema = provider.getSettingsSchema();
            const modeSetting = schema.find((s) => s.key === 'api_mode');
            expect(modeSetting).toBeDefined();
            expect(modeSetting!.options).toBeDefined();
            expect(modeSetting!.options!.length).toBe(2);
            expect(modeSetting!.options!.some(o => o.value === 'direct')).toBe(true);
            expect(modeSetting!.options!.some(o => o.value === 'openai_sdk')).toBe(true);
        });
    });

    describe('applySettings / getCurrentSettings', () => {
        it('应正确应用并脱敏展示 API Key', () => {
            provider.applySettings({ api_key: 'sk-new-long-api-key-here' });
            const current = provider.getCurrentSettings();
            expect(current.api_key).toContain('****');
            expect(current.api_key).not.toBe('sk-new-long-api-key-here');
        });

        it('getCurrentSettings 不应包含 app_code', () => {
            const current = provider.getCurrentSettings();
            expect(current).not.toHaveProperty('app_code');
        });

        it('应加载缓存的模型列表', () => {
            const cachedModels = [
                { model_id: 'custom-model', types: 'video', input_modalities: 'text' },
            ];
            provider.applySettings({
                api_key: apiKey,
                _cached_models: JSON.stringify(cachedModels),
                _models_updated_at: new Date().toISOString(),
            });
            const models = provider.getModelsInfo();
            expect(models.some((m) => m.id === 'custom-model')).toBe(true);
        });

        it('应正确应用 API 接入方式设置', () => {
            provider.applySettings({ api_key: apiKey, api_mode: 'openai_sdk' });
            const current = provider.getCurrentSettings();
            expect(current.api_mode).toBe('openai_sdk');
        });

        it('默认 API 接入方式为 openai_sdk', () => {
            const current = provider.getCurrentSettings();
            expect(current.api_mode).toBe('openai_sdk');
        });
    });

    describe('API 接入方式', () => {
        it('直接接入模式应在请求头中包含 APP-Code', async () => {
            provider.applySettings({ api_key: apiKey, api_mode: 'direct' });

            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-direct', status: 'in_progress' }),
            );

            await provider.createTask({ prompt: 'test', model: 'wan2.6-t2v' });

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe('https://aihubmix.com/v1/videos');
            expect(options.headers['APP-Code']).toBe('ATUH2466');
        });

        it('OpenAI SDK 模式应通过 videos.create 创建任务', async () => {

            mockVideosCreate.mockResolvedValueOnce({
                id: 'task-sdk',
                status: 'in_progress',
                model: 'wan2.6-t2v',
                prompt: 'test',
                seconds: '5',
                size: '1280x720',
                created_at: 0,
                completed_at: null,
                error: null,
                expires_at: null,
                object: 'video',
                progress: 0,
                remixed_from_video_id: null,
            });

            const result = await provider.createTask({ prompt: 'test', model: 'wan2.6-t2v', extra: { seconds: '5' } });
            expect(result.providerTaskId).toBe('task-sdk');
            expect(mockVideosCreate).toHaveBeenCalledOnce();
            expect(mockFetch).not.toHaveBeenCalled();

            const callParams = mockVideosCreate.mock.calls[0][0];
            expect(callParams.model).toBe('wan2.6-t2v');
            expect(callParams.prompt).toBe('test');
            expect(callParams.seconds).toBe('5');
        });

        it('OpenAI SDK 模式图生视频应使用 image_url 格式', async () => {

            mockVideosCreate.mockResolvedValueOnce({
                id: 'task-sdk-i2v',
                status: 'in_progress',
                model: 'wan2.6-i2v',
                prompt: 'animate',
                seconds: '5',
                size: '1280x720',
                created_at: 0,
                completed_at: null,
                error: null,
                expires_at: null,
                object: 'video',
                progress: 0,
                remixed_from_video_id: null,
            });

            await provider.createTask({
                prompt: 'animate',
                model: 'wan2.6-i2v',
                imageUrl: 'https://example.com/image.jpg',
            });

            const callParams = mockVideosCreate.mock.calls[0][0];
            expect(callParams.input_reference).toEqual({ image_url: 'https://example.com/image.jpg' });
        });

        it('OpenAI SDK 模式 getStatus 应调用 SDK 的 videos.retrieve', async () => {

            mockVideosRetrieve.mockResolvedValueOnce({
                id: 'task-123',
                status: 'completed',
                error: null,
                model: 'wan2.6-t2v',
                prompt: 'test',
                seconds: '5',
                size: '1280x720',
                created_at: 0,
                completed_at: 1000,
                expires_at: null,
                object: 'video',
                progress: 100,
                remixed_from_video_id: null,
            });

            const result = await provider.getStatus('task-123');
            expect(result.status).toBe('success');
            expect(result.videoUrl).toBe('https://aihubmix.com/v1/videos/task-123/content');
            expect(mockVideosRetrieve).toHaveBeenCalledWith('task-123');
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('OpenAI SDK 模式 downloadVideo 应调用 SDK 的 videos.downloadContent', async () => {

            const mockReader = {
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                    .mockResolvedValueOnce({ done: true, value: undefined }),
            };
            const mockBody = { getReader: () => mockReader };
            mockVideosDownloadContent.mockResolvedValueOnce({
                body: mockBody,
            });

            await provider.downloadVideo(
                'https://aihubmix.com/v1/videos/task-456/content',
                '/tmp/test-video.mp4',
            );

            expect(mockVideosDownloadContent).toHaveBeenCalledWith('task-456');
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });

    describe('getModelsInfo', () => {
        it('应返回静态备用模型（无缓存时）', () => {
            const models = provider.getModelsInfo();
            expect(models.length).toBeGreaterThan(0);
            // 文档中定义的已知模型
            const wan26 = models.find((m) => m.id === 'wan2.6-t2v');
            expect(wan26).toBeDefined();
            expect(wan26!.capabilities!.i2v).toBe(false);

            const wan26i2v = models.find((m) => m.id === 'wan2.6-i2v');
            expect(wan26i2v).toBeDefined();
            expect(wan26i2v!.capabilities!.i2v).toBe(true);
        });

        it('已知模型应有正确的分辨率配置', () => {
            const models = provider.getModelsInfo();
            const sora2 = models.find((m) => m.id === 'sora-2');
            expect(sora2).toBeDefined();
            expect(sora2!.capabilities!.resolutions).toContain('1280x720');
            expect(sora2!.capabilities!.durationRange).toEqual([4, 12]);
        });

        it('SDK 模式下 Veo 系列模型应被禁用', () => {
            // 默认就是 openai_sdk 模式
            const models = provider.getModelsInfo();
            const veoModels = models.filter((m) => m.id.startsWith('veo-'));
            expect(veoModels.length).toBeGreaterThan(0);
            for (const m of veoModels) {
                expect(m.disabled).toBe(true);
                expect(m.disabledReason).toContain('直接接入');
            }
        });

        it('直接接入模式下 Veo 系列模型不应被禁用', () => {
            provider.applySettings({ api_key: apiKey, api_mode: 'direct' });
            const models = provider.getModelsInfo();
            const veoModels = models.filter((m) => m.id.startsWith('veo-'));
            expect(veoModels.length).toBeGreaterThan(0);
            for (const m of veoModels) {
                expect(m.disabled).toBeFalsy();
            }
        });
    });

    describe('createTask', () => {
        beforeEach(() => {
            provider.applySettings({ api_key: apiKey, api_mode: 'direct' });
        });

        it('应使用文生视频提交任务', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'eyJtb2RlbCI6IndhbjI...', status: 'in_progress' }),
            );

            const result = await provider.createTask({
                prompt: '一只猫在钢琴上弹奏爵士乐',
                model: 'wan2.6-t2v',
                extra: { seconds: '5', size: '1280x720' },
            });

            expect(result.providerTaskId).toBe('eyJtb2RlbCI6IndhbjI...');
            expect(mockFetch).toHaveBeenCalledOnce();

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe('https://aihubmix.com/v1/videos');
            expect(options.method).toBe('POST');
            expect(options.headers['Authorization']).toBe(`Bearer ${apiKey}`);
            expect(options.headers['Content-Type']).toBe('application/json');
            expect(options.headers['APP-Code']).toBe('ATUH2466');

            const body = JSON.parse(options.body);
            expect(body.model).toBe('wan2.6-t2v');
            expect(body.prompt).toBe('一只猫在钢琴上弹奏爵士乐');
            expect(body.seconds).toBe('5');
            expect(body.size).toBe('1280x720');
            expect(body.input_reference).toBeUndefined();
        });

        it('应使用图生视频提交任务（input_reference）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-i2v-123', status: 'in_progress' }),
            );

            const result = await provider.createTask({
                prompt: '让画面中的人物动起来',
                model: 'wan2.6-i2v',
                imageUrl: 'https://example.com/image.jpg',
                extra: { seconds: '5', size: '1280x720' },
            });

            expect(result.providerTaskId).toBe('task-i2v-123');
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.input_reference).toBe('https://example.com/image.jpg');
        });

        it('base64 图片应转为对象格式 {mime_type, data}', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-b64', status: 'in_progress' }),
            );

            await provider.createTask({
                prompt: 'animate',
                model: 'wan2.6-i2v',
                imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANS',
                extra: { seconds: '5' },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.input_reference).toEqual({
                mime_type: 'image/png',
                data: 'iVBORw0KGgoAAAANS',
            });
        });

        it('URL 图片应直接传字符串', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-url', status: 'in_progress' }),
            );

            await provider.createTask({
                prompt: 'animate',
                model: 'sora-2',
                imageUrl: 'https://example.com/image.jpg',
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.input_reference).toBe('https://example.com/image.jpg');
        });

        it('应将数字 duration 转为字符串 seconds', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-dur', status: 'in_progress' }),
            );

            await provider.createTask({
                prompt: 'test',
                model: 'wan2.6-t2v',
                extra: { duration: 8, resolution: '1280x720' },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.seconds).toBe('8');
            expect(body.size).toBe('1280x720');
        });

        it('应在 API 错误时抛出异常', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ error: { message: 'Invalid API key' } }, 401),
            );

            await expect(
                provider.createTask({ prompt: 'test', model: 'wan2.6-t2v' }),
            ).rejects.toThrow('AIHubMix createTask 失败');
        });
    });

    describe('getStatus', () => {
        beforeEach(() => {
            provider.applySettings({ api_key: apiKey, api_mode: 'direct' });
        });

        it('应正确映射 in_progress 状态', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-123', status: 'in_progress' }),
            );

            const result = await provider.getStatus('task-123');
            expect(result.status).toBe('running');
        });

        it('应正确映射 queued 状态', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-123', status: 'queued' }),
            );

            const result = await provider.getStatus('task-123');
            expect(result.status).toBe('pending');
        });

        it('应在 completed 时始终使用自构建的 videoUrl（忽略响应中的 url）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'task-123',
                    status: 'completed',
                    url: 'https://api.openai.com/v1/videos/task-123/content',
                }),
            );

            const result = await provider.getStatus('task-123');
            expect(result.status).toBe('success');
            expect(result.videoUrl).toBe('https://aihubmix.com/v1/videos/task-123/content');
        });

        it('应在 completed 时自动构建 videoUrl（响应不含 url）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'task-abc', status: 'completed' }),
            );

            const result = await provider.getStatus('task-abc');
            expect(result.status).toBe('success');
            expect(result.videoUrl).toBe('https://aihubmix.com/v1/videos/task-abc/content');
        });

        it('应在 failed 时返回错误信息', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'task-123',
                    status: 'failed',
                    error: { message: 'Content moderation failed' },
                }),
            );

            const result = await provider.getStatus('task-123');
            expect(result.status).toBe('failed');
            expect(result.errorMessage).toBe('Content moderation failed');
        });

        it('应处理 error 为字符串的情况', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'task-123',
                    status: 'failed',
                    error: 'Something went wrong',
                }),
            );

            const result = await provider.getStatus('task-123');
            expect(result.status).toBe('failed');
            expect(result.errorMessage).toBe('Something went wrong');
        });

        it('应在 API 错误时抛出异常', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ error: { message: 'Unauthorized' } }, 401),
            );

            await expect(provider.getStatus('task-123')).rejects.toThrow(
                'AIHubMix getStatus 失败',
            );
        });
    });

    describe('downloadVideo', () => {
        beforeEach(() => {
            provider.applySettings({ api_key: apiKey, api_mode: 'direct' });
        });

        it('应携带 Authorization 和 APP-Code 头下载视频', async () => {
            const mockReader = {
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
                    .mockResolvedValueOnce({ done: true, value: undefined }),
            };
            const mockBody = { getReader: () => mockReader };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: mockBody,
            } as unknown as Response);

            await expect(
                provider.downloadVideo(
                    'https://aihubmix.com/v1/videos/task-123/content',
                    '/tmp/test-video.mp4',
                ),
            ).resolves.toBeUndefined();

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe('https://aihubmix.com/v1/videos/task-123/content');
            expect(options.headers['Authorization']).toBe(`Bearer ${apiKey}`);
            expect(options.headers['APP-Code']).toBe('ATUH2466');
        });
    });

    describe('refreshModels', () => {
        it('应从 API 获取并缓存模型列表', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    success: true,
                    data: [
                        { model_id: 'wan2.6-t2v', types: 'video', input_modalities: 'text' },
                        { model_id: 'wan2.6-i2v', types: 'video', input_modalities: 'text,image' },
                        { model_id: 'new-model-xyz', types: 'video', input_modalities: 'text' },
                    ],
                }),
            );

            const models = await provider.refreshModels();
            expect(models.length).toBe(3);
            expect(models.some((m) => m.id === 'wan2.6-t2v')).toBe(true);
            expect(models.some((m) => m.id === 'new-model-xyz')).toBe(true);

            // 已知模型应有详细的 capabilities
            const wan26 = models.find((m) => m.id === 'wan2.6-t2v')!;
            expect(wan26.capabilities).toBeDefined();
            expect(wan26.capabilities!.resolutions.length).toBeGreaterThan(0);

            // 未知模型应有基础 capabilities
            const newModel = models.find((m) => m.id === 'new-model-xyz')!;
            expect(newModel.capabilities).toBeDefined();
            expect(newModel.capabilities!.i2v).toBe(false);
        });

        it('应根据 input_modalities 推断图生视频能力', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    success: true,
                    data: [
                        { model_id: 'unknown-i2v', types: 'video', input_modalities: 'text,image' },
                    ],
                }),
            );

            const models = await provider.refreshModels();
            const model = models.find((m) => m.id === 'unknown-i2v')!;
            expect(model.capabilities!.i2v).toBe(true);
        });

        it('刷新后 getModelsInfo 应返回新模型', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    success: true,
                    data: [
                        { model_id: 'refreshed-model', types: 'video', input_modalities: 'text' },
                    ],
                }),
            );

            await provider.refreshModels();
            const models = provider.getModelsInfo();
            expect(models.some((m) => m.id === 'refreshed-model')).toBe(true);
        });

        it('应在 API 错误时抛出异常', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ success: false, message: 'error' }, 500),
            );

            await expect(provider.refreshModels()).rejects.toThrow();
        });
    });

    describe('needsModelRefresh', () => {
        it('无缓存时应需要刷新', () => {
            expect(provider.needsModelRefresh()).toBe(true);
        });

        it('缓存新鲜时不需要刷新', () => {
            provider.applySettings({
                api_key: apiKey,
                _cached_models: JSON.stringify([
                    { model_id: 'test', types: 'video' },
                ]),
                _models_updated_at: new Date().toISOString(),
            });
            expect(provider.needsModelRefresh()).toBe(false);
        });

        it('缓存超过1天应需要刷新', () => {
            const staleDate = new Date();
            staleDate.setDate(staleDate.getDate() - 2);
            provider.applySettings({
                api_key: apiKey,
                _cached_models: JSON.stringify([
                    { model_id: 'test', types: 'video' },
                ]),
                _models_updated_at: staleDate.toISOString(),
            });
            expect(provider.needsModelRefresh()).toBe(true);
        });
    });

    describe('getCacheData', () => {
        it('刷新后应返回可持久化的缓存数据', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    success: true,
                    data: [
                        { model_id: 'model-a', types: 'video', input_modalities: 'text' },
                    ],
                }),
            );

            await provider.refreshModels();
            const cache = provider.getCacheData();
            expect(cache).toBeDefined();
            expect(cache!._cached_models).toBeDefined();
            expect(cache!._models_updated_at).toBeDefined();

            const parsed = JSON.parse(cache!._cached_models);
            expect(parsed).toBeInstanceOf(Array);
            expect(parsed[0].model_id).toBe('model-a');
        });
    });
});
