import { getDb } from './database.js';

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
}

export interface InsertTaskParams {
    provider: string;
    prompt: string;
    model?: string;
    imageUrl?: string;
    extraParams?: Record<string, unknown>;
}

export interface UpdateStatusExtras {
    providerTaskId?: string;
    resultUrl?: string;
    errorMessage?: string;
    incrementRetry?: boolean;
}

/** 插入一条新任务，返回完整的任务对象 */
export function insertTask(params: InsertTaskParams): Task {
    const db = getDb();
    const stmt = db.prepare(`
    INSERT INTO tasks (provider, prompt, model, image_url, extra_params)
    VALUES (@provider, @prompt, @model, @imageUrl, @extraParams)
  `);
    const result = stmt.run({
        provider: params.provider,
        prompt: params.prompt,
        model: params.model ?? null,
        imageUrl: params.imageUrl ?? null,
        extraParams: params.extraParams ? JSON.stringify(params.extraParams) : null,
    });
    const insertedId = Number(result.lastInsertRowid);
    const task = getTaskById(insertedId);
    if (!task) {
        throw new Error(`Failed to retrieve task after insertion, id: ${insertedId}`);
    }
    return task;
}

/** 根据 id 获取单条任务（排除已软删除） */
export function getTaskById(id: number): Task | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as
        | Task
        | undefined;
}

/** 更新任务状态，可附带额外字段 */
export function updateTaskStatus(
    id: number,
    status: string,
    extras?: UpdateStatusExtras
): void {
    const db = getDb();
    const sets: string[] = ["status = @status", "updated_at = datetime('now')"];
    const params: Record<string, unknown> = { id, status };

    if (extras?.providerTaskId !== undefined) {
        sets.push('provider_task_id = @providerTaskId');
        params.providerTaskId = extras.providerTaskId;
    }
    if (extras?.resultUrl !== undefined) {
        sets.push('result_url = @resultUrl');
        params.resultUrl = extras.resultUrl;
    }
    if (extras?.errorMessage !== undefined) {
        sets.push('error_message = @errorMessage');
        params.errorMessage = extras.errorMessage;
    }
    if (extras?.incrementRetry) {
        sets.push('retry_count = retry_count + 1');
    }

    const sql = `UPDATE tasks SET ${sets.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(params);
}

/** 获取所有处于 pending 或 running 状态的任务 */
export function getRunningTasks(): Task[] {
    const db = getDb();
    return db
        .prepare("SELECT * FROM tasks WHERE status IN ('pending', 'running') AND deleted_at IS NULL")
        .all() as Task[];
}

/** 获取所有任务，按创建时间倒序（排除已软删除） */
export function getAllTasks(): Task[] {
    const db = getDb();
    return db
        .prepare('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY id DESC')
        .all() as Task[];
}

/** 软删除指定任务，返回是否成功 */
export function deleteTask(id: number): boolean {
    const db = getDb();
    const result = db.prepare("UPDATE tasks SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
    return result.changes > 0;
}

/** 筛选任务列表 */
export interface TaskFilter {
    providers?: string[];
    statuses?: string[];
    prompt?: string;
    startDate?: string;
    endDate?: string;
}

export function filterTasks(filter: TaskFilter): Task[] {
    const db = getDb();
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: Record<string, unknown> = {};

    if (filter.providers && filter.providers.length > 0) {
        const placeholders = filter.providers.map((_, i) => `@p${i}`);
        conditions.push(`provider IN (${placeholders.join(', ')})`);
        filter.providers.forEach((p, i) => { params[`p${i}`] = p; });
    }

    if (filter.statuses && filter.statuses.length > 0) {
        const placeholders = filter.statuses.map((_, i) => `@s${i}`);
        conditions.push(`status IN (${placeholders.join(', ')})`);
        filter.statuses.forEach((s, i) => { params[`s${i}`] = s; });
    }

    if (filter.prompt) {
        conditions.push('prompt LIKE @prompt');
        params.prompt = `%${filter.prompt}%`;
    }

    if (filter.startDate) {
        conditions.push('created_at >= @startDate');
        params.startDate = filter.startDate;
    }

    if (filter.endDate) {
        conditions.push('created_at <= @endDate');
        params.endDate = filter.endDate;
    }

    const sql = `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY id DESC`;
    return db.prepare(sql).all(params) as Task[];
}

/** 读取一条设置 */
export function getSetting(key: string): string | undefined {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
}

/** 写入/更新一条设置 */
export function setSetting(key: string, value: string): void {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
