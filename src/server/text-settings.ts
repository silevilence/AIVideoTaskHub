/**
 * 文本提供商（Text Provider）配置与 Prompt 模板管理。
 * 数据通过 settings 表持久化存储。
 */
import { getSetting, setSetting } from './task-model.js';

// ── 类型定义 ──────────────────────────

export interface TextModel {
    id: string;
    displayName: string;
    reasoning: boolean;
}

export type TextProviderType = 'openai' | 'ollama';

export interface TextProviderConfig {
    name: string;
    displayName: string;
    baseUrl: string;
    apiKey: string;
    apiKeySource: string; // 'own' | 'video:<providerName>'
    appCode?: string;
    models: TextModel[];
    isPreset: boolean;
    type: TextProviderType;
}

export interface TextSettings {
    providers: TextProviderConfig[];
    streaming: boolean;
    promptTemplate: string;
    promptLanguage: string;
}

export interface ModelLanguageOverride {
    videoProvider: string;
    modelId: string;
    language: string;
}

// ── 预置提供商 ──────────────────────────

export const AIHUBMIX_APP_CODE = 'ATUH2466';

export const PRESET_PROVIDERS: Omit<TextProviderConfig, 'apiKey' | 'apiKeySource' | 'models'>[] = [
    {
        name: 'deepseek',
        displayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        isPreset: true,
        type: 'openai',
    },
    {
        name: 'siliconflow-text',
        displayName: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1',
        isPreset: true,
        type: 'openai',
    },
    {
        name: 'volcengine-text',
        displayName: '火山引擎',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        isPreset: true,
        type: 'openai',
    },
    {
        name: 'aihubmix-text',
        displayName: 'AIHubMix',
        baseUrl: 'https://aihubmix.com/v1',
        appCode: 'ATUH2466',
        isPreset: true,
        type: 'openai',
    },
];

// ── 默认 Prompt 模板 ──────────────────────────

export const DEFAULT_PROMPT_TEMPLATE = `你是一位资深的 AI 视频生成提示词（Prompt）专家与电影视觉导演。你的任务是将用户简单的原始描述，扩写并优化为高质量、细节丰富、画面感极强的视频生成提示词。

### 【优化维度】
请基于用户的原始输入，在不改变核心意图的前提下，从以下维度进行合理想象与扩充：
1. **具体场景（Scene）**：细化画面的核心主体（外貌/穿着/神态）、具体动作细节、所处环境（前景/背景）、光线条件（如：清晨柔和的自然光、赛博朋克霓虹灯、电影级体积光）以及整体氛围（如：温馨、悬疑、宏大）。
2. **镜头语言（Camera）**：补充专业的摄影机运动和景别描述，如："面部特写"、"大远景航拍"、"缓慢推镜头"、"环绕跟拍"、"120帧慢动作"等。
3. **视觉风格（Style）**：赋予明确的影像或艺术风格，如："好莱坞电影感"、"8mm复古胶片"、"BBC野生动物纪录片风格"、"吉卜力动画风格"、"8k超清写实"。
4. **音频描述（Audio）**：如果场景适合，请自然地融入与画面匹配的声音描述，如："清脆的鸟鸣声"、"空灵的钢琴旋律"、"嘈杂的街道环境音"、"呼啸的风声"，以辅助视频模型生成音效。

### 【输出要求】
- **语言限制**：必须严格使用 **\${lang}** 输出最终的提示词。词语之间衔接自然，富有画面感。
- **直接输出**：仅输出优化后的提示词文本，**严禁**包含任何解释性话语（如"好的"、"为您优化如下"、"解析"等）。
- **格式要求**：保持段落连贯，不要使用 Markdown 列表格式输出结果，直接输出一段或多段结构紧凑的纯文本描述。
- **忠于原意**：必须包含用户的核心诉求，绝不能偏离原始主题。

---
用户的原始输入：
\${input}`;

// ── Settings 存取 ──────────────────────────

const KEY_PROVIDERS = 'text:providers';
const KEY_STREAMING = 'text:streaming';
const KEY_PROMPT_TEMPLATE = 'text:prompt_template';
const KEY_PROMPT_LANGUAGE = 'text:prompt_language';

