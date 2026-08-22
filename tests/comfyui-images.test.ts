import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadComfyImage } from '../src/server/comfyui-images.js';

const createdDirectories: string[] = [];

afterEach(() => {
    for (const directory of createdDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function uploadResponse(name = 'uploaded.png', subfolder = ''): Response {
    return new Response(JSON.stringify({ name, subfolder, type: 'input' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('ComfyUI 图片上传', () => {
    it('将 data URL 作为 multipart 图片上传并返回 ComfyUI 文件标识', async () => {
        const fetcher = vi.fn(async (
            _input: string | URL | Request,
            _init?: RequestInit
        ) => uploadResponse('asset.png', 'tasks/42'));

        const result = await uploadComfyImage({
            baseUrl: 'http://127.0.0.1:8188',
            source: 'data:image/png;base64,aGVsbG8=',
            variableKey: 'first_frame',
            fetcher,
        });

        expect(fetcher).toHaveBeenCalledOnce();
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe('http://127.0.0.1:8188/upload/image');
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init!.body as FormData;
        expect(form.get('type')).toBe('input');
        expect(form.get('overwrite')).toBe('false');
        expect((form.get('image') as File).name).toMatch(/^first_frame-[0-9a-f-]+\.png$/);
        expect(await (form.get('image') as File).text()).toBe('hello');
        expect(result).toEqual({
            source: 'data:image/png;base64,aGVsbG8=',
            name: 'asset.png',
            subfolder: 'tasks/42',
            type: 'input',
            fileIdentifier: 'tasks/42/asset.png',
        });
    });

    it('读取已有上传文件并限制路径在 data/uploads 内', async () => {
        const dataDir = path.join(process.cwd(), `comfy-image-test-${Date.now()}`);
        createdDirectories.push(dataDir);
        const uploadsDir = path.join(dataDir, 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        const filename = '123e4567-e89b-12d3-a456-426614174000.png';
        fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from('local-image'));
        const fetcher = vi.fn(async (
            _input: string | URL | Request,
            _init?: RequestInit
        ) => uploadResponse(filename));

        const result = await uploadComfyImage({
            baseUrl: 'http://127.0.0.1:8188',
            source: `/uploads/${filename}`,
            variableKey: 'image',
            fetcher,
            dataDir,
        });

        const form = fetcher.mock.calls[0][1]!.body as FormData;
        expect(await (form.get('image') as File).text()).toBe('local-image');
        expect(result.fileIdentifier).toBe(filename);
        await expect(uploadComfyImage({
            baseUrl: 'http://127.0.0.1:8188',
            source: '/uploads/../../secret.png',
            variableKey: 'image',
            fetcher,
            dataDir,
        })).rejects.toThrow('图片来源无效');
    });

    it('先安全下载 URL 图片再上传且拒绝重定向和超限响应', async () => {
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url === 'https://images.example.com/source.webp?token=x') {
                return new Response(Buffer.from('remote-image'), {
                    status: 200,
                    headers: { 'Content-Type': 'image/webp' },
                });
            }
            return uploadResponse('remote.webp');
        });

        const result = await uploadComfyImage({
            baseUrl: 'http://192.168.1.20:8188',
            source: 'https://images.example.com/source.webp?token=x',
            variableKey: 'reference',
            fetcher,
            resolver: async () => [{ address: '203.0.113.10', family: 4 }],
        });

        expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
            'https://images.example.com/source.webp?token=x',
            'http://192.168.1.20:8188/upload/image',
        ]);
        expect(result.fileIdentifier).toBe('remote.webp');

        await expect(uploadComfyImage({
            baseUrl: 'http://127.0.0.1:8188',
            source: 'http://169.254.169.254/latest/meta-data',
            variableKey: 'image',
            fetcher,
        })).rejects.toThrow('图片下载不允许访问云元数据服务');

        const redirectFetcher = vi.fn(async () => new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/' },
        }));
        await expect(uploadComfyImage({
            baseUrl: 'http://127.0.0.1:8188',
            source: 'https://images.example.com/redirect.png',
            variableKey: 'image',
            fetcher: redirectFetcher,
            resolver: async () => [{ address: '203.0.113.10', family: 4 }],
        })).rejects.toThrow('图片下载不允许重定向');
    });

    it('生产上传请求固定使用预检后的 DNS 地址并发送 multipart', async () => {
        let receivedBody = '';
        let receivedHost = '';
        const server = createServer((request, response) => {
            receivedHost = request.headers.host ?? '';
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer) => chunks.push(chunk));
            request.on('end', () => {
                receivedBody = Buffer.concat(chunks).toString('latin1');
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ name: 'pinned.png', subfolder: '', type: 'input' }));
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('测试服务未监听 TCP 端口');

        try {
            const result = await uploadComfyImage({
                baseUrl: `http://comfy-ui.invalid:${address.port}`,
                source: 'data:image/png;base64,aGVsbG8=',
                variableKey: 'image',
                resolver: async () => [{ address: '127.0.0.1', family: 4 }],
            });

            expect(receivedHost).toBe(`comfy-ui.invalid:${address.port}`);
            expect(receivedBody).toContain('name="type"');
            expect(receivedBody).toContain('name="overwrite"');
            expect(receivedBody).toContain('hello');
            expect(result.fileIdentifier).toBe('pinned.png');
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => {
                if (error) reject(error);
                else resolve();
            }));
        }
    });
});
