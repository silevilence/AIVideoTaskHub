import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ProviderRegistry } from './provider-registry.js';
import {
    insertTask,
    getTaskById,
    getAllTasks,
    deleteTask,
    updateTaskStatus,
    getSetting,
    setSetting,
    filterTasks,
} from './task-model.js';

export function createTaskRouter(registry: ProviderRegistry): Router {
    const router = Router();

    // 获取已注册的 provider 列表
    router.get('/providers', (_req, res) => {
        const list = registry.listNames().map((name) => {
            const provider = registry.get(name);
            return { name, displayName: provider?.displayName ?? name };
        });
        res.json(list);
    });

    // 获取每个 provider 的模型列表（含详细信息）
    router.get('/providers/models', (_req, res) => {
        const result: Record<string, ReturnType<NonNullable<ReturnType<typeof registry.get>>['getModelsInfo']>> = {};
        for (const name of registry.listNames()) {
            const provider = registry.get(name);
            if (provider) {
                result[name] = provider.getModelsInfo();
            }
        }
        res.json(result);
    });

    // 获取所有 Provider 的设置 schema + 当前值
    router.get('/settings', (_req, res) => {
        const result: Record<string, { displayName: string; schema: ReturnType<typeof registry.get extends (...a: unknown[]) => infer R ? R : never>; values: Record<string, string> }> = {};
        for (const name of registry.listNames()) {
            const provider = registry.get(name);
            if (provider) {
                const schema = provider.getSettingsSchema();
                if (schema.length > 0) {
                    result[name] = {
                        displayName: provider.displayName,
                        schema: schema as never,
                        values: provider.getCurrentSettings(),
                    };
                }
            }
        }
        res.json(result);
    });

    // 更新指定 Provider 的设置
    router.put('/settings/:provider', (req, res) => {
        const providerName = req.params.provider;
        const provider = registry.get(providerName);
        if (!provider) {
            res.status(404).json({ error: `Provider "${providerName}" 不存在` });
            return;
        }
        const settings = req.body as Record<string, string>;
        if (!settings || typeof settings !== 'object') {
            res.status(400).json({ error: '无效的设置数据' });
            return;
        }
        // 持久化到数据库
        for (const [key, value] of Object.entries(settings)) {
            if (typeof value === 'string' && value.trim()) {
                setSetting(`provider:${providerName}:${key}`, value.trim());
            }
        }
        // 应用到 Provider 实例
        provider.applySettings(settings);
        res.json({ ok: true });
    });

    // 图片上传
    router.post('/upload', (req, res) => {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
            res.status(400).json({ error: '仅支持上传图片文件' });
            return;
        }

        const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
        const allowedExts = ['png', 'jpeg', 'jpg', 'gif', 'webp'];
        if (!allowedExts.includes(ext)) {
            res.status(400).json({ error: '不支持的图片格式' });
            return;
        }

        const filename = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
        const uploadDir = path.resolve(process.env.DATA_DIR || 'data', 'uploads');
        fs.mkdirSync(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, filename);

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (buffer.length === 0) {
                res.status(400).json({ error: '上传内容为空' });
                return;
            }
            if (buffer.length > 10 * 1024 * 1024) {
                res.status(400).json({ error: '图片大小不能超过 10MB' });
                return;
            }
            // 保存文件用于本地预览
            fs.writeFileSync(filePath, buffer);
            // 同时返回 base64 用于发送给外部 API
            const base64 = `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`;
            res.json({ url: `/uploads/${filename}`, base64 });
        });
        req.on('error', () => {
            res.status(500).json({ error: '上传失败' });
        });
    });

    // 创建任务
    router.post('/tasks', async (req, res) => {
        const { provider, prompt, model, imageUrl, extra } = req.body;

        if (!provider || typeof provider !== 'string') {
            res.status(400).json({ error: '缺少必填参数 provider' });
            return;
        }
        if (!prompt || typeof prompt !== 'string') {
            res.status(400).json({ error: '缺少必填参数 prompt' });
            return;
        }
        if (!registry.has(provider)) {
            res.status(400).json({ error: `Provider "${provider}" 未注册` });
            return;
        }

        const extraParams = (extra && typeof extra === 'object') ? extra as Record<string, unknown> : undefined;
        const task = insertTask({ provider, prompt, model, imageUrl, extraParams });

        try {
            const providerInstance = registry.get(provider)!;
            const result = await providerInstance.createTask({
                prompt,
                model,
                imageUrl,
                extra: extraParams,
            });
            updateTaskStatus(task.id, 'pending', {
                providerTaskId: result.providerTaskId,
            });
            const updated = getTaskById(task.id)!;
            res.status(201).json(updated);
        } catch (err) {
            updateTaskStatus(task.id, 'failed', {
                errorMessage: (err as Error).message,
            });
            res.status(500).json({
                error: `创建任务失败: ${(err as Error).message}`,
            });
        }
    });

    // 获取所有任务
    router.get('/tasks', (req, res) => {
        const { providers, statuses, prompt, startDate, endDate } = req.query;
        const hasFilter = providers || statuses || prompt || startDate || endDate;

        if (hasFilter) {
            const filter = {
                providers: typeof providers === 'string' ? providers.split(',').filter(Boolean) : undefined,
                statuses: typeof statuses === 'string' ? statuses.split(',').filter(Boolean) : undefined,
                prompt: typeof prompt === 'string' ? prompt : undefined,
                startDate: typeof startDate === 'string' ? startDate : undefined,
                endDate: typeof endDate === 'string' ? endDate : undefined,
            };
            res.json(filterTasks(filter));
        } else {
            res.json(getAllTasks());
        }
    });

    // 获取任务详情
    router.get('/tasks/:id', (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: '无效的任务 ID' });
            return;
        }
        const task = getTaskById(id);
        if (!task) {
            res.status(404).json({ error: '任务不存在' });
            return;
        }
        res.json(task);
    });

    // 重试任务
    router.post('/tasks/:id/retry', (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: '无效的任务 ID' });
            return;
        }
        const task = getTaskById(id);
        if (!task) {
            res.status(404).json({ error: '任务不存在' });
            return;
        }
        if (task.status !== 'failed') {
            res.status(400).json({ error: '只有 failed 状态的任务可以重试' });
            return;
        }
        updateTaskStatus(id, 'pending', { errorMessage: '' });
        const updated = getTaskById(id)!;
        res.json(updated);
    });

    // 删除任务
    router.delete('/tasks/:id', (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: '无效的任务 ID' });
            return;
        }
        const deleted = deleteTask(id);
        if (!deleted) {
            res.status(404).json({ error: '任务不存在' });
            return;
        }
        res.status(204).send();
    });

    return router;
}
