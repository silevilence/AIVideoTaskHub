import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initDb, closeDb, getDb } from '../src/server/database.js';
import {
    insertTask,
    deleteTask,
    updateTaskStatus,
    getDeletedTasks,
    getDeletedTaskById,
    purgeTask,
    getTaskById,
    restoreTask,
} from '../src/server/task-model.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { createTaskRouter } from '../src/server/task-router.js';
import type { VideoProvider } from '../src/server/provider.js';

// ── Model 层测试 ──────────────────────────

describe('回收站 Model 操作', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    describe('getDeletedTasks', () => {
        it('应返回所有软删除且未彻底删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const t2 = insertTask({ provider: 'mock', prompt: '任务2' });
            const t3 = insertTask({ provider: 'mock', prompt: '任务3' });

            deleteTask(t1.id);
            deleteTask(t2.id);
            // t3 not deleted

            const deleted = getDeletedTasks();
            expect(deleted).toHaveLength(2);
            const ids = deleted.map(t => t.id);
            expect(ids).toContain(t1.id);
            expect(ids).toContain(t2.id);
            expect(ids).not.toContain(t3.id);
        });

        it('不应返回已彻底删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            deleteTask(t1.id);

            // 模拟彻底删除
            const db = getDb();
            db.prepare("UPDATE tasks SET purged_at = datetime('now') WHERE id = ?").run(t1.id);

            const deleted = getDeletedTasks();
            expect(deleted).toHaveLength(0);
        });

        it('无删除任务时应返回空数组', () => {
            insertTask({ provider: 'mock', prompt: '任务1' });
            const deleted = getDeletedTasks();
            expect(deleted).toHaveLength(0);
        });

        it('应按删除时间倒序排列', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const t2 = insertTask({ provider: 'mock', prompt: '任务2' });

            // 手动设置不同的删除时间以确保排序
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = '2024-01-01 00:00:00' WHERE id = ?").run(t1.id);
            db.prepare("UPDATE tasks SET deleted_at = '2024-01-02 00:00:00' WHERE id = ?").run(t2.id);

            const deleted = getDeletedTasks();
            // 后删除的排前面
            expect(deleted[0].id).toBe(t2.id);
            expect(deleted[1].id).toBe(t1.id);
        });

        it('应按 provider 筛选', () => {
            const t1 = insertTask({ provider: 'siliconflow', prompt: '任务1' });
            const t2 = insertTask({ provider: 'volcengine', prompt: '任务2' });
            deleteTask(t1.id);
            deleteTask(t2.id);

            const deleted = getDeletedTasks({ providers: ['siliconflow'] });
            expect(deleted).toHaveLength(1);
            expect(deleted[0].provider).toBe('siliconflow');
        });

        it('应按 status 筛选', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const t2 = insertTask({ provider: 'mock', prompt: '任务2' });
            updateTaskStatus(t1.id, 'success');
            updateTaskStatus(t2.id, 'failed');
            deleteTask(t1.id);
            deleteTask(t2.id);

            const deleted = getDeletedTasks({ statuses: ['failed'] });
            expect(deleted).toHaveLength(1);
            expect(deleted[0].id).toBe(t2.id);
        });

        it('应按 prompt 模糊筛选', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '一只猫在跳舞' });
            const t2 = insertTask({ provider: 'mock', prompt: '美丽的风景' });
            deleteTask(t1.id);
            deleteTask(t2.id);

            const deleted = getDeletedTasks({ prompt: '猫' });
            expect(deleted).toHaveLength(1);
            expect(deleted[0].id).toBe(t1.id);
        });

        it('应按删除时间范围筛选', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const t2 = insertTask({ provider: 'mock', prompt: '任务2' });
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = '2024-06-01 00:00:00' WHERE id = ?").run(t1.id);
            db.prepare("UPDATE tasks SET deleted_at = '2024-08-01 00:00:00' WHERE id = ?").run(t2.id);

            const deleted = getDeletedTasks({ deletedStartDate: '2024-07-01', deletedEndDate: '2024-09-01' });
            expect(deleted).toHaveLength(1);
            expect(deleted[0].id).toBe(t2.id);
        });

        it('多条件组合筛选应同时生效', () => {
            const t1 = insertTask({ provider: 'siliconflow', prompt: '猫在跳舞' });
            const t2 = insertTask({ provider: 'volcengine', prompt: '猫在唱歌' });
            const t3 = insertTask({ provider: 'siliconflow', prompt: '美丽风景' });
            deleteTask(t1.id);
            deleteTask(t2.id);
            deleteTask(t3.id);

            const deleted = getDeletedTasks({ providers: ['siliconflow'], prompt: '猫' });
            expect(deleted).toHaveLength(1);
            expect(deleted[0].id).toBe(t1.id);
        });
    });

    describe('getDeletedTaskById', () => {
        it('应返回软删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            deleteTask(t1.id);

            const found = getDeletedTaskById(t1.id);
            expect(found).toBeDefined();
            expect(found!.id).toBe(t1.id);
            expect(found!.deleted_at).toBeTruthy();
        });

        it('不应返回未删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const found = getDeletedTaskById(t1.id);
            expect(found).toBeUndefined();
        });

        it('不应返回已彻底删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            deleteTask(t1.id);
            const db = getDb();
            db.prepare("UPDATE tasks SET purged_at = datetime('now') WHERE id = ?").run(t1.id);

            const found = getDeletedTaskById(t1.id);
            expect(found).toBeUndefined();
        });
    });

    describe('purgeTask', () => {
        it('应彻底删除超过30天的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            // 设置 deleted_at 为 31 天前
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(t1.id);

            const result = purgeTask(t1.id);
            expect(result.success).toBe(true);

            // 回收站中不再可见
            const found = getDeletedTaskById(t1.id);
            expect(found).toBeUndefined();
        });

        it('不应彻底删除未达30天的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-29 days') WHERE id = ?").run(t1.id);

            const result = purgeTask(t1.id);
            expect(result.success).toBe(false);
            expect(result.error).toContain('30');
        });

        it('不应彻底删除未软删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });

            const result = purgeTask(t1.id);
            expect(result.success).toBe(false);
        });

        it('应返回需要清理的文件路径', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1', imageUrl: '/uploads/test.png' });
            updateTaskStatus(t1.id, 'success', { resultUrl: '/videos/test.mp4' });
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(t1.id);

            const result = purgeTask(t1.id);
            expect(result.success).toBe(true);
            expect(result.filesToDelete).toContain('/uploads/test.png');
            expect(result.filesToDelete).toContain('/videos/test.mp4');
        });

        it('外部URL不应出现在清理文件列表中', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1', imageUrl: 'https://example.com/img.png' });
            updateTaskStatus(t1.id, 'success', { resultUrl: '/videos/test.mp4' });
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(t1.id);

            const result = purgeTask(t1.id);
            expect(result.filesToDelete).not.toContain('https://example.com/img.png');
            expect(result.filesToDelete).toContain('/videos/test.mp4');
        });

        it('不存在的任务应返回失败', () => {
            const result = purgeTask(99999);
            expect(result.success).toBe(false);
        });
    });

    describe('restoreTask', () => {
        it('应恢复软删除的任务', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            deleteTask(t1.id);

            // 确认在回收站中
            expect(getDeletedTaskById(t1.id)).toBeDefined();
            expect(getTaskById(t1.id)).toBeUndefined();

            const success = restoreTask(t1.id);
            expect(success).toBe(true);

            // 已从回收站移出
            expect(getDeletedTaskById(t1.id)).toBeUndefined();
            // 恢复到正常任务列表
            const restored = getTaskById(t1.id);
            expect(restored).toBeDefined();
            expect(restored!.deleted_at).toBeNull();
        });

        it('未删除的任务无法恢复', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const success = restoreTask(t1.id);
            expect(success).toBe(false);
        });

        it('已彻底删除的任务无法恢复', () => {
            const t1 = insertTask({ provider: 'mock', prompt: '任务1' });
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(t1.id);
            purgeTask(t1.id);

            const success = restoreTask(t1.id);
            expect(success).toBe(false);
        });

        it('不存在的任务无法恢复', () => {
            const success = restoreTask(99999);
            expect(success).toBe(false);
        });
    });
});