function modelLanguageKey(videoProvider: string, modelId: string): string {
    return `text:model_language:${videoProvider}:${modelId}`;
}

/** 获取所有文本提供商配置 */
export function getTextProviders(): TextProviderConfig[] {
    const raw = getSetting(KEY_PROVIDERS);
    if (!raw) return [];
    try {
        return JSON.parse(raw) as TextProviderConfig[];
    } catch {
        return [];
    }
}

/** 保存所有文本提供商配置 */
export function saveTextProviders(providers: TextProviderConfig[]): void {
    setSetting(KEY_PROVIDERS, JSON.stringify(providers));
}

/** 获取流式输出开关 */
export function getStreamingSetting(): boolean {
    const val = getSetting(KEY_STREAMING);
    return val === 'true';
}

/** 设置流式输出开关 */
export function setStreamingSetting(enabled: boolean): void {
    setSetting(KEY_STREAMING, enabled ? 'true' : 'false');
}

/** 获取自定义 Prompt 模板（无则返回默认） */
export function getPromptTemplate(): string {
    return getSetting(KEY_PROMPT_TEMPLATE) || DEFAULT_PROMPT_TEMPLATE;
}

/** 保存自定义 Prompt 模板 */
export function savePromptTemplate(template: string): void {
    setSetting(KEY_PROMPT_TEMPLATE, template);
}

/** 重置 Prompt 模板为默认 */
export function resetPromptTemplate(): void {
    setSetting(KEY_PROMPT_TEMPLATE, DEFAULT_PROMPT_TEMPLATE);
}

/** 获取全局 Prompt 输出语言 */
export function getPromptLanguage(): string {
    return getSetting(KEY_PROMPT_LANGUAGE) || '中文';
}

/** 设置全局 Prompt 输出语言 */
export function setPromptLanguage(language: string): void {
    setSetting(KEY_PROMPT_LANGUAGE, language);
}

/** 获取某个视频模型的语言覆盖 */
export function getModelLanguageOverride(videoProvider: string, modelId: string): string | null {
    return getSetting(modelLanguageKey(videoProvider, modelId)) || null;
}

/** 设置某个视频模型的语言覆盖 */
export function setModelLanguageOverride(videoProvider: string, modelId: string, language: string): void {
    setSetting(modelLanguageKey(videoProvider, modelId), language);
}

/** 删除某个视频模型的语言覆盖 */
export function removeModelLanguageOverride(videoProvider: string, modelId: string): void {
    setSetting(modelLanguageKey(videoProvider, modelId), '');
}

/** 获取完整的文本设置 */
export function getTextSettings(): TextSettings {
    return {
        providers: getTextProviders(),
        streaming: getStreamingSetting(),
        promptTemplate: getPromptTemplate(),
        promptLanguage: getPromptLanguage(),
    };
}

/** 批量更新文本设置 */
export function updateTextSettings(settings: Partial<TextSettings>): void {
    if (settings.providers !== undefined) {
        saveTextProviders(settings.providers);
    }
    if (settings.streaming !== undefined) {
        setStreamingSetting(settings.streaming);
    }
    if (settings.promptTemplate !== undefined) {
        savePromptTemplate(settings.promptTemplate);
    }
    if (settings.promptLanguage !== undefined) {
        setPromptLanguage(settings.promptLanguage);
    }
}

/** 渲染 Prompt 模板，替换占位符 */
export function renderPromptTemplate(template: string, input: string, language: string): string {
    return template.replace(/\$\{input\}/g, input).replace(/\$\{lang\}/g, language);
}

/** 校验 Prompt 模板 */
export function validatePromptTemplate(template: string): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];
    const hasInput = template.includes('${input}');
    const hasLang = template.includes('${lang}');

    if (!hasInput) {
        return { valid: false, warnings: ['模板必须包含 ${input} 占位符'] };
    }
    if (!hasLang) {
        warnings.push('模板中没有 ${lang} 占位符，输出语言将不可控');
    }

    return { valid: true, warnings };
}
