import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, initDb } from '../src/server/database.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { ComfyUIProvider } from '../src/server/providers/comfyui-provider.js';
import { insertTask, getTaskById, updateTaskStatus } from '../src/server/task-model.js';
import { TaskPoller } from '../src/server/task-poller.js';

const baseUrl = 'http://comfy.internal:8188';
const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);

function snapshot(overrides: Record<string, unknown> = {}) {
    return {
        snapshotVersion: 1,
        comfyuiBaseUrl: baseUrl,
        comfyuiSafeTarget: {
            origin: baseUrl,
            address: { address: '127.0.0.1', family: 4 },
        },
        workflow: {
            '1': { class_type: 'TextNode', inputs: { text: 'hello' } },
            '9': { class_type: 'SaveVideo', inputs: { source: ['1', 0] } },
        },
        primaryOutput: { nodeId: '9', field: 'videos', index: 1 },
        ...overrides,
    };
}

describe('ComfyUI 异步执行', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        resolver.mockClear();
    });

    afterEach(() => closeDb());

    it('通过 /prompt 提交快照工作流并保存 prompt_id', async () => {
        const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
            expect(init?.method).toBe('POST');
            expect(JSON.parse(String(init?.body))).toEqual({
                prompt: snapshot().workflow,
            });
            return new Response(JSON.stringify({ prompt_id: 'prompt-123', number: 7 }), {
                status: 200,
            });
        });
        const provider = new ComfyUIProvider({ fetcher, resolver });

        await expect(provider.createTask({ prompt: 'hello', extra: snapshot() })).resolves.toEqual({
            providerTaskId: 'prompt-123',
        });
        expect(fetcher).toHaveBeenCalledWith(
            `${baseUrl}/prompt`,
            expect.objectContaining({ method: 'POST', redirect: 'manual' })
        );
    });

    it('提交失败时呈现 ComfyUI 节点校验错误', async () => {
        const provider = new ComfyUIProvider({
            resolver,
            fetcher: vi.fn(async () => new Response(JSON.stringify({
                error: { message: 'prompt validation failed' },
                node_errors: {
                    '9': {
                        errors: [
                            { message: 'Required input is missing', details: 'source' },
                            { message: 'Invalid output type' },
                        ],
                    },
                },
            }), { status: 400 })),
        });

        await expect(provider.createTask({ prompt: 'hello', extra: snapshot() })).rejects.toThrow(
            '节点 9: Required input is missing (source); Invalid output type'
        );
    });

    it('从队列和历史记录映射 pending、running 与声明的主输出', async () => {
        let mode: 'pending' | 'running' | 'success' = 'pending';
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/history/')) {
                if (mode !== 'success') return new Response('{}', { status: 200 });
                return new Response(JSON.stringify({
                    'prompt-123': {
                        status: { status_str: 'success', completed: true, messages: [] },
                        outputs: {
                            '4': { videos: [{ filename: 'wrong.mp4', subfolder: '', type: 'output' }] },
                            '9': { videos: [
                                { filename: 'preview.mp4', subfolder: 'clips', type: 'temp' },
                                { filename: 'final.mp4', subfolder: 'clips/final', type: 'output' },
                            ] },
                        },
                    },
                }), { status: 200 });
            }
            if (url.endsWith('/queue')) {
                return new Response(JSON.stringify({
                    queue_running: mode === 'running' ? [[7, 'prompt-123', {}, {}, []]] : [],
                    queue_pending: mode === 'pending' ? [[7, 'prompt-123', {}, {}, []]] : [],
                }), { status: 200 });
            }
            throw new Error(`未模拟请求：${url}`);
        });
        const provider = new ComfyUIProvider({ fetcher, resolver });
        const context = { extra: snapshot() };

        await expect(provider.getStatus('prompt-123', context)).resolves.toEqual({ status: 'pending' });
        mode = 'running';
        await expect(provider.getStatus('prompt-123', context)).resolves.toEqual({ status: 'running' });
        mode = 'success';
        await expect(provider.getStatus('prompt-123', context)).resolves.toEqual({
            status: 'success',
            videoUrl: `${baseUrl}/view?filename=final.mp4&subfolder=clips%2Ffinal&type=output`,
        });
        expect(resolver).not.toHaveBeenCalled();
    });

    it('将执行失败、主输出缺失和非法文件描述转换为可诊断失败', async () => {
        const history = {
            'prompt-error': {
                status: {
                    status_str: 'error',
                    completed: false,
                    messages: [['execution_error', {
                        node_id: '9',
                        exception_message: 'CUDA out of memory',
                    }]],
                },
                outputs: {},
            },
            'prompt-missing': {
                status: { status_str: 'success', completed: true, messages: [] },
                outputs: { '9': { videos: [] } },
            },
            'prompt-invalid': {
                status: { status_str: 'success', completed: true, messages: [] },
                outputs: {
                    '9': { videos: [null, { filename: '..\\escape.mp4', subfolder: '', type: 'output' }] },
                },
            },
        };
        const provider = new ComfyUIProvider({
            resolver,
            fetcher: vi.fn(async (input: string | URL | Request) => {
                const promptId = decodeURIComponent(String(input).split('/history/')[1]);
                return new Response(JSON.stringify({
                    [promptId]: history[promptId as keyof typeof history],
                }), { status: 200 });
            }),
        });
        const context = { extra: snapshot() };

        await expect(provider.getStatus('prompt-error', context)).resolves.toEqual({
            status: 'failed',
            errorMessage: '节点 9 执行失败：CUDA out of memory',
        });
        await expect(provider.getStatus('prompt-missing', context)).resolves.toEqual({
            status: 'failed',
            errorMessage: '主输出缺失：节点 9 的 videos[1] 不存在',
        });
        await expect(provider.getStatus('prompt-invalid', context)).resolves.toEqual({
            status: 'failed',
            errorMessage: '主输出文件描述无效：filename 非法',
        });
    });

    it('轮询成功后从 /view 下载单个声明视频并写入现有本地目录', async () => {
        const videoBytes = Buffer.from('mock-video-content');
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('/history/')) {
                return new Response(JSON.stringify({
                    'prompt-download': {
                        status: { status_str: 'success', completed: true, messages: [] },
                        outputs: {
                            '9': { videos: [
                                { filename: 'ignored.mp4', subfolder: '', type: 'output' },
                                { filename: 'selected.mp4', subfolder: 'final', type: 'output' },
                            ] },
                        },
                    },
                }), { status: 200 });
            }
            if (url.includes('/view?')) {
                return new Response(videoBytes, {
                    status: 200,
                    headers: { 'Content-Type': 'video/mp4' },
                });
            }
            throw new Error(`未模拟请求：${url}`);
        });
        const provider = new ComfyUIProvider({ fetcher, resolver });
        const registry = new ProviderRegistry();
        registry.register(provider);
        const task = insertTask({
            provider: 'comfyui',
            prompt: 'hello',
            extraParams: snapshot(),
        });
        updateTaskStatus(task.id, 'running', { providerTaskId: 'prompt-download' });
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-poller-'));

        try {
            const poller = new TaskPoller({ registry, dataDir: outputDir });
            await poller.poll();

            const updated = getTaskById(task.id)!;
            expect(updated.status).toBe('success');
            expect(updated.result_url).toMatch(/^\/videos\/comfyui-/);
            expect(fs.readFileSync(path.join(outputDir, path.basename(updated.result_url!)))).toEqual(
                videoBytes
            );
        } finally {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
    });

    it('拒绝将 200 HTML 错误页保存为成功视频', async () => {
        const provider = new ComfyUIProvider({
            resolver,
            fetcher: vi.fn(async () => new Response('<html>login</html>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
            })),
        });
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-invalid-video-'));
        const targetPath = path.join(directory, 'result.mp4');

        try {
            await expect(provider.downloadVideo(
                `${baseUrl}/view?filename=result.mp4&type=output`,
                targetPath,
                { extra: snapshot() }
            )).rejects.toThrow('响应类型无效');
            expect(fs.existsSync(targetPath)).toBe(false);
            expect(fs.readdirSync(directory)).toEqual([]);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
