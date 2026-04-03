/**
 * OpenAI 兼容 API 客户端。
 * 支持流式和非流式调用。
 */

import { logger } from './logger.js';

export interface LLMRequestOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: { role: string; content: string }[];
    stream?: boolean;
    appCode?: string;
    signal?: AbortSignal;
}

export interface LLMResponse {
    content: string;
    finishReason: string | null;
}

/**
 * 非流式调用 LLM
 */
export async function callLLM(options: LLMRequestOptions): Promise<LLMResponse> {
    const { baseUrl, apiKey, model, messages, appCode, signal } = options;

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
    if (appCode) {
        headers['APP-Code'] = appCode;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages,
            stream: false,
        }),
        signal,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`LLM API 请求失败 (${response.status}): ${text}`);
    }

    const data = await response.json() as {
        choices: { message: { content: string }; finish_reason: string | null }[];
    };

    if (!data.choices || data.choices.length === 0) {
        throw new Error('LLM API 返回空结果');
    }

    return {
        content: data.choices[0].message.content,
        finishReason: data.choices[0].finish_reason,
    };
}

/**
 * 流式调用 LLM，返回 SSE 格式的 ReadableStream
 */
export async function callLLMStream(options: LLMRequestOptions): Promise<ReadableStream<Uint8Array>> {
    const { baseUrl, apiKey, model, messages, appCode, signal } = options;

    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
    if (appCode) {
        headers['APP-Code'] = appCode;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            messages,
            stream: true,
        }),
        signal,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`LLM API 请求失败 (${response.status}): ${text}`);
    }

    if (!response.body) {
        throw new Error('LLM API 返回无响应体');
    }

    return response.body;
}

/**
 * 从 OpenAI 兼容 API 拉取模型列表
 */
export async function fetchLLMModels(
    baseUrl: string,
    apiKey: string,
    appCode?: string,
): Promise<{ id: string; owned_by?: string }[]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
    };
    if (appCode) {
        headers['APP-Code'] = appCode;
    }

    logger.debug(`fetchLLMModels: GET ${url}`);
    const response = await fetch(url, { headers });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        logger.warn(`fetchLLMModels 失败: ${response.status} ${url} - ${text.slice(0, 200)}`);
        throw new Error(`获取模型列表失败 (${response.status}): ${text}`);
    }

    const data = await response.json() as { data: { id: string; owned_by?: string }[] };
    return data.data || [];
}
