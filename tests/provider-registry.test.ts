import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { MockProvider } from '../src/server/providers/mock-provider.js';
import type { VideoProvider } from '../src/server/provider.js';

describe('ProviderRegistry', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
        registry = new ProviderRegistry();
    });

    it('注册后应能通过名称获取 provider', () => {
        const mock = new MockProvider();
        registry.register(mock);
        const found = registry.get('mock');
        expect(found).toBe(mock);
    });

    it('获取未注册的 provider 应返回 undefined', () => {
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('重复注册同名 provider 应抛出错误', () => {
        const mock1 = new MockProvider();
        const mock2 = new MockProvider();
        registry.register(mock1);
        expect(() => registry.register(mock2)).toThrow();
    });

    it('应能列出所有已注册的 provider 名称', () => {
        const mock = new MockProvider();
        registry.register(mock);
        expect(registry.listNames()).toContain('mock');
    });

    it('has 方法应正确判断 provider 是否存在', () => {
        const mock = new MockProvider();
        registry.register(mock);
        expect(registry.has('mock')).toBe(true);
        expect(registry.has('other')).toBe(false);
    });
});
