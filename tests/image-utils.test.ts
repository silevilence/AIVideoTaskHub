import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveImageUrl, resolveCreateTaskImages } from '../src/server/image-utils.js';

const testDir = path.resolve(process.env.DATA_DIR || 'data', 'uploads');
const testFile = path.join(testDir, 'test-image-utils.png');
// 1x1 pixel PNG
const pngData = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNl7BcQAAAABJRU5ErkJggg==',
    'base64',
);

// 创建测试图片
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(testFile, pngData);

afterAll(() => {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
});

describe('resolveImageUrl', () => {
    it('对 undefined/null/空字符串返回 undefined', () => {
        expect(resolveImageUrl(undefined)).toBeUndefined();
        expect(resolveImageUrl(null)).toBeUndefined();
        expect(resolveImageUrl('')).toBeUndefined();
    });

    it('外部 URL 原样返回', () => {
        const url = 'https://example.com/img.png';
        expect(resolveImageUrl(url)).toBe(url);
    });

    it('已有 base64 data URL 原样返回', () => {
        const dataUrl = 'data:image/png;base64,aGVsbG8=';
        expect(resolveImageUrl(dataUrl)).toBe(dataUrl);
    });

    it('本地 /uploads/ 路径转为 base64', () => {
        const result = resolveImageUrl('/uploads/test-image-utils.png');
        expect(result).toMatch(/^data:image\/png;base64,/);
        expect(result).not.toBe('/uploads/test-image-utils.png');
    });

    it('不存在的 /uploads/ 文件原样返回', () => {
        const url = '/uploads/nonexistent-file.png';
        expect(resolveImageUrl(url)).toBe(url);
    });
});

describe('resolveCreateTaskImages', () => {
    it('解析 imageUrl 和 extra 中的本地路径', () => {
        const { resolvedImageUrl, resolvedExtra } = resolveCreateTaskImages(
            '/uploads/test-image-utils.png',
            {
                lastFrameImageUrl: '/uploads/test-image-utils.png',
                referenceImageUrls: ['/uploads/test-image-utils.png', 'https://example.com/ref.png'],
                someOtherParam: 'unchanged',
            },
        );

        expect(resolvedImageUrl).toMatch(/^data:image\/png;base64,/);
        expect(resolvedExtra!.lastFrameImageUrl).toMatch(/^data:image\/png;base64,/);
        expect((resolvedExtra!.referenceImageUrls as string[])[0]).toMatch(/^data:image\/png;base64,/);
        expect((resolvedExtra!.referenceImageUrls as string[])[1]).toBe('https://example.com/ref.png');
        expect(resolvedExtra!.someOtherParam).toBe('unchanged');
    });

    it('extra 为 undefined 时正常返回', () => {
        const { resolvedImageUrl, resolvedExtra } = resolveCreateTaskImages(
            'https://example.com/img.png',
            undefined,
        );
        expect(resolvedImageUrl).toBe('https://example.com/img.png');
        expect(resolvedExtra).toBeUndefined();
    });
});
