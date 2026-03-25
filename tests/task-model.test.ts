import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, initDb, closeDb } from '../src/server/database.js';
import {
    type Task,
    insertTask,
    getTaskById,
    updateTaskStatus,
    getRunningTasks,
} from '../src/server/task-model.js';

describe('数据库初始化', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    it('initDb 应创建 tasks 表', () => {
        const db = getDb();
        const table = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
            )
            .get() as { name: string } | undefined;
        expect(table).toBeDefined();
        expect(table!.name).toBe('tasks');
    });

    it('tasks 表应包含所有必要字段', () => {
        const db = getDb();
        const columns = db.prepare('PRAGMA table_info(tasks)').all() as Array<{
            name: string;
            type: string;
        }>;
        const colNames = columns.map((c) => c.name);
        expect(colNames).toContain('id');
        expect(colNames).toContain('provider');
        expect(colNames).toContain('provider_task_id');
        expect(colNames).toContain('status');
        expect(colNames).toContain('prompt');
        expect(colNames).toContain('model');
        expect(colNames).toContain('image_url');
        expect(colNames).toContain('result_url');
        expect(colNames).toContain('error_message');
        expect(colNames).toContain('retry_count');
        expect(colNames).toContain('created_at');
        expect(colNames).toContain('updated_at');
    });
});

describe('Task CRUD 操作', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    describe('insertTask', () => {
        it('应成功插入任务并返回包含 id 的完整任务对象', () => {
            const task = insertTask({
                provider: 'siliconflow',
                prompt: '一只猫在跳舞',
                model: 'Wan-AI/Wan2.1-T2V-14B',
            });
            expect(task).toBeDefined();
            expect(task.id).toBeTypeOf('number');
            expect(task.provider).toBe('siliconflow');
            expect(task.prompt).toBe('一只猫在跳舞');
            expect(task.model).toBe('Wan-AI/Wan2.1-T2V-14B');
            expect(task.status).toBe('pending');
            expect(task.retry_count).toBe(0);
            expect(task.created_at).toBeTruthy();
            expect(task.updated_at).toBeTruthy();
        });

        it('应允许插入带 image_url 的任务 (i2v)', () => {
            const task = insertTask({
                provider: 'siliconflow',
                prompt: '让图片中的人物动起来',
                model: 'Wan-AI/Wan2.1-I2V-14B',
                imageUrl: 'https://example.com/image.png',
            });
            expect(task.image_url).toBe('https://example.com/image.png');
        });

        it('插入多条任务时 id 应递增', () => {
            const t1 = insertTask({ provider: 'mock', prompt: 'test1' });
            const t2 = insertTask({ provider: 'mock', prompt: 'test2' });
            expect(t2.id).toBeGreaterThan(t1.id);
        });
    });

    describe('getTaskById', () => {
        it('应返回指定 id 的任务', () => {
            const inserted = insertTask({
                provider: 'siliconflow',
                prompt: '测试获取',
            });
            const found = getTaskById(inserted.id);
            expect(found).toBeDefined();
            expect(found!.id).toBe(inserted.id);
            expect(found!.prompt).toBe('测试获取');
        });

        it('查询不存在的 id 应返回 undefined', () => {
            const found = getTaskById(9999);
            expect(found).toBeUndefined();
        });
    });

    describe('updateTaskStatus', () => {
        it('应更新任务状态', () => {
            const task = insertTask({ provider: 'mock', prompt: 'update test' });
            updateTaskStatus(task.id, 'running');
            const updated = getTaskById(task.id);
            expect(updated!.status).toBe('running');
        });

        it('应更新状态并附带 provider_task_id', () => {
            const task = insertTask({ provider: 'mock', prompt: 'test' });
            updateTaskStatus(task.id, 'running', {
                providerTaskId: 'provider-123',
            });
            const updated = getTaskById(task.id);
            expect(updated!.status).toBe('running');
            expect(updated!.provider_task_id).toBe('provider-123');
        });

        it('应更新状态并附带 result_url', () => {
            const task = insertTask({ provider: 'mock', prompt: 'test' });
            updateTaskStatus(task.id, 'success', {
                resultUrl: '/videos/abc.mp4',
            });
            const updated = getTaskById(task.id);
            expect(updated!.status).toBe('success');
            expect(updated!.result_url).toBe('/videos/abc.mp4');
        });

        it('应更新状态并附带 error_message', () => {
            const task = insertTask({ provider: 'mock', prompt: 'test' });
            updateTaskStatus(task.id, 'failed', {
                errorMessage: 'API 调用失败',
            });
            const updated = getTaskById(task.id);
            expect(updated!.status).toBe('failed');
            expect(updated!.error_message).toBe('API 调用失败');
        });

        it('更新时应同步刷新 updated_at', () => {
            const task = insertTask({ provider: 'mock', prompt: 'test' });
            // 手动将 updated_at 设为过去时间，确保更新后不同
            const db = getDb();
            db.prepare("UPDATE tasks SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(task.id);
            const before = getTaskById(task.id);
            expect(before!.updated_at).toBe('2000-01-01 00:00:00');

            updateTaskStatus(task.id, 'running');
            const updated = getTaskById(task.id);
            expect(updated!.updated_at).not.toBe('2000-01-01 00:00:00');
        });

        it('应能递增 retry_count', () => {
            const task = insertTask({ provider: 'mock', prompt: 'test' });
            expect(task.retry_count).toBe(0);
            updateTaskStatus(task.id, 'pending', { incrementRetry: true });
            const updated = getTaskById(task.id);
            expect(updated!.retry_count).toBe(1);
        });
    });

    describe('getRunningTasks', () => {
        it('应返回所有 pending 和 running 状态的任务', () => {
            insertTask({ provider: 'mock', prompt: 'pending task' });
            const t2 = insertTask({ provider: 'mock', prompt: 'running task' });
            const t3 = insertTask({ provider: 'mock', prompt: 'success task' });
            const t4 = insertTask({ provider: 'mock', prompt: 'failed task' });

            updateTaskStatus(t2.id, 'running');
            updateTaskStatus(t3.id, 'success');
            updateTaskStatus(t4.id, 'failed');

            const running = getRunningTasks();
            expect(running).toHaveLength(2);
            const statuses = running.map((t: Task) => t.status);
            expect(statuses).toContain('pending');
            expect(statuses).toContain('running');
        });

        it('没有活跃任务时应返回空数组', () => {
            const running = getRunningTasks();
            expect(running).toHaveLength(0);
        });
    });
});
