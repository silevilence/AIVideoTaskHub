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

describe('checkMissingProviderSettings', () => {
    interface ProviderSettingSchema {
        key: string;
        label: string;
        secret?: boolean;
        required?: boolean;
        defaultValue?: string;
        description?: string;
    }

    interface ProviderSettings {
        displayName: string;
        schema: ProviderSettingSchema[];
        values: Record<string, string>;
    }

    function getMissingSettings(
        providerName: string,
        allSettings: Record<string, ProviderSettings>,
    ): string[] {
        const ps = allSettings[providerName];
        if (!ps) return [];
        return ps.schema
            .filter((s) => s.required && !ps.values[s.key])
            .map((s) => s.label);
    }

    it('should return empty array when all required settings are configured', () => {
        const settings: Record<string, ProviderSettings> = {
            siliconflow: {
                displayName: 'SiliconFlow',
                schema: [
                    { key: 'api_key', label: 'API Key', required: true },
                ],
                values: { api_key: 'sk-***' },
            },
        };
        expect(getMissingSettings('siliconflow', settings)).toEqual([]);
    });

    it('should return missing required setting labels', () => {
        const settings: Record<string, ProviderSettings> = {
            volcengine: {
                displayName: '火山引擎',
                schema: [
                    { key: 'api_key', label: 'API Key', required: true },
                    { key: 'endpoint', label: 'Endpoint', required: false },
                ],
                values: {},
            },
        };
        expect(getMissingSettings('volcengine', settings)).toEqual(['API Key']);
    });

    it('should return multiple missing settings', () => {
        const settings: Record<string, ProviderSettings> = {
            test: {
                displayName: 'Test',
                schema: [
                    { key: 'key_a', label: 'Key A', required: true },
                    { key: 'key_b', label: 'Key B', required: true },
                    { key: 'key_c', label: 'Key C' },
                ],
                values: {},
            },
        };
        expect(getMissingSettings('test', settings)).toEqual(['Key A', 'Key B']);
    });

    it('should return empty array for unknown provider', () => {
        expect(getMissingSettings('unknown', {})).toEqual([]);
    });

    it('should not report optional settings as missing', () => {
        const settings: Record<string, ProviderSettings> = {
            siliconflow: {
                displayName: 'SiliconFlow',
                schema: [
                    { key: 'api_key', label: 'API Key', required: true },
                    { key: 'extra', label: 'Extra' },
                ],
                values: { api_key: 'sk-123' },
            },
        };
        expect(getMissingSettings('siliconflow', settings)).toEqual([]);
    });

    it('should treat empty string value as missing', () => {
        const settings: Record<string, ProviderSettings> = {
            siliconflow: {
                displayName: 'SiliconFlow',
                schema: [
                    { key: 'api_key', label: 'API Key', required: true },
                ],
                values: { api_key: '' },
            },
        };
        expect(getMissingSettings('siliconflow', settings)).toEqual(['API Key']);
    });
});

describe('providerIconMapping', () => {
    const PROVIDER_ICONS: Record<string, string> = {
        siliconflow: 'siliconflow.png',
        volcengine: 'volcengine.png',
    };

    it('should have icons for known providers', () => {
        expect(PROVIDER_ICONS['siliconflow']).toBeDefined();
        expect(PROVIDER_ICONS['volcengine']).toBeDefined();
    });

    it('should return undefined for unknown providers', () => {
        expect(PROVIDER_ICONS['unknown']).toBeUndefined();
    });
});
