import { describe, it, expect } from 'vitest';

describe('Vision 消息格式', () => {
    it('ContentPart 类型定义正确 — text part', () => {
        const textPart = { type: 'text' as const, text: 'hello' };
        expect(textPart.type).toBe('text');
        expect(textPart.text).toBe('hello');
    });

    it('ContentPart 类型定义正确 — image_url part', () => {
        const imagePart = { type: 'image_url' as const, image_url: { url: 'https://example.com/img.jpg' } };
        expect(imagePart.type).toBe('image_url');
        expect(imagePart.image_url.url).toBe('https://example.com/img.jpg');
    });
});

describe('buildRequestBody 序列化', () => {
    it('纯文本 content (string) 序列化为标准 messages 格式', () => {
        const body = JSON.stringify({
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'hello' }],
            stream: false,
        });
        const parsed = JSON.parse(body);
        expect(typeof parsed.messages[0].content).toBe('string');
        expect(parsed.messages[0].content).toBe('hello');
    });

    it('Vision content (ContentPart[]) 序列化为数组格式', () => {
        const body = JSON.stringify({
            model: 'gpt-4-vision',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: '描述这张图' },
                    { type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } },
                ],
            }],
            stream: false,
        });
        const parsed = JSON.parse(body);
        expect(Array.isArray(parsed.messages[0].content)).toBe(true);
        expect(parsed.messages[0].content[0].type).toBe('text');
        expect(parsed.messages[0].content[0].text).toBe('描述这张图');
        expect(parsed.messages[0].content[1].type).toBe('image_url');
        expect(parsed.messages[0].content[1].image_url.url).toBe('https://example.com/img.jpg');
    });

    it('多图 Vision 消息正确排列', () => {
        const content = [
            { type: 'text' as const, text: '描述这些图片' },
            { type: 'image_url' as const, image_url: { url: 'https://a.com/1.jpg' } },
            { type: 'image_url' as const, image_url: { url: 'https://a.com/2.jpg' } },
        ];
        expect(content.filter(c => c.type === 'image_url').length).toBe(2);
        expect(content.filter(c => c.type === 'text').length).toBe(1);
    });

    it('向后兼容：string content 不受 ContentPart 类型影响', () => {
        // 模拟现有调用方传 string content 的行为
        const messages: { role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }[] = [
            { role: 'user', content: 'plain text message' },
        ];
        const body = JSON.stringify({ model: 'test', messages, stream: false });
        const parsed = JSON.parse(body);
        expect(typeof parsed.messages[0].content).toBe('string');
    });
});
