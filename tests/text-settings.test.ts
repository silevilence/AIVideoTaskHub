import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../src/server/database.js';
import {
    getTextProviders,
    saveTextProviders,
    getStreamingSetting,
    setStreamingSetting,
    getPromptTemplate,
    savePromptTemplate,
    resetPromptTemplate,
    getPromptLanguage,
    setPromptLanguage,
    getModelLanguageOverride,
    setModelLanguageOverride,
    removeModelLanguageOverride,
    getTextSettings,
    updateTextSettings,
    renderPromptTemplate,
    validatePromptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    PRESET_PROVIDERS,
} from '../src/server/text-settings.js';
import type { TextProviderConfig } from '../src/server/text-settings.js';

describe('text-settings', () => {
    beforeEach(() => {
        initDb(':memory:');
    });

    // ── Provider 配置 CRUD ──────────────────────────

    describe('TextProviders', () => {
        it('初始时无提供商', () => {
            expect(getTextProviders()).toEqual([]);
        });

        it('保存和读取提供商列表', () => {
            const providers: TextProviderConfig[] = [
                {
                    name: 'deepseek',
                    displayName: 'DeepSeek',
                    baseUrl: 'https://api.deepseek.com',
                    apiKey: 'sk-test',
                    apiKeySource: 'own',
                    models: [{ id: 'deepseek-chat', displayName: 'DeepSeek Chat', reasoning: false }],
                    isPreset: true,
                    type: 'openai',
                },
            ];
            saveTextProviders(providers);
            const loaded = getTextProviders();
            expect(loaded).toHaveLength(1);
            expect(loaded[0].name).toBe('deepseek');
            expect(loaded[0].apiKey).toBe('sk-test');
            expect(loaded[0].models).toHaveLength(1);
        });

        it('多个提供商保存与覆盖', () => {
            const providers: TextProviderConfig[] = [
                {
                    name: 'deepseek',
                    displayName: 'DeepSeek',
                    baseUrl: 'https://api.deepseek.com',
                    apiKey: 'sk-1',
                    apiKeySource: 'own',
                    models: [],
                    isPreset: true,
                    type: 'openai',
                },
                {
                    name: 'custom-ollama',
                    displayName: 'Ollama',
                    baseUrl: 'http://localhost:11434',
                    apiKey: '',
                    apiKeySource: 'own',
                    models: [{ id: 'llama3', displayName: 'Llama 3', reasoning: false }],
                    isPreset: false,
                    type: 'ollama',
                },
            ];
            saveTextProviders(providers);
            expect(getTextProviders()).toHaveLength(2);

            // 覆盖更新
            saveTextProviders([providers[0]]);
            expect(getTextProviders()).toHaveLength(1);
        });

        it('AIHubMix 提供商含 appCode', () => {
            const providers: TextProviderConfig[] = [
                {
                    name: 'aihubmix-text',
                    displayName: 'AIHubMix',
                    baseUrl: 'https://aihubmix.com',
                    apiKey: 'sk-hub',
                    apiKeySource: 'own',
                    appCode: 'ATUH2466',
                    models: [],
                    isPreset: true,
                    type: 'openai',
                },
            ];
            saveTextProviders(providers);
            const loaded = getTextProviders();
            expect(loaded[0].appCode).toBe('ATUH2466');
        });
    });

    // ── 流式输出设置 ──────────────────────────

    describe('streaming setting', () => {
        it('默认关闭', () => {
            expect(getStreamingSetting()).toBe(false);
        });

        it('开启和关闭', () => {
            setStreamingSetting(true);
            expect(getStreamingSetting()).toBe(true);
            setStreamingSetting(false);
            expect(getStreamingSetting()).toBe(false);
        });
    });

    // ── Prompt 模板 ──────────────────────────

    describe('prompt template', () => {
        it('默认返回内置模板', () => {
            expect(getPromptTemplate()).toBe(DEFAULT_PROMPT_TEMPLATE);
        });

        it('保存自定义模板', () => {
            const custom = '优化这段文字: ${input}，使用${lang}';
            savePromptTemplate(custom);
            expect(getPromptTemplate()).toBe(custom);
        });

        it('重置为默认模板', () => {
            savePromptTemplate('custom');
            resetPromptTemplate();
            expect(getPromptTemplate()).toBe(DEFAULT_PROMPT_TEMPLATE);
        });
    });

    // ── Prompt 语言 ──────────────────────────

    describe('prompt language', () => {
        it('默认为中文', () => {
            expect(getPromptLanguage()).toBe('中文');
        });

        it('设置语言', () => {
            setPromptLanguage('English');
            expect(getPromptLanguage()).toBe('English');
        });
    });

    // ── 模型语言覆盖 ──────────────────────────

    describe('model language override', () => {
        it('无覆盖时返回 null', () => {
            expect(getModelLanguageOverride('volcengine', 'model-1')).toBeNull();
        });

        it('设置和获取覆盖', () => {
            setModelLanguageOverride('volcengine', 'model-1', 'English');
            expect(getModelLanguageOverride('volcengine', 'model-1')).toBe('English');
        });

        it('删除覆盖', () => {
            setModelLanguageOverride('volcengine', 'model-1', 'English');
            removeModelLanguageOverride('volcengine', 'model-1');
            expect(getModelLanguageOverride('volcengine', 'model-1')).toBeNull();
        });
    });

    // ── 完整设置读写 ──────────────────────────

    describe('getTextSettings / updateTextSettings', () => {
        it('返回默认设置', () => {
            const settings = getTextSettings();
            expect(settings.providers).toEqual([]);
            expect(settings.streaming).toBe(false);
            expect(settings.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE);
            expect(settings.promptLanguage).toBe('中文');
        });

        it('批量更新设置', () => {
            updateTextSettings({
                streaming: true,
                promptLanguage: 'English',
            });
            const settings = getTextSettings();
            expect(settings.streaming).toBe(true);
            expect(settings.promptLanguage).toBe('English');
        });
    });

    // ── 模板渲染 ──────────────────────────

    describe('renderPromptTemplate', () => {
        it('替换 input 和 lang 占位符', () => {
            const template = '请用${lang}优化: ${input}';
            const result = renderPromptTemplate(template, '一只猫', '中文');
            expect(result).toBe('请用中文优化: 一只猫');
        });

        it('多次出现占位符全部替换', () => {
            const template = '${input} → ${lang}, 重复 ${input}';
            const result = renderPromptTemplate(template, 'test', 'EN');
            expect(result).toBe('test → EN, 重复 test');
        });
    });

    // ── 模板校验 ──────────────────────────

    describe('validatePromptTemplate', () => {
        it('有 input 和 lang 时通过', () => {
            const result = validatePromptTemplate('${input} ${lang}');
            expect(result.valid).toBe(true);
            expect(result.warnings).toHaveLength(0);
        });

        it('无 input 时校验失败', () => {
            const result = validatePromptTemplate('没有占位符');
            expect(result.valid).toBe(false);
        });

        it('有 input 无 lang 时给出警告', () => {
            const result = validatePromptTemplate('只有 ${input}');
            expect(result.valid).toBe(true);
            expect(result.warnings).toHaveLength(1);
        });
    });

    // ── 预置提供商 ──────────────────────────

    describe('PRESET_PROVIDERS', () => {
        it('包含 4 个预置提供商', () => {
            expect(PRESET_PROVIDERS).toHaveLength(4);
        });

        it('AIHubMix 有 appCode 字段', () => {
            const aihubmix = PRESET_PROVIDERS.find(p => p.name === 'aihubmix-text');
            expect(aihubmix).toBeDefined();
            expect(aihubmix).toHaveProperty('appCode');
        });

        it('所有预置提供商都有 type 字段', () => {
            for (const p of PRESET_PROVIDERS) {
                expect(p.type).toBe('openai');
            }
        });
    });
});
