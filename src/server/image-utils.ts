import fs from 'fs';
import path from 'path';

const dataDir = process.env.DATA_DIR || 'data';

/**
 * 将本地 /uploads/ 路径转换为 base64 data URL，
 * 外部 URL 和已有 base64 字符串原样返回。
 */
export function resolveImageUrl(url: string | undefined | null): string | undefined {
    if (!url || typeof url !== 'string') return undefined;
    if (!url.startsWith('/uploads/')) return url;
    const filePath = path.resolve(dataDir, url.slice(1));
    if (!fs.existsSync(filePath)) return url;
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * 解析 createTask 参数中所有可能包含本地路径的图片字段，
 * 将 /uploads/ 路径转换为 base64。
 */
export function resolveCreateTaskImages(
    imageUrl: string | undefined,
    extra: Record<string, unknown> | undefined,
): { resolvedImageUrl: string | undefined; resolvedExtra: Record<string, unknown> | undefined } {
    const resolvedImageUrl = resolveImageUrl(imageUrl);
    if (!extra) return { resolvedImageUrl, resolvedExtra: extra };

    const resolvedExtra = { ...extra };
    if (typeof resolvedExtra.lastFrameImageUrl === 'string') {
        resolvedExtra.lastFrameImageUrl = resolveImageUrl(resolvedExtra.lastFrameImageUrl as string);
    }
    if (Array.isArray(resolvedExtra.referenceImageUrls)) {
        resolvedExtra.referenceImageUrls = (resolvedExtra.referenceImageUrls as string[]).map(
            (u) => resolveImageUrl(u) ?? u,
        );
    }
    return { resolvedImageUrl, resolvedExtra };
}
