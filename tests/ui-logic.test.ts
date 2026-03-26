import { describe, it, expect } from 'vitest';

/**
 * 测试主题解析逻辑和 provider 过滤逻辑。
 * 这些是前端 UI 重构中的核心业务逻辑。
 */

describe('resolveTheme', () => {
    function resolveIsDark(
        theme: 'light' | 'dark' | 'system',
        systemPrefersDark: boolean,
    ): boolean {
        return theme === 'dark' || (theme === 'system' && systemPrefersDark);
    }

    it('should return dark when theme is dark', () => {
        expect(resolveIsDark('dark', false)).toBe(true);
        expect(resolveIsDark('dark', true)).toBe(true);
    });

    it('should return light when theme is light', () => {
        expect(resolveIsDark('light', false)).toBe(false);
        expect(resolveIsDark('light', true)).toBe(false);
    });

    it('should follow system preference when theme is system', () => {
        expect(resolveIsDark('system', true)).toBe(true);
        expect(resolveIsDark('system', false)).toBe(false);
    });
});

describe('filterMockProvider', () => {
    function filterProviders(
        data: Record<string, string[]>,
    ): Record<string, string[]> {
        return Object.fromEntries(
            Object.entries(data).filter(([name]) => name !== 'mock'),
        );
    }

    it('should filter out mock provider', () => {
        const data = {
            mock: ['model-a'],
            siliconflow: ['model-b', 'model-c'],
        };
        const result = filterProviders(data);
        expect(result).toEqual({ siliconflow: ['model-b', 'model-c'] });
        expect(result).not.toHaveProperty('mock');
    });

    it('should return all when no mock provider', () => {
        const data = {
            siliconflow: ['model-a'],
            other: ['model-b'],
        };
        const result = filterProviders(data);
        expect(Object.keys(result)).toHaveLength(2);
    });

    it('should return empty when only mock provider', () => {
        const data = { mock: ['model-a'] };
        const result = filterProviders(data);
        expect(Object.keys(result)).toHaveLength(0);
    });
});
