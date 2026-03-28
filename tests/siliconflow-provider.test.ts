import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VideoProvider } from '../src/server/provider.js';
import { SiliconFlowProvider } from '../src/server/providers/siliconflow-provider.js';

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

describe('SiliconFlowProvider', () => {
    let provider: SiliconFlowProvider;
    const apiKey = 'test-api-key-123';

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new SiliconFlowProvider({ apiKey });
    });

    it('应实现 VideoProvider 接口', () => {
        const p: VideoProvider = provider;
        expect(p.name).toBe('siliconflow');
        expect(typeof p.createTask).toBe('function');
        expect(typeof p.getStatus).toBe('function');
        expect(typeof p.downloadVideo).toBe('function');
    });

    describe('createTask', () => {
        it('应使用 t2v 模型提交文本生成视频任务', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ requestId: 'req-abc-123' })
            );

            const result = await provider.createTask({
                prompt: '一只猫在跳舞',
            });

            expect(result.providerTaskId).toBe('req-abc-123');
            expect(mockFetch).toHaveBeenCalledOnce();

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe('https://api.siliconflow.cn/v1/video/submit');
            expect(options.method).toBe('POST');
            expect(options.headers['Authorization']).toBe(`Bearer ${apiKey}`);
            expect(options.headers['Content-Type']).toBe('application/json');

            const body = JSON.parse(options.body);
            expect(body.prompt).toBe('一只猫在跳舞');
            expect(body.model).toBe('Wan-AI/Wan2.2-T2V-A14B');
            expect(body.image_size).toBe('1280x720');
        });

        it('应使用指定的 model 参数', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ requestId: 'req-def-456' })
            );

            await provider.createTask({
                prompt: '测试',
                model: 'Wan-AI/Wan2.2-I2V-A14B',
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.model).toBe('Wan-AI/Wan2.2-I2V-A14B');
        });

        it('应传递 imageUrl 作为 image 参数（i2v 场景）', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ requestId: 'req-img-789' })
            );

            await provider.createTask({
                prompt: '让图片动起来',
                model: 'Wan-AI/Wan2.2-I2V-A14B',
                imageUrl: 'https://example.com/photo.png',
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.image).toBe('https://example.com/photo.png');
        });

        it('API 返回非 200 应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ message: 'Unauthorized' }, 401)
            );

            await expect(
                provider.createTask({ prompt: '测试' })
            ).rejects.toThrow();
        });
    });

    describe('getStatus', () => {
        it('InQueue 状态应映射为 pending', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: 'InQueue', reason: '' })
            );

            const result = await provider.getStatus('req-abc');
            expect(result.status).toBe('pending');
        });

        it('InProgress 状态应映射为 running', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: 'InProgress', reason: '' })
            );

            const result = await provider.getStatus('req-abc');
            expect(result.status).toBe('running');
        });

        it('Succeed 状态应映射为 success 并提取 videoUrl', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    status: 'Succeed',
                    reason: '',
                    results: {
                        videos: [{ url: 'https://cdn.sf.com/video-123.mp4' }],
                        timings: { inference: 45 },
                        seed: 42,
                    },
                })
            );

            const result = await provider.getStatus('req-abc');
            expect(result.status).toBe('success');
            expect(result.videoUrl).toBe('https://cdn.sf.com/video-123.mp4');
        });

        it('Failed 状态应映射为 failed 并包含 reason', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({
                    status: 'Failed',
                    reason: '内容审核未通过',
                })
            );

            const result = await provider.getStatus('req-abc');
            expect(result.status).toBe('failed');
            expect(result.errorMessage).toBe('内容审核未通过');
        });

        it('应发送正确的请求参数', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ status: 'InQueue', reason: '' })
            );

            await provider.getStatus('req-xyz-999');

            const [url, options] = mockFetch.mock.calls[0];
            expect(url).toBe('https://api.siliconflow.cn/v1/video/status');
            expect(options.method).toBe('POST');
            expect(options.headers['Authorization']).toBe(`Bearer ${apiKey}`);

            const body = JSON.parse(options.body);
            expect(body.requestId).toBe('req-xyz-999');
        });

        it('API 返回非 200 应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ message: 'Server Error' }, 500)
            );

            await expect(provider.getStatus('req-abc')).rejects.toThrow();
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

        it('T2V 模型的 i2v 应为 false', () => {
            const infos = provider.getModelsInfo();
            const t2v = infos.find((m) => m.id === 'Wan-AI/Wan2.2-T2V-A14B');
            expect(t2v).toBeDefined();
            expect(t2v!.displayName).toBe('Wan2.2 文生视频');
            expect(t2v!.capabilities!.i2v).toBe(false);
        });

        it('I2V 模型的 i2v 应为 true', () => {
            const infos = provider.getModelsInfo();
            const i2v = infos.find((m) => m.id === 'Wan-AI/Wan2.2-I2V-A14B');
            expect(i2v).toBeDefined();
            expect(i2v!.displayName).toBe('Wan2.2 图生视频');
            expect(i2v!.capabilities!.i2v).toBe(true);
        });
    });

    describe('downloadVideo', () => {
        it('应通过 fetch stream 下载文件到指定路径', async () => {
            // 模拟 ReadableStream
            const chunks = [new Uint8Array([0x00, 0x01, 0x02])];
            let readCount = 0;
            const mockReader = {
                read: vi.fn().mockImplementation(() => {
                    if (readCount < chunks.length) {
                        return Promise.resolve({
                            done: false,
                            value: chunks[readCount++],
                        });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                }),
            };
            const mockBody = { getReader: () => mockReader };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                body: mockBody,
            } as unknown as Response);

            // 使用临时目录测试实际写入
            const os = await import('os');
            const path = await import('path');
            const fs = await import('fs');
            const tmpDir = os.tmpdir();
            const targetPath = path.join(tmpDir, `sf-test-${Date.now()}.mp4`);

            try {
                await provider.downloadVideo(
                    'https://cdn.sf.com/video.mp4',
                    targetPath
                );

                expect(fs.existsSync(targetPath)).toBe(true);
                const content = fs.readFileSync(targetPath);
                expect(content).toEqual(Buffer.from([0x00, 0x01, 0x02]));
            } finally {
                // 清理
                if (fs.existsSync(targetPath)) {
                    fs.unlinkSync(targetPath);
                }
            }
        });

        it('下载失败应抛出错误', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                body: null,
            } as unknown as Response);

            await expect(
                provider.downloadVideo(
                    'https://cdn.sf.com/gone.mp4',
                    '/tmp/nope.mp4'
                )
            ).rejects.toThrow();
        });
    });
});

describe('SiliconFlowProvider 自定义配置', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('应支持自定义默认 model 和 imageSize', async () => {
        mockFetch.mockResolvedValueOnce(
            jsonResponse({ requestId: 'req-custom' })
        );

        const provider = new SiliconFlowProvider({
            apiKey: 'key',
            defaultModel: 'Wan-AI/Wan2.2-I2V-A14B',
            defaultImageSize: '960x960',
        });

        await provider.createTask({ prompt: '自定义配置测试' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.model).toBe('Wan-AI/Wan2.2-I2V-A14B');
        expect(body.image_size).toBe('960x960');
    });
});
