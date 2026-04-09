export interface Task {
    id: number;
    provider: string;
    provider_task_id: string | null;
    status: string;
    prompt: string;
    model: string | null;
    image_url: string | null;
    result_url: string | null;
    error_message: string | null;
    extra_params: string | null;
    retry_count: number;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    purged_at: string | null;
}

const BASE = '/api';

export interface ProviderInfo {
    name: string;
    displayName: string;
}

export interface TaskFilter {
    providers?: string[];
    statuses?: string[];
    prompt?: string;
    startDate?: string;
    endDate?: string;
}

export async function fetchTasks(filter?: TaskFilter): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filter?.providers?.length) params.set('providers', filter.providers.join(','));
    if (filter?.statuses?.length) params.set('statuses', filter.statuses.join(','));
    if (filter?.prompt) params.set('prompt', filter.prompt);
    if (filter?.startDate) params.set('startDate', filter.startDate);
    if (filter?.endDate) params.set('endDate', filter.endDate);
    const qs = params.toString();
    const res = await fetch(`${BASE}/tasks${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('获取任务列表失败');
    return res.json();
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
    const res = await fetch(`${BASE}/providers`);
    if (!res.ok) throw new Error('获取 Provider 列表失败');
    return res.json();
}

export interface ModelCapabilities {
    i2v: boolean;
    i2vOnly?: boolean;
    firstLastFrame: boolean;
    referenceImage: boolean;
    audio: boolean;
    cameraFixed: boolean;
    draft: boolean;
    resolutions: string[];
    durationRange: [number, number];
    durationOptions?: number[];
    i2vDurationOptions?: number[];
    autoDuration: boolean;
    defaultResolution: string;
    ratios?: string[];
}

export interface ModelInfo {
    id: string;
    displayName: string;
    capabilities?: ModelCapabilities;
    disabled?: boolean;
    disabledReason?: string;
}

export async function fetchProviderModels(): Promise<Record<string, ModelInfo[]>> {
    const res = await fetch(`${BASE}/providers/models`);
    if (!res.ok) throw new Error('获取模型列表失败');
    return res.json();
}

export async function uploadImage(file: File): Promise<{ url: string; base64: string }> {
    const res = await fetch(`${BASE}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '上传图片失败');
    }
    return res.json();
}

export interface ProviderSettingSchema {
    key: string;
    label: string;
    secret?: boolean;
    required?: boolean;
    defaultValue?: string;
    description?: string;
    options?: { value: string; label: string }[];
}

export interface ProviderSettings {
    displayName: string;
    schema: ProviderSettingSchema[];
    values: Record<string, string>;
    sources: Record<string, 'env' | 'saved' | 'none'>;
    supportsModelRefresh?: boolean;
    modelsUpdatedAt?: string;
}

export async function fetchSettings(): Promise<Record<string, ProviderSettings>> {
    const res = await fetch(`${BASE}/settings`);
    if (!res.ok) throw new Error('获取设置失败');
    return res.json();
}

export async function updateProviderSettings(provider: string, settings: Record<string, string>): Promise<void> {
    const res = await fetch(`${BASE}/settings/${encodeURIComponent(provider)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('保存设置失败');
}

export async function refreshProviderModels(provider: string): Promise<{ models: ModelInfo[]; updatedAt: string }> {
    const res = await fetch(`${BASE}/providers/${encodeURIComponent(provider)}/refresh-models`, {
        method: 'POST',
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '刷新模型失败');
    }
    return res.json();
}

export async function createTask(params: {
    provider: string;
    prompt: string;
    model?: string;
    imageUrl?: string;
    extra?: Record<string, unknown>;
}): Promise<Task> {
    const res = await fetch(`${BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '创建任务失败');
    }
    return res.json();
}

export async function retryTask(id: number): Promise<Task> {
    const res = await fetch(`${BASE}/tasks/${id}/retry`, { method: 'POST' });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '重试任务失败');
    }
    return res.json();
}

