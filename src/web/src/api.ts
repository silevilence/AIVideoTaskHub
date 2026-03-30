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
    firstLastFrame: boolean;
    referenceImage: boolean;
    audio: boolean;
    cameraFixed: boolean;
    draft: boolean;
    resolutions: string[];
    durationRange: [number, number];
    autoDuration: boolean;
    defaultResolution: string;
    ratios?: string[];
}

export interface ModelInfo {
    id: string;
    displayName: string;
    capabilities?: ModelCapabilities;
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
}

export interface ProviderSettings {
    displayName: string;
    schema: ProviderSettingSchema[];
    values: Record<string, string>;
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

export async function fetchTrashTasks(): Promise<TrashTask[]> {
    const res = await fetch(`${BASE}/trash`);
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
