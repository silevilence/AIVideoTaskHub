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
    retry_count: number;
    created_at: string;
    updated_at: string;
}

const BASE = '/api';

export async function fetchTasks(): Promise<Task[]> {
    const res = await fetch(`${BASE}/tasks`);
    if (!res.ok) throw new Error('获取任务列表失败');
    return res.json();
}

export async function fetchProviders(): Promise<string[]> {
    const res = await fetch(`${BASE}/providers`);
    if (!res.ok) throw new Error('获取 Provider 列表失败');
    return res.json();
}

export async function fetchProviderModels(): Promise<Record<string, string[]>> {
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

export interface Settings {
    siliconflowApiKey: string;
}

export async function fetchSettings(): Promise<Settings> {
    const res = await fetch(`${BASE}/settings`);
    if (!res.ok) throw new Error('获取设置失败');
    return res.json();
}

export async function updateSettings(settings: Partial<Settings>): Promise<void> {
    const res = await fetch(`${BASE}/settings`, {
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
