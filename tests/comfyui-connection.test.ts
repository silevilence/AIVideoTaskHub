import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import {
    checkComfyWorkflowCompatibility,
    normalizeComfyUiBaseUrl,
    requestSafeHttpUrl,
} from '../src/server/comfyui-connection.js';
import type { ComfyApiWorkflow } from '../src/server/comfy-workflow-template.js';

const workflow: ComfyApiWorkflow = {
    '1': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'hello', clip: ['2', 0], unknown_input: true },
    },
    '2': {
        class_type: 'MissingNode',
        inputs: {},
    },
};

describe('ComfyUI 连接与模板兼容性', () => {
    it('仅接受 HTTP/HTTPS 地址并规范化尾部斜杠', () => {
        expect(normalizeComfyUiBaseUrl(' http://127.0.0.1:8188/// ')).toBe(
            'http://127.0.0.1:8188'
        );
        expect(normalizeComfyUiBaseUrl('https://comfy.example.com/root/')).toBe(
            'https://comfy.example.com/root'
        );
        expect(() => normalizeComfyUiBaseUrl('ftp://example.com')).toThrow(
            'ComfyUI 地址仅支持 HTTP 或 HTTPS'
        );
        expect(() => normalizeComfyUiBaseUrl('http://?')).toThrow('ComfyUI 地址无效');
        expect(() => normalizeComfyUiBaseUrl('http://169.254.169.254/latest/meta-data')).toThrow(
            'ComfyUI 地址不允许访问云元数据服务'
        );
        expect(() => normalizeComfyUiBaseUrl('http://metadata.google.internal.:8188')).toThrow(
            'ComfyUI 地址不允许访问云元数据服务'
        );
        expect(() => normalizeComfyUiBaseUrl('http://[::ffff:169.254.169.254]:8188')).toThrow(
            'ComfyUI 地址不允许访问云元数据服务'
        );
    });

    it('DNS 别名解析到云元数据地址时在请求前拒绝', async () => {
        const fetcher = vi.fn();
        const resolver = vi.fn(async () => [{ address: '169.254.169.254', family: 4 as const }]);

        await expect(checkComfyWorkflowCompatibility(
            'http://comfy.internal:8188',
            {},
            fetcher,
            resolver
        )).rejects.toThrow('ComfyUI 地址不允许访问云元数据服务');
        expect(fetcher).not.toHaveBeenCalled();

        await expect(checkComfyWorkflowCompatibility(
            'http://comfy.internal:8188',
            {},
            fetcher,
            async () => [{ address: '::ffff:a9fe:a9fe', family: 6 as const }]
        )).rejects.toThrow('ComfyUI 地址不允许访问云元数据服务');
    });

    it('实际请求固定使用已校验的 DNS 地址而不再次解析主机名', async () => {
        const server = createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end('{}');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('测试服务器未监听 TCP 端口');

        try {
            const result = await checkComfyWorkflowCompatibility(
                `http://comfy-ui.invalid:${address.port}`,
                {},
                fetch,
                async () => [{ address: '127.0.0.1', family: 4 }]
            );
            expect(result.ok).toBe(true);
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => {
                if (error) reject(error);
                else resolve();
            }));
        }
    });

    it('响应正文中途断开时立即失败而不是永久悬挂', async () => {
        const server = createServer((_request, response) => {
            response.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': '100',
            });
            response.write('{"x"');
            setTimeout(() => response.destroy(), 20);
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('测试服务器未监听 TCP 端口');

        const withinOneSecond = async (promise: Promise<unknown>) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('测试超时')), 1_000)),
        ]);
        try {
            await expect(withinOneSecond(requestSafeHttpUrl(
                `http://127.0.0.1:${address.port}/partial`
            ))).rejects.toThrow('响应中断');
            await expect(withinOneSecond(checkComfyWorkflowCompatibility(
                `http://127.0.0.1:${address.port}`,
                {}
            ))).rejects.toThrow('响应中断');
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it('读取 object_info 并一次返回缺失节点与未知输入', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            CLIPTextEncode: {
                input: {
                    required: {
                        text: ['STRING', {}],
                        clip: ['CLIP', {}],
                    },
                },
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        const result = await checkComfyWorkflowCompatibility(
            'http://127.0.0.1:8188/',
            workflow,
            fetcher
        );

        expect(fetcher).toHaveBeenCalledWith(
            'http://127.0.0.1:8188/object_info',
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(result).toEqual({
            ok: false,
            baseUrl: 'http://127.0.0.1:8188',
            nodeTypeCount: 1,
            missingNodeTypes: ['MissingNode'],
            missingRequiredInputs: [],
            incompatibleInputs: [{ nodeId: '1', classType: 'CLIPTextEncode', input: 'unknown_input' }],
        });
    });

    it('报告工作流缺少的节点必填输入', async () => {
        const result = await checkComfyWorkflowCompatibility(
            'http://127.0.0.1:8188',
            { '3': { class_type: 'KSampler', inputs: { seed: 1 } } },
            vi.fn(async () => new Response(JSON.stringify({
                KSampler: {
                    input: {
                        required: {
                            seed: ['INT', {}],
                            model: ['MODEL', {}],
                        },
                    },
                },
            }), { status: 200 }))
        );

        expect(result.ok).toBe(false);
        expect(result.missingRequiredInputs).toEqual([
            { nodeId: '3', classType: 'KSampler', input: 'model' },
        ]);
    });

    it('聚合报告可识别输入的类型、枚举和数值约束问题，并跳过节点连接', async () => {
        const result = await checkComfyWorkflowCompatibility(
            'http://127.0.0.1:8188',
            {
                '3': {
                    class_type: 'KSampler',
                    inputs: {
                        seed: 'not-an-integer',
                        cfg: 25,
                        enabled: 'yes',
                        sampler_name: 'unknown',
                        model: ['2', 0],
                    },
                },
            },
            vi.fn(async () => new Response(JSON.stringify({
                KSampler: {
                    input: {
                        required: {
                            seed: ['INT', { min: 0, max: 100 }],
                            cfg: ['FLOAT', { min: 0, max: 20 }],
                            enabled: ['BOOLEAN', {}],
                            sampler_name: [['euler', 'dpmpp_2m'], {}],
                            model: ['MODEL', {}],
                        },
                    },
                },
            }), { status: 200 }))
        );

        expect(result.ok).toBe(false);
        expect(result.incompatibleInputs).toEqual([
            { nodeId: '3', classType: 'KSampler', input: 'seed', reason: '必须是整数' },
            { nodeId: '3', classType: 'KSampler', input: 'cfg', reason: '不能大于 20' },
            { nodeId: '3', classType: 'KSampler', input: 'enabled', reason: '必须是布尔值' },
            {
                nodeId: '3',
                classType: 'KSampler',
                input: 'sampler_name',
                reason: '必须是已声明的选项',
            },
        ]);
    });

    it('将不可达和非成功响应转换为清晰错误', async () => {
        await expect(checkComfyWorkflowCompatibility(
            'http://127.0.0.1:8188',
            {},
            vi.fn(async () => { throw new Error('connect ECONNREFUSED'); })
        )).rejects.toThrow('无法连接 ComfyUI：connect ECONNREFUSED');

        await expect(checkComfyWorkflowCompatibility(
            'http://127.0.0.1:8188',
            {},
            vi.fn(async () => new Response('bad gateway', { status: 502 }))
        )).rejects.toThrow('ComfyUI /object_info 请求失败（HTTP 502）');

        await expect(checkComfyWorkflowCompatibility(
            'http://127.0.0.1:8188',
            {},
            vi.fn(async () => new Response(null, {
                status: 302,
                headers: { Location: 'http://169.254.169.254/' },
            }))
        )).rejects.toThrow('ComfyUI /object_info 不允许重定向');
    });
});
