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
    retry_count: number;
    created_at: string;
    updated_at: string;
}

export interface InsertTaskParams {
    provider: string;
    prompt: string;
    model?: string;
    imageUrl?: string;
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
    INSERT INTO tasks (provider, prompt, model, image_url)
    VALUES (@provider, @prompt, @model, @imageUrl)
  `);
    const result = stmt.run({
        provider: params.provider,
        prompt: params.prompt,
        model: params.model ?? null,
        imageUrl: params.imageUrl ?? null,
    });
    const insertedId = Number(result.lastInsertRowid);
    const task = getTaskById(insertedId);
    if (!task) {
        throw new Error(`Failed to retrieve task after insertion, id: ${insertedId}`);
    }
    return task;
}

/** 根据 id 获取单条任务 */
export function getTaskById(id: number): Task | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
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
        .prepare("SELECT * FROM tasks WHERE status IN ('pending', 'running')")
        .all() as Task[];
}

/** 获取所有任务，按创建时间倒序 */
export function getAllTasks(): Task[] {
    const db = getDb();
    return db
        .prepare('SELECT * FROM tasks ORDER BY id DESC')
        .all() as Task[];
}

/** 删除指定任务，返回是否成功删除 */
export function deleteTask(id: number): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return result.changes > 0;
}