// ── Router 层测试 ──────────────────────────

function createMockProvider(name = 'mock', models = ['model-a']): VideoProvider {
    return {
        name,
        displayName: name,
        models,
        createTask: vi.fn().mockResolvedValue({ providerTaskId: 'prov-123' }),
        getStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
        downloadVideo: vi.fn().mockResolvedValue(undefined),
        getSettingsSchema: vi.fn().mockReturnValue([]),
        getModelsInfo: vi.fn().mockReturnValue(models.map((id) => ({ id, displayName: id }))),
        applySettings: vi.fn(),
        getCurrentSettings: vi.fn().mockReturnValue({}),
    };
}

function setupApp(registry: ProviderRegistry) {
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(registry));
    return app;
}

describe('回收站 API', () => {
    let registry: ProviderRegistry;
    let app: ReturnType<typeof express>;

    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        registry.register(createMockProvider());
        app = setupApp(registry);
    });

    describe('GET /api/trash', () => {
        it('应返回所有软删除的任务', async () => {
            // 创建并删除任务
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '回收站任务' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            const res = await request(app).get('/api/trash');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].prompt).toBe('回收站任务');
            expect(res.body[0].deleted_at).toBeTruthy();
        });

        it('不应返回正常任务', async () => {
            await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '正常任务' });

            const res = await request(app).get('/api/trash');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(0);
        });

        it('应包含文件大小信息', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '测试' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            const res = await request(app).get('/api/trash');
            expect(res.status).toBe(200);
            // 每个任务应有 file_size 字段（即使为0）
            expect(res.body[0]).toHaveProperty('file_size');
        });

        it('应支持按 provider 筛选', async () => {
            const registry2 = new ProviderRegistry();
            registry2.register(createMockProvider('mock'));
            registry2.register(createMockProvider('other', ['model-b']));
            const app2 = setupApp(registry2);

            const r1 = await request(app2).post('/api/tasks').send({ provider: 'mock', prompt: '任务1' });
            const r2 = await request(app2).post('/api/tasks').send({ provider: 'other', prompt: '任务2' });
            await request(app2).delete(`/api/tasks/${r1.body.id}`);
            await request(app2).delete(`/api/tasks/${r2.body.id}`);

            const res = await request(app2).get('/api/trash?providers=mock');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].provider).toBe('mock');
        });

        it('应支持按 status 筛选', async () => {
            const r1 = await request(app).post('/api/tasks').send({ provider: 'mock', prompt: '成功任务' });
            const r2 = await request(app).post('/api/tasks').send({ provider: 'mock', prompt: '失败任务' });
            const db = getDb();
            db.prepare("UPDATE tasks SET status = 'success' WHERE id = ?").run(r1.body.id);
            db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(r2.body.id);
            await request(app).delete(`/api/tasks/${r1.body.id}`);
            await request(app).delete(`/api/tasks/${r2.body.id}`);

            const res = await request(app).get('/api/trash?statuses=failed');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].prompt).toBe('失败任务');
        });

        it('应支持按 prompt 搜索', async () => {
            const r1 = await request(app).post('/api/tasks').send({ provider: 'mock', prompt: '一只猫在跳舞' });
            const r2 = await request(app).post('/api/tasks').send({ provider: 'mock', prompt: '美丽的风景' });
            await request(app).delete(`/api/tasks/${r1.body.id}`);
            await request(app).delete(`/api/tasks/${r2.body.id}`);

            const res = await request(app).get('/api/trash?prompt=猫');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].prompt).toContain('猫');
        });

        it('应支持按删除时间范围筛选', async () => {
            const r1 = await request(app).post('/api/tasks').send({ provider: 'mock', prompt: '旧任务' });
            const r2 = await request(app).post('/api/tasks').send({ provider: 'mock', prompt: '新任务' });
            await request(app).delete(`/api/tasks/${r1.body.id}`);
            await request(app).delete(`/api/tasks/${r2.body.id}`);

            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = '2024-01-01 00:00:00' WHERE id = ?").run(r1.body.id);
            db.prepare("UPDATE tasks SET deleted_at = '2024-08-01 00:00:00' WHERE id = ?").run(r2.body.id);

            const res = await request(app).get('/api/trash?deletedStartDate=2024-06-01&deletedEndDate=2024-12-31');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].prompt).toBe('新任务');
        });
    });

    describe('GET /api/trash/:id', () => {
        it('应返回指定的已删除任务', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '回收站详情' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            const res = await request(app).get(`/api/trash/${createRes.body.id}`);
            expect(res.status).toBe(200);
            expect(res.body.prompt).toBe('回收站详情');
        });

        it('未删除的任务应返回404', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '正常任务' });

            const res = await request(app).get(`/api/trash/${createRes.body.id}`);
            expect(res.status).toBe(404);
        });

        it('不存在的任务应返回404', async () => {
            const res = await request(app).get('/api/trash/99999');
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /api/trash/:id', () => {
        it('应彻底删除超过30天的任务', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '彻底删除' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            // 修改 deleted_at 为31天前
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(createRes.body.id);

            const res = await request(app).delete(`/api/trash/${createRes.body.id}`);
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);

            // 回收站中不再可见
            const trashRes = await request(app).get('/api/trash');
            expect(trashRes.body).toHaveLength(0);
        });

        it('未达30天的任务应返回400', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '未达30天' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            const res = await request(app).delete(`/api/trash/${createRes.body.id}`);
            expect(res.status).toBe(400);
        });

        it('未删除的任务应返回404', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '正常任务' });

            const res = await request(app).delete(`/api/trash/${createRes.body.id}`);
            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/trash/:id/restore', () => {
        it('应恢复已删除的任务', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '要恢复的任务' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            const restoreRes = await request(app).post(`/api/trash/${createRes.body.id}/restore`);
            expect(restoreRes.status).toBe(200);
            expect(restoreRes.body.id).toBe(createRes.body.id);
            expect(restoreRes.body.deleted_at).toBeNull();

            // 回收站中不再可见
            const trashRes = await request(app).get('/api/trash');
            expect(trashRes.body).toHaveLength(0);

            // 在正常任务列表中可见
            const taskRes = await request(app).get(`/api/tasks/${createRes.body.id}`);
            expect(taskRes.status).toBe(200);
            expect(taskRes.body.prompt).toBe('要恢复的任务');
        });

        it('未删除的任务应返回404', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '正常任务' });

            const res = await request(app).post(`/api/trash/${createRes.body.id}/restore`);
            expect(res.status).toBe(404);
        });

        it('不存在的任务应返回404', async () => {
            const res = await request(app).post('/api/trash/99999/restore');
            expect(res.status).toBe(404);
        });

        it('已彻底删除的任务应返回404', async () => {
            const createRes = await request(app)
                .post('/api/tasks')
                .send({ provider: 'mock', prompt: '已彻底删除' });
            await request(app).delete(`/api/tasks/${createRes.body.id}`);

            // 彻底删除
            const db = getDb();
            db.prepare("UPDATE tasks SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(createRes.body.id);
            await request(app).delete(`/api/trash/${createRes.body.id}`);

            const res = await request(app).post(`/api/trash/${createRes.body.id}/restore`);
            expect(res.status).toBe(404);
        });
    });
});
