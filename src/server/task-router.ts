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
    getDeletedTasks,
    getDeletedTaskById,
    purgeTask,
    restoreTask,
} from './task-model.js';
import type { ModelInfo } from './provider.js';
import { logger } from './logger.js';
import {
    getTextSettings,
    updateTextSettings,
    getModelLanguageOverride,
    setModelLanguageOverride,
    removeModelLanguageOverride,
    validatePromptTemplate,
    renderPromptTemplate,
    getPromptTemplate,
    getPromptLanguage,
    PRESET_PROVIDERS,
    type TextProviderConfig,
    type TextSettings,
} from './text-settings.js';
import { callLLM, callLLMStream, fetchLLMModels } from './llm-client.js';
import { resolveCreateTaskImages } from './image-utils.js';

export function createTaskRouter(registry: ProviderRegistry): Router {
    const router = Router();
    const dataDir = process.env.DATA_DIR || 'data';

    // 视频提供商 API Key 解析辅助
    const ENV_KEY_MAPPING: Record<string, string> = {
        siliconflow: 'SILICONFLOW_API_KEY',
        volcengine: 'VOLCENGINE_API_KEY',
        aihubmix: 'AIHUBMIX_API_KEY',
    };

    function resolveVideoApiKey(videoProviderName: string): string {
        const videoKey = getSetting(`provider:${videoProviderName}:api_key`);
        const envKey = ENV_KEY_MAPPING[videoProviderName];
        return videoKey || (envKey ? (process.env[envKey] || '') : '');
    }

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

    // 环境变量到 Provider 设置的映射
    const ENV_MAPPING: Record<string, Record<string, string>> = {
        siliconflow: { api_key: 'SILICONFLOW_API_KEY' },
        volcengine: { api_key: 'VOLCENGINE_API_KEY' },
        aihubmix: { api_key: 'AIHUBMIX_API_KEY' },
    };

    // 获取所有 Provider 的设置 schema + 当前值 + 来源
    router.get('/settings', (_req, res) => {
        const result: Record<string, { 
            displayName: string; 
            schema: ReturnType<typeof registry.get extends (...a: unknown[]) => infer R ? R : never>; 
            values: Record<string, string>; 
            sources: Record<string, 'env' | 'saved' | 'none'>;
            supportsModelRefresh?: boolean; 
            modelsUpdatedAt?: string 
        }> = {};
        for (const name of registry.listNames()) {
            const provider = registry.get(name);
            if (provider) {
                const schema = provider.getSettingsSchema();
                if (schema.length > 0) {
                    // 计算每个设置项的来源
                    const sources: Record<string, 'env' | 'saved' | 'none'> = {};
                    const envMap = ENV_MAPPING[name] || {};
                    for (const s of schema) {
                        const envVarName = envMap[s.key];
                        if (envVarName && process.env[envVarName]) {
                            sources[s.key] = 'env';
                        } else if (getSetting(`provider:${name}:${s.key}`)) {
                            sources[s.key] = 'saved';
                        } else {
                            sources[s.key] = 'none';
                        }
                    }
                    
                    const entry: (typeof result)[string] = {
                        displayName: provider.displayName,
                        schema: schema as never,
                        values: provider.getCurrentSettings(),
                        sources,
                    };
                    if (typeof provider.refreshModels === 'function') {
                        entry.supportsModelRefresh = true;
                        const cacheData = provider.getCacheData?.();
                        if (cacheData?._models_updated_at) {
                            entry.modelsUpdatedAt = cacheData._models_updated_at;
                        }
                    }
                    result[name] = entry;
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

    // 获取已上传的图片列表
    router.get('/uploads', (req, res) => {
        const uploadDir = path.resolve(process.env.DATA_DIR || 'data', 'uploads');
        
        if (!fs.existsSync(uploadDir)) {
            res.json([]);
            return;
        }
        
        try {
            const files = fs.readdirSync(uploadDir)
                .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
                .map(filename => {
                    const filePath = path.join(uploadDir, filename);
                    const stat = fs.statSync(filePath);
                    return {
                        url: `/uploads/${filename}`,
                        filename,
                        size: stat.size,
                        createdAt: stat.birthtime.toISOString(),
                    };
                })
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // 按创建时间倒序
            
            res.json(files);
        } catch {
            res.json([]);
        }
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

            // 将本地 /uploads/ 路径转换为 base64，确保外部 API 可访问
            const { resolvedImageUrl, resolvedExtra } = resolveCreateTaskImages(imageUrl, extraParams);

            const result = await providerInstance.createTask({
                prompt,
                model,
                imageUrl: resolvedImageUrl,
                extra: resolvedExtra,
            });
            updateTaskStatus(task.id, 'pending', {
                providerTaskId: result.providerTaskId,
            });
            const updated = getTaskById(task.id)!;
            logger.taskCreated(task.id, provider, model || 'default');
            res.status(201).json(updated);
        } catch (err) {
            logger.error(`任务 ${task.id} 创建失败: ${(err as Error).message}`);
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

    // 删除任务（软删除）
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

    // ── 回收站相关接口 ──────────────────────────

    // 获取回收站任务列表
    router.get('/trash', (req, res) => {
        const { providers, statuses, prompt, deletedStartDate, deletedEndDate } = req.query;
        const hasFilter = providers || statuses || prompt || deletedStartDate || deletedEndDate;

        const filter = hasFilter ? {
            providers: typeof providers === 'string' ? providers.split(',').filter(Boolean) : undefined,
            statuses: typeof statuses === 'string' ? statuses.split(',').filter(Boolean) : undefined,
            prompt: typeof prompt === 'string' ? prompt : undefined,
            deletedStartDate: typeof deletedStartDate === 'string' ? deletedStartDate : undefined,
            deletedEndDate: typeof deletedEndDate === 'string' ? deletedEndDate : undefined,
        } : undefined;

        const tasks = getDeletedTasks(filter);
        const dataDir = process.env.DATA_DIR || 'data';

        const tasksWithSize = tasks.map((task) => {
            let fileSize = 0;
            // 计算本地视频文件大小
            if (task.result_url && task.result_url.startsWith('/videos/')) {
                try {
                    const filePath = path.resolve(dataDir, task.result_url.slice(1));
                    const stat = fs.statSync(filePath);
                    fileSize += stat.size;
                } catch { /* 文件不存在 */ }
            }
            // 计算本地上传图片大小
            if (task.image_url && task.image_url.startsWith('/uploads/')) {
                try {
                    const filePath = path.resolve(dataDir, task.image_url.slice(1));
                    const stat = fs.statSync(filePath);
                    fileSize += stat.size;
                } catch { /* 文件不存在 */ }
            }
            return { ...task, file_size: fileSize };
        });

        res.json(tasksWithSize);
    });

    // 获取回收站指定任务
    router.get('/trash/:id', (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: '无效的任务 ID' });
            return;
        }
        const task = getDeletedTaskById(id);
        if (!task) {
            res.status(404).json({ error: '任务不存在或不在回收站中' });
            return;
        }
        res.json(task);
    });

    // 彻底删除回收站任务
    router.delete('/trash/:id', (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: '无效的任务 ID' });
            return;
        }

        const result = purgeTask(id);
        if (!result.success) {
            // 区分"不存在"和"未满30天"
            const task = getDeletedTaskById(id);
            if (!task) {
                res.status(404).json({ error: result.error });
            } else {
                res.status(400).json({ error: result.error });
            }
            return;
        }

        // 删除本地文件
        const dataDir = process.env.DATA_DIR || 'data';
        if (result.filesToDelete) {
            for (const relPath of result.filesToDelete) {
                try {
                    const fullPath = path.resolve(dataDir, relPath.slice(1));
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                    }
                } catch { /* 文件删除失败不阻塞 */ }
            }
        }

        res.json({ ok: true });
    });

    // 恢复回收站任务
    router.post('/trash/:id/restore', (req, res) => {
        const id = Number(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: '无效的任务 ID' });
            return;
        }

        const success = restoreTask(id);
        if (!success) {
            res.status(404).json({ error: '任务不存在或不在回收站中' });
            return;
        }

        const restoredTask = getTaskById(id);
        res.json(restoredTask);
    });

    // ── 模型刷新接口 ──────────────────────────

    router.post('/providers/:provider/refresh-models', async (req, res) => {
        const providerName = req.params.provider;
        const provider = registry.get(providerName);
        if (!provider || typeof provider.refreshModels !== 'function') {
            res.status(404).json({ error: `Provider "${providerName}" 不存在或不支持模型刷新` });
            return;
        }
        try {
            const models: ModelInfo[] = await provider.refreshModels();
            const cacheData = provider.getCacheData?.();
            if (cacheData) {
                for (const [key, value] of Object.entries(cacheData)) {
                    setSetting(`provider:${providerName}:${key}`, value);
                }
            }
            res.json({ models, updatedAt: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: `刷新模型失败: ${(err as Error).message}` });
        }
    });

    // ── 文本设置接口 ──────────────────────────

    // 获取文本设置（含预置提供商列表）
    router.get('/text-settings', (_req, res) => {
        const settings = getTextSettings();
        res.json({ ...settings, presetProviders: PRESET_PROVIDERS });
    });

    // 更新文本设置
    router.put('/text-settings', (req, res) => {
        const body = req.body as Partial<TextSettings>;
        if (!body || typeof body !== 'object') {
            res.status(400).json({ error: '无效的设置数据' });
            return;
        }

        // 校验 Prompt 模板
        if (body.promptTemplate !== undefined) {
            const validation = validatePromptTemplate(body.promptTemplate);
            if (!validation.valid) {
                res.status(400).json({ error: validation.warnings[0] });
                return;
            }
        }

        updateTextSettings(body);
        res.json({ ok: true, warnings: [] });
    });

    // 获取视频模型的语言覆盖
    router.get('/text-settings/model-languages', (req, res) => {
        const { videoProvider, modelId } = req.query;
        if (typeof videoProvider === 'string' && typeof modelId === 'string') {
            const lang = getModelLanguageOverride(videoProvider, modelId);
            res.json({ language: lang });
        } else {
            res.status(400).json({ error: '需要 videoProvider 和 modelId 参数' });
        }
    });

    // 设置视频模型的语言覆盖
    router.put('/text-settings/model-languages', (req, res) => {
        const { videoProvider, modelId, language } = req.body;
        if (typeof videoProvider !== 'string' || typeof modelId !== 'string') {
            res.status(400).json({ error: '需要 videoProvider 和 modelId' });
            return;
        }
        if (language) {
            setModelLanguageOverride(videoProvider, modelId, language);
        } else {
            removeModelLanguageOverride(videoProvider, modelId);
        }
        res.json({ ok: true });
    });

    // 获取文本提供商的远程模型列表
    router.post('/text-settings/fetch-models', async (req, res) => {
        const { providerName, baseUrl: directBaseUrl, apiKey: directApiKey, appCode: directAppCode, apiKeySource } = req.body;

        let baseUrl: string;
        let apiKey: string;
        let appCode: string | undefined;

        // 优先从已保存配置中查找
        const textSettings = getTextSettings();
        const savedProvider = providerName ? textSettings.providers.find(p => p.name === providerName) : null;

        if (savedProvider) {
            baseUrl = savedProvider.baseUrl;
            appCode = savedProvider.appCode;

            if (savedProvider.apiKeySource.startsWith('video:')) {
                const videoProviderName = savedProvider.apiKeySource.slice(6);
                apiKey = resolveVideoApiKey(videoProviderName);
            } else {
                apiKey = savedProvider.apiKey;
            }
        } else if (directBaseUrl) {
            // 未保存（用户正在编辑），使用前端直接传来的配置
            baseUrl = directBaseUrl;
            appCode = directAppCode;

            if (apiKeySource && apiKeySource.startsWith('video:')) {
                const videoProviderName = apiKeySource.slice(6);
                apiKey = resolveVideoApiKey(videoProviderName);
            } else {
                apiKey = directApiKey || '';
            }
        } else {
            res.status(400).json({ error: '需要提供 baseUrl 或已保存的 providerName' });
            return;
        }

        if (!baseUrl || !apiKey) {
            res.status(400).json({ error: '需要 baseUrl 和 apiKey（或先配置并保存文本提供商）' });
            return;
        }
        try {
            logger.info(`fetch-models: baseUrl=${baseUrl}, provider=${providerName || 'direct'}`);
            const models = await fetchLLMModels(baseUrl, apiKey, appCode);
            res.json(models);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    });

    // ── Prompt 优化接口 ──────────────────────────

    // 活跃的优化请求 AbortController（简易单用户设计）
    const activeAbortControllers = new Map<string, AbortController>();

    // 非流式 Prompt 优化
    router.post('/prompt/optimize', async (req, res) => {
        const { input, providerName, modelId, streaming, language } = req.body as {
            input: string;
            providerName: string;
            modelId: string;
            streaming?: boolean;
            language?: string;
        };

        if (!input || typeof input !== 'string') {
            res.status(400).json({ error: '缺少 input' });
            return;
        }
        if (!providerName || !modelId) {
            res.status(400).json({ error: '缺少 providerName 或 modelId' });
            return;
        }

        // 查找文本提供商配置
        const settings = getTextSettings();
        const provider = settings.providers.find(p => p.name === providerName);
        if (!provider) {
            res.status(400).json({ error: `文本提供商 "${providerName}" 未配置` });
            return;
        }
        // 解析实际使用的 API Key（可能复用视频提供商的）
        let apiKey = provider.apiKey || '';
        if (provider.apiKeySource.startsWith('video:')) {
            const videoProviderName = provider.apiKeySource.slice(6);
            apiKey = resolveVideoApiKey(videoProviderName);
            if (!apiKey) {
                res.status(400).json({ error: `视频提供商 "${videoProviderName}" 的 API Key 未配置` });
                return;
            }
        }

        if (!apiKey) {
            res.status(400).json({ error: `文本提供商 "${providerName}" 未配置 API Key` });
            return;
        }

        // 渲染 Prompt 模板
        const template = getPromptTemplate();
        const effectiveLanguage = language || settings.promptLanguage || '中文';
        const systemPrompt = renderPromptTemplate(template, input, effectiveLanguage);

        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const abortController = new AbortController();
        activeAbortControllers.set(requestId, abortController);

        try {
            if (streaming) {
                // 流式响应 (SSE)
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Request-Id', requestId);

                const stream = await callLLMStream({
                    baseUrl: provider.baseUrl,
                    apiKey,
                    model: modelId,
                    messages: [{ role: 'user', content: systemPrompt }],
                    stream: true,
                    appCode: provider.appCode,
                    signal: abortController.signal,
                });

                const reader = stream.getReader();
                const decoder = new TextDecoder();

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        // 直接转发 SSE chunks
                        res.write(chunk);
                    }
                } catch (err) {
                    if ((err as Error).name !== 'AbortError') {
                        res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
                    }
                } finally {
                    res.write('data: [DONE]\n\n');
                    res.end();
                    activeAbortControllers.delete(requestId);
                }
            } else {
                // 非流式响应
                res.setHeader('X-Request-Id', requestId);
                const result = await callLLM({
                    baseUrl: provider.baseUrl,
                    apiKey,
                    model: modelId,
                    messages: [{ role: 'user', content: systemPrompt }],
                    appCode: provider.appCode,
                    signal: abortController.signal,
                });

                activeAbortControllers.delete(requestId);
                res.json({ content: result.content, finishReason: result.finishReason });
            }
        } catch (err) {
            activeAbortControllers.delete(requestId);
            if ((err as Error).name === 'AbortError') {
                res.status(499).json({ error: '请求已中断' });
            } else {
                logger.error(`Prompt 优化失败: ${(err as Error).message}`);
                res.status(500).json({ error: (err as Error).message });
            }
        }
    });

    // 中断 Prompt 优化请求
    router.post('/prompt/optimize/abort', (req, res) => {
        const { requestId } = req.body;
        if (requestId && activeAbortControllers.has(requestId)) {
            activeAbortControllers.get(requestId)!.abort();
            activeAbortControllers.delete(requestId);
            res.json({ ok: true });
        } else {
            // 中断所有活跃请求
            for (const [id, controller] of activeAbortControllers) {
                controller.abort();
                activeAbortControllers.delete(id);
            }
            res.json({ ok: true, abortedAll: true });
        }
    });

    return router;
}