export async function deleteTask(id: number): Promise<void> {
    const res = await fetch(`${BASE}/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除任务失败');
}

// ── 回收站 API ──────────────────────────

export interface TrashTask extends Task {
    file_size: number;
}

export interface TrashFilter {
    providers?: string[];
    statuses?: string[];
    prompt?: string;
    deletedStartDate?: string;
    deletedEndDate?: string;
}

export async function fetchTrashTasks(filter?: TrashFilter): Promise<TrashTask[]> {
    const params = new URLSearchParams();
    if (filter?.providers?.length) params.set('providers', filter.providers.join(','));
    if (filter?.statuses?.length) params.set('statuses', filter.statuses.join(','));
    if (filter?.prompt) params.set('prompt', filter.prompt);
    if (filter?.deletedStartDate) params.set('deletedStartDate', filter.deletedStartDate);
    if (filter?.deletedEndDate) params.set('deletedEndDate', filter.deletedEndDate);
    const qs = params.toString();
    const res = await fetch(`${BASE}/trash${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('获取回收站任务列表失败');
    return res.json();
}

export async function fetchTrashTask(id: number): Promise<TrashTask> {
    const res = await fetch(`${BASE}/trash/${id}`);
    if (!res.ok) throw new Error('获取回收站任务详情失败');
    return res.json();
}

export async function purgeTask(id: number): Promise<void> {
    const res = await fetch(`${BASE}/trash/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '彻底删除任务失败');
    }
}

export async function restoreTask(id: number): Promise<Task> {
    const res = await fetch(`${BASE}/trash/${id}/restore`, { method: 'POST' });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '恢复任务失败');
    }
    return res.json();
}

// ── 已上传图片相关 ──────────────────────────

export interface UploadedImage {
    url: string;
    filename: string;
    size: number;
    createdAt: string;
}

export async function fetchUploadedImages(): Promise<UploadedImage[]> {
    const res = await fetch(`${BASE}/uploads`);
    if (!res.ok) throw new Error('获取已上传图片列表失败');
    return res.json();
}

// ── 参数套用相关类型 ──────────────────────────

export interface ApplyParams {
    provider: string;
    model: string | null;
    prompt: string;
    imageUrl: string | null;
    extraParams: Record<string, unknown>;
}

// ── 文本设置相关 ──────────────────────────

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
    apiKeySource: string;
    appCode?: string;
    models: TextModel[];
    isPreset: boolean;
    type: TextProviderType;
}

export interface PresetProvider {
    name: string;
    displayName: string;
    baseUrl: string;
    isPreset: boolean;
    appCode?: string;
    type: TextProviderType;
}

export interface TextSettings {
    providers: TextProviderConfig[];
    streaming: boolean;
    promptTemplate: string;
    promptLanguage: string;
    presetProviders: PresetProvider[];
}

export async function fetchTextSettings(): Promise<TextSettings> {
    const res = await fetch(`${BASE}/text-settings`);
    if (!res.ok) throw new Error('获取文本设置失败');
    return res.json();
}

export async function updateTextSettings(settings: Partial<Omit<TextSettings, 'presetProviders'>>): Promise<{ ok: boolean; warnings: string[] }> {
    const res = await fetch(`${BASE}/text-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '保存文本设置失败');
    }
    return res.json();
}

export async function fetchModelLanguageOverride(videoProvider: string, modelId: string): Promise<string | null> {
    const params = new URLSearchParams({ videoProvider, modelId });
    const res = await fetch(`${BASE}/text-settings/model-languages?${params}`);
    if (!res.ok) throw new Error('获取模型语言设置失败');
    const data = await res.json();
    return data.language;
}

export async function updateModelLanguageOverride(videoProvider: string, modelId: string, language: string): Promise<void> {
    const res = await fetch(`${BASE}/text-settings/model-languages`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoProvider, modelId, language }),
    });
    if (!res.ok) throw new Error('保存模型语言设置失败');
}

export async function fetchRemoteModels(provider: {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiKeySource: string;
    appCode?: string;
}): Promise<{ id: string; owned_by?: string }[]> {
    const res = await fetch(`${BASE}/text-settings/fetch-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            providerName: provider.name,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            apiKeySource: provider.apiKeySource,
            appCode: provider.appCode,
        }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || '获取远程模型列表失败');
    }
    return res.json();
}

export interface PromptOptimizeParams {
    input: string;
    providerName: string;
    modelId: string;
    streaming?: boolean;
    language?: string;
}

export async function optimizePrompt(params: PromptOptimizeParams): Promise<{ content: string; finishReason: string | null }> {
    const res = await fetch(`${BASE}/prompt/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Prompt 优化失败');
    }
    return res.json();
}

export async function optimizePromptStream(
    params: PromptOptimizeParams,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void,
): Promise<{ requestId: string; abort: () => void }> {
    const controller = new AbortController();
    const res = await fetch(`${BASE}/prompt/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, streaming: true }),
        signal: controller.signal,
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Prompt 优化失败');
    }

    const requestId = res.headers.get('X-Request-Id') || '';

    // 读取 SSE 流
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    (async () => {
        try {
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // 解析 SSE 事件
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            onDone();
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) {
                                onError(new Error(parsed.error));
                                return;
                            }
                            if (parsed.choices?.[0]?.delta?.content) {
                                onChunk(parsed.choices[0].delta.content);
                            }
                        } catch {
                            // 非 JSON 行，忽略
                        }
                    }
                }
            }
            onDone();
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                onError(err as Error);
            }
        }
    })();

    return {
        requestId,
        abort: () => {
            controller.abort();
            // 也通知服务端中断
            fetch(`${BASE}/prompt/optimize/abort`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId }),
            }).catch(() => {});
        },
    };
}

export async function abortPromptOptimize(requestId?: string): Promise<void> {
    await fetch(`${BASE}/prompt/optimize/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
    });
}
