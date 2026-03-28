import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VideoProvider } from '../src/server/provider.js';
import { VolcEngineProvider } from '../src/server/providers/volcengine-provider.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        body: null,
    } as unknown as Response;
}

describe('VolcEngineProvider', () => {
    let provider: VolcEngineProvider;
    const apiKey = 'test-volc-api-key-123';

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new VolcEngineProvider({ apiKey });
    });

    it('应实现 VideoProvider 接口', () => {
        const p: VideoProvider = provider;
        expect(p.name).toBe('volcengine');
        expect(p.displayName).toBe('火山引擎 Seedance');
        expect(typeof p.createTask).toBe('function');
        expect(typeof p.getStatus).toBe('function');
        expect(typeof p.downloadVideo).toBe('function');
    });

    it('应包含所有支持的模型', () => {
        expect(provider.models).toContain('doubao-seedance-1-5-pro-251215');
        expect(provider.models).toContain('doubao-seedance-1-0-pro-250528');
        expect(provider.models).toContain('doubao-seedance-1-0-pro-fast-251015');
        expect(provider.models).toContain('doubao-seedance-1-0-lite-t2v-250428');
        expect(provider.models).toContain('doubao-seedance-1-0-lite-i2v-250428');
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
    });

    describe('applySettings / getCurrentSettings', () => {
        it('应正确应用并脱敏展示 API Key', () => {
            provider.applySettings({ api_key: 'sk-new-long-api-key-here' });
            const current = provider.getCurrentSettings();
            expect(current.api_key).toContain('****');
            expect(current.api_key).not.toBe('sk-new-long-api-key-here');
        });
    });

    describe('createTask', () => {
        it('应使用文生视频提交任务', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-20250401-abc123' })
            );

            const result = await provider.createTask({
                prompt: '小猫对着镜头打哈欠',
                model: 'doubao-seedance-1-5-pro-251215',
            });

            expect(result.providerTaskId).toBe('cgt-20250401-abc123');
            expect(mockFetch).toHaveBeenCalledOnce();

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe(
                'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks'
            );
            expect(options.method).toBe('POST');
            expect(options.headers['Authorization']).toBe(`Bearer ${apiKey}`);
            expect(options.headers['Content-Type']).toBe('application/json');

            const body = JSON.parse(options.body);
            expect(body.model).toBe('doubao-seedance-1-5-pro-251215');
            expect(body.content).toEqual([
                { type: 'text', text: '小猫对着镜头打哈欠' },
            ]);
        });

        it('应使用图生视频-首帧模式提交任务', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-20250401-img001' })
            );

            const result = await provider.createTask({
                prompt: '让图片动起来',
                model: 'doubao-seedance-1-0-pro-250528',
                imageUrl: 'https://example.com/first.png',
            });

            expect(result.providerTaskId).toBe('cgt-20250401-img001');

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.content).toEqual(
                expect.arrayContaining([
                    { type: 'text', text: '让图片动起来' },
                    {
                        type: 'image_url',
                        image_url: { url: 'https://example.com/first.png' },
                        role: 'first_frame',
                    },
                ])
            );
        });

        it('应使用图生视频-首尾帧模式提交任务', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-20250401-fl001' })
            );

            await provider.createTask({
                prompt: '场景过渡',
                model: 'doubao-seedance-1-5-pro-251215',
                imageUrl: 'https://example.com/first.png',
                extra: { lastFrameImageUrl: 'https://example.com/last.png' },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const imageItems = body.content.filter(
                (c: { type: string }) => c.type === 'image_url'
            );
            expect(imageItems).toHaveLength(2);
            expect(imageItems[0].role).toBe('first_frame');
            expect(imageItems[1].role).toBe('last_frame');
            expect(imageItems[1].image_url.url).toBe(
                'https://example.com/last.png'
            );
        });

        it('应使用图生视频-参考图模式提交任务', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-20250401-ref001' })
            );

            await provider.createTask({
                prompt: '参考图风格视频',
                model: 'doubao-seedance-1-0-lite-i2v-250428',
                extra: {
                    referenceImageUrls: [
                        'https://example.com/ref1.png',
                        'https://example.com/ref2.png',
                    ],
                },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const imageItems = body.content.filter(
                (c: { type: string }) => c.type === 'image_url'
            );
            expect(imageItems).toHaveLength(2);
            expect(imageItems[0].role).toBe('reference_image');
            expect(imageItems[1].role).toBe('reference_image');
        });

        it('应传递额外参数（resolution, ratio, duration, seed, watermark）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-extra-001' })
            );

            await provider.createTask({
                prompt: '测试视频',
                model: 'doubao-seedance-1-5-pro-251215',
                extra: {
                    resolution: '1080p',
                    ratio: '16:9',
                    duration: 8,
                    seed: 42,
                    watermark: true,
                },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.resolution).toBe('1080p');
            expect(body.ratio).toBe('16:9');
            expect(body.duration).toBe(8);
            expect(body.seed).toBe(42);
            expect(body.watermark).toBe(true);
        });

        it('应传递 return_last_frame 参数', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-lf-001' })
            );

            await provider.createTask({
                prompt: '测试尾帧',
                model: 'doubao-seedance-1-5-pro-251215',
                extra: { returnLastFrame: true },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.return_last_frame).toBe(true);
        });

        it('应传递 generate_audio 参数（仅 Seedance 1.5 pro）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-audio-001' })
            );

            await provider.createTask({
                prompt: '测试音频',
                model: 'doubao-seedance-1-5-pro-251215',
                extra: { generateAudio: false },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.generate_audio).toBe(false);
        });

        it('应传递 camera_fixed 参数', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-cf-001' })
            );

            await provider.createTask({
                prompt: '固定镜头测试',
                model: 'doubao-seedance-1-5-pro-251215',
                extra: { cameraFixed: true },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.camera_fixed).toBe(true);
        });

        it('应传递 service_tier 参数', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-st-001' })
            );

            await provider.createTask({
                prompt: '离线推理测试',
                model: 'doubao-seedance-1-5-pro-251215',
                extra: { serviceTier: 'flex' },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.service_tier).toBe('flex');
        });

        it('应传递 draft 参数（样片模式）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-draft-001' })
            );

            await provider.createTask({
                prompt: '样片测试',
                model: 'doubao-seedance-1-5-pro-251215',
                extra: { draft: true },
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.draft).toBe(true);
        });

        it('API 返回非 200 应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse(
                    { error: { message: 'Unauthorized', code: 'auth_error' } },
                    401
                )
            );

            await expect(
                provider.createTask({
                    prompt: '测试',
                    model: 'doubao-seedance-1-5-pro-251215',
                })
            ).rejects.toThrow();
        });

        it('无 prompt 时只传图片不传 text content', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-noprompt-001' })
            );

            await provider.createTask({
                prompt: '',
                model: 'doubao-seedance-1-0-pro-250528',
                imageUrl: 'https://example.com/first.png',
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const textItems = body.content.filter(
                (c: { type: string }) => c.type === 'text'
            );
            expect(textItems).toHaveLength(0);
        });
    });

    describe('getStatus', () => {
        it('queued 状态应映射为 pending', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-001', status: 'queued', error: null })
            );

            const result = await provider.getStatus('cgt-001');
            expect(result.status).toBe('pending');
        });

        it('running 状态应映射为 running', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-001', status: 'running', error: null })
            );

            const result = await provider.getStatus('cgt-001');
            expect(result.status).toBe('running');
        });

        it('succeeded 状态应映射为 success 并提取 videoUrl', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'cgt-001',
                    status: 'succeeded',
                    error: null,
                    content: {
                        video_url: 'https://cdn.volces.com/video/abc.mp4',
                    },
                })
            );

            const result = await provider.getStatus('cgt-001');
            expect(result.status).toBe('success');
            expect(result.videoUrl).toBe(
                'https://cdn.volces.com/video/abc.mp4'
            );
        });

        it('failed 状态应映射为 failed 并提取错误信息', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'cgt-001',
                    status: 'failed',
                    error: {
                        code: 'content_filter',
                        message: '内容不合规',
                    },
                })
            );

            const result = await provider.getStatus('cgt-001');
            expect(result.status).toBe('failed');
            expect(result.errorMessage).toBe('内容不合规');
        });

        it('expired 状态应映射为 failed', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'cgt-001',
                    status: 'expired',
                    error: null,
                })
            );

            const result = await provider.getStatus('cgt-001');
            expect(result.status).toBe('failed');
            expect(result.errorMessage).toContain('超时');
        });

        it('cancelled 状态应映射为 failed', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    id: 'cgt-001',
                    status: 'cancelled',
                    error: null,
                })
            );

            const result = await provider.getStatus('cgt-001');
            expect(result.status).toBe('failed');
            expect(result.errorMessage).toContain('已取消');
        });

        it('应使用 GET 请求正确的 URL', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ id: 'cgt-test-123', status: 'queued', error: null })
            );

            await provider.getStatus('cgt-test-123');

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe(
                'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-test-123'
            );
            expect(options.method).toBe('GET');
            expect(options.headers['Authorization']).toBe(`Bearer ${apiKey}`);
        });

        it('API 返回非 200 应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ error: { message: 'Not Found' } }, 404)
            );

            await expect(provider.getStatus('cgt-invalid')).rejects.toThrow();
        });
    });

    describe('downloadVideo', () => {
        it('下载失败时应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                body: null,
            } as unknown as Response);

            await expect(
                provider.downloadVideo(
                    'https://cdn.volces.com/expired.mp4',
                    '/tmp/test.mp4'
                )
            ).rejects.toThrow();
        });
    });

    describe('getModelsInfo', () => {
        it('应返回所有模型的详细信息', () => {
            const infos = provider.getModelsInfo();
            expect(infos).toHaveLength(provider.models.length);
            for (const info of infos) {
                expect(info.id).toBeTruthy();
                expect(info.displayName).toBeTruthy();
                expect(provider.models).toContain(info.id);
            }
        });

        it('每个模型应包含 capabilities', () => {
            const infos = provider.getModelsInfo();
            for (const info of infos) {
                expect(info.capabilities).toBeDefined();
                const caps = info.capabilities!;
                expect(typeof caps.i2v).toBe('boolean');
                expect(typeof caps.firstLastFrame).toBe('boolean');
                expect(typeof caps.referenceImage).toBe('boolean');
                expect(typeof caps.audio).toBe('boolean');
                expect(Array.isArray(caps.resolutions)).toBe(true);
                expect(caps.resolutions.length).toBeGreaterThan(0);
                expect(caps.durationRange).toHaveLength(2);
                expect(typeof caps.defaultResolution).toBe('string');
            }
        });

        it('每个模型应包含 ratios 列表', () => {
            const infos = provider.getModelsInfo();
            for (const info of infos) {
                expect(info.capabilities!.ratios).toBeDefined();
                expect(info.capabilities!.ratios!.length).toBeGreaterThan(0);
                expect(info.capabilities!.ratios).toContain('16:9');
            }
        });

        it('Seedance 1.5 Pro 应支持音频和自动时长', () => {
            const infos = provider.getModelsInfo();
            const pro15 = infos.find((m) => m.id === 'doubao-seedance-1-5-pro-251215');
            expect(pro15).toBeDefined();
            expect(pro15!.displayName).toBe('Seedance 1.5 Pro');
            expect(pro15!.capabilities!.audio).toBe(true);
            expect(pro15!.capabilities!.autoDuration).toBe(true);
            expect(pro15!.capabilities!.draft).toBe(true);
        });

        it('Seedance 1.0 Lite I2V 应支持参考图', () => {
            const infos = provider.getModelsInfo();
            const liteI2v = infos.find((m) => m.id === 'doubao-seedance-1-0-lite-i2v-250428');
            expect(liteI2v).toBeDefined();
            expect(liteI2v!.capabilities!.referenceImage).toBe(true);
            expect(liteI2v!.capabilities!.i2v).toBe(true);
        });
    });
});
