import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    requestSafeHttpUrl,
    type ComfyDnsResolver,
    type SafeHttpTarget,
} from './comfyui-connection.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LOCAL_IMAGE_PATTERN = /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp))$/i;
const DATA_IMAGE_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

export interface ComfyImageResolution {
    source: string;
    name: string;
    subfolder: string;
    type: string;
    fileIdentifier: string;
}

export interface UploadComfyImageOptions {
    baseUrl: string;
    source: string;
    variableKey: string;
    fetcher?: typeof fetch;
    resolver?: ComfyDnsResolver;
    dataDir?: string;
    safeTarget?: SafeHttpTarget;
}

interface LoadedImage {
    bytes: Buffer;
    mimeType: string;
    extension: string;
}

function extensionForMime(mimeType: string): string {
    const normalized = mimeType.split(';')[0].trim().toLowerCase();
    if (normalized === 'image/jpeg') return 'jpg';
    if (normalized === 'image/png') return 'png';
    if (normalized === 'image/gif') return 'gif';
    if (normalized === 'image/webp') return 'webp';
    throw new Error(`不支持的图片类型：${normalized || '未知'}`);
}

function assertImageSize(bytes: Buffer): void {
    if (bytes.length === 0) throw new Error('图片内容为空');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片大小不能超过 10MB');
}

async function loadImage(options: UploadComfyImageOptions): Promise<LoadedImage> {
    const dataMatch = options.source.match(DATA_IMAGE_PATTERN);
    if (dataMatch) {
        const bytes = Buffer.from(dataMatch[2].replace(/\s/g, ''), 'base64');
        assertImageSize(bytes);
        return { bytes, mimeType: dataMatch[1], extension: extensionForMime(dataMatch[1]) };
    }

    const localMatch = options.source.match(LOCAL_IMAGE_PATTERN);
    if (localMatch) {
        const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? 'data');
        const filePath = path.resolve(dataDir, 'uploads', localMatch[1]);
        const uploadsDir = path.resolve(dataDir, 'uploads');
        if (path.dirname(filePath) !== uploadsDir || !fs.existsSync(filePath)) {
            throw new Error('本地图片不存在');
        }
        const bytes = fs.readFileSync(filePath);
        assertImageSize(bytes);
        const extension = path.extname(filePath).slice(1).toLowerCase().replace('jpeg', 'jpg');
        return {
            bytes,
            mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
            extension,
        };
    }

    if (!/^https?:\/\//i.test(options.source)) throw new Error('图片来源无效');
    const response = await requestSafeHttpUrl(options.source, {
        maxResponseBytes: MAX_IMAGE_BYTES,
        targetLabel: '图片下载',
    }, options.fetcher, options.resolver);
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`图片下载失败（HTTP ${response.status}）`);
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!mimeType.startsWith('image/')) throw new Error('图片 URL 未返回图片内容');
    assertImageSize(response.body);
    return {
        bytes: response.body,
        mimeType,
        extension: extensionForMime(mimeType),
    };
}

function multipartBody(image: LoadedImage, filename: string, boundary: string): Buffer {
    return Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${image.mimeType}\r\n\r\n`),
        image.bytes,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\nfalse\r\n--${boundary}--\r\n`),
    ]);
}

function parseUploadResponse(source: string, body: Buffer): ComfyImageResolution {
    let value: unknown;
    try {
        value = JSON.parse(body.toString('utf8'));
    } catch {
        throw new Error('ComfyUI 图片上传返回了无效 JSON');
    }
    if (!value || typeof value !== 'object') throw new Error('ComfyUI 图片上传返回无效');
    const result = value as Record<string, unknown>;
    const name = typeof result.name === 'string' ? result.name : '';
    const subfolder = typeof result.subfolder === 'string' ? result.subfolder : '';
    const type = typeof result.type === 'string' ? result.type : '';
    if (!name || !type || path.basename(name) !== name || subfolder.includes('..') || subfolder.includes('\\')) {
        throw new Error('ComfyUI 图片上传返回了无效文件描述');
    }
    const fileIdentifier = subfolder ? `${subfolder.replace(/^\/+|\/+$/g, '')}/${name}` : name;
    return { source, name, subfolder, type, fileIdentifier };
}

export async function uploadComfyImage(
    options: UploadComfyImageOptions
): Promise<ComfyImageResolution> {
    const image = await loadImage(options);
    const filename = `${options.variableKey}-${randomUUID()}.${image.extension}`;
    const uploadUrl = `${options.baseUrl}/upload/image`;
    let response;
    if (options.fetcher && options.fetcher !== globalThis.fetch) {
        const form = new FormData();
        form.append(
            'image',
            new Blob([Uint8Array.from(image.bytes).buffer], { type: image.mimeType }),
            filename
        );
        form.append('type', 'input');
        form.append('overwrite', 'false');
        response = await requestSafeHttpUrl(uploadUrl, {
            method: 'POST',
            body: form,
            targetLabel: 'ComfyUI 图片上传',
            safeTarget: options.safeTarget,
        }, options.fetcher, options.resolver);
    } else {
        const boundary = `----aivideotaskhub-${randomUUID()}`;
        response = await requestSafeHttpUrl(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            body: multipartBody(image, filename, boundary),
            targetLabel: 'ComfyUI 图片上传',
            safeTarget: options.safeTarget,
        }, options.fetcher, options.resolver);
    }
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`ComfyUI 图片上传失败（HTTP ${response.status}）`);
    }
    return parseUploadResponse(options.source, response.body);
}
