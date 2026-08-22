import { Router, type Request, type Response } from 'express';
import {
    createWorkflowTemplate,
    deleteWorkflowTemplate,
    duplicateWorkflowTemplate,
    getAllWorkflowTemplates,
    getWorkflowTemplateById,
    searchWorkflowTemplates,
    setWorkflowTemplateEnabled,
    updateWorkflowTemplate,
} from './comfy-workflow-model.js';
import { parseWorkflowTemplateDocument } from './comfy-workflow-template.js';
import {
    checkComfyWorkflowCompatibility,
    normalizeComfyUiBaseUrl,
} from './comfyui-connection.js';
import { getSetting, setSetting } from './task-model.js';
import type { ProviderRegistry } from './provider-registry.js';

const COMFYUI_BASE_URL_SETTING = 'provider:comfyui:base_url';

function databaseErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        return '模板名称已存在';
    }
    return error instanceof Error ? error.message : String(error);
}

interface ValidatedTemplateRequest {
    document: string;
    enabled: boolean | undefined;
    confirmWarnings: boolean;
    warnings: string[];
}

function validateTemplateRequest(
    req: Request,
    res: Response,
    defaultEnabled?: boolean
): ValidatedTemplateRequest | undefined {
    const { document, enabled, confirmWarnings } = req.body as {
        document?: unknown;
        enabled?: unknown;
        confirmWarnings?: unknown;
    };
    if (typeof document !== 'string' || !document.trim()) {
        res.status(400).json({ error: '缺少工作流模板文档' });
        return undefined;
    }
    const validation = parseWorkflowTemplateDocument(document);
    if (validation.errors.length > 0 || !validation.template) {
        res.status(400).json({ error: '工作流模板校验失败', ...validation });
        return undefined;
    }
    if (validation.warnings.length > 0 && confirmWarnings !== true) {
        res.status(409).json({
            error: '工作流模板包含需要确认的警告',
            warnings: validation.warnings,
        });
        return undefined;
    }
    return {
        document,
        enabled: typeof enabled === 'boolean' ? enabled : defaultEnabled,
        confirmWarnings: confirmWarnings === true,
        warnings: validation.warnings,
    };
}

function createTemplate(req: Request, res: Response): void {
    const validated = validateTemplateRequest(req, res, true);
    if (!validated) return;
    try {
        const template = createWorkflowTemplate({
            document: validated.document,
            enabled: validated.enabled,
            confirmWarnings: validated.confirmWarnings,
        });
        res.status(201).json({ template, warnings: validated.warnings });
    } catch (error) {
        res.status(409).json({ error: databaseErrorMessage(error) });
    }
}

export function createComfyWorkflowRouter(): Router {
    const router = Router();

    router.get('/', (req, res) => {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        res.json(query ? searchWorkflowTemplates(query) : getAllWorkflowTemplates());
    });

    router.post('/', createTemplate);
    router.post('/import', createTemplate);

    router.get('/:id/export', (req, res) => {
        const template = getWorkflowTemplateById(req.params.id);
        if (!template) {
            res.status(404).json({ error: '工作流模板不存在' });
            return;
        }
        res.type('text/plain').send(template.document);
    });

    router.put('/:id/enabled', (req, res) => {
        if (typeof req.body?.enabled !== 'boolean') {
            res.status(400).json({ error: 'enabled 必须是布尔值' });
            return;
        }
        const template = setWorkflowTemplateEnabled(req.params.id, req.body.enabled);
        if (!template) {
            res.status(404).json({ error: '工作流模板不存在' });
            return;
        }
        res.json(template);
    });

    router.post('/:id/duplicate', (req, res) => {
        const name = req.body?.name;
        if (typeof name !== 'string' || !name.trim()) {
            res.status(400).json({ error: '副本名称不能为空' });
            return;
        }
        const source = getWorkflowTemplateById(req.params.id);
        if (!source) {
            res.status(404).json({ error: '工作流模板不存在' });
            return;
        }
        const validation = parseWorkflowTemplateDocument(source.document);
        if (validation.warnings.length > 0 && req.body?.confirmWarnings !== true) {
            res.status(409).json({
                error: '工作流模板包含需要确认的警告',
                warnings: validation.warnings,
            });
            return;
        }
        try {
            const template = duplicateWorkflowTemplate(
                req.params.id,
                name,
                req.body?.confirmWarnings === true
            );
            res.status(201).json({ template, warnings: validation.warnings });
        } catch (error) {
            res.status(409).json({ error: databaseErrorMessage(error) });
        }
    });

    router.put('/:id', (req, res) => {
        const validated = validateTemplateRequest(req, res);
        if (!validated) return;
        try {
            const template = updateWorkflowTemplate(req.params.id, {
                document: validated.document,
                enabled: validated.enabled,
                confirmWarnings: validated.confirmWarnings,
            });
            if (!template) {
                res.status(404).json({ error: '工作流模板不存在' });
                return;
            }
            res.json({ template, warnings: validated.warnings });
        } catch (error) {
            res.status(409).json({ error: databaseErrorMessage(error) });
        }
    });

    router.delete('/:id', (req, res) => {
        if (!deleteWorkflowTemplate(req.params.id)) {
            res.status(404).json({ error: '工作流模板不存在' });
            return;
        }
        res.json({ ok: true });
    });

    router.get('/:id', (req, res) => {
        const template = getWorkflowTemplateById(req.params.id);
        if (!template) {
            res.status(404).json({ error: '工作流模板不存在' });
            return;
        }
        res.json(template);
    });

    return router;
}

function resolveCompatibilityDocument(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const request = body as { id?: unknown; document?: unknown };
    if (typeof request.document === 'string') return request.document;
    if (typeof request.id !== 'string') return undefined;
    return getWorkflowTemplateById(request.id)?.document;
}

/** Routes shared by the workflow manager and the future ComfyUI provider. */
export function createComfyUiRouter(registry?: ProviderRegistry): Router {
    const router = Router();

    router.get('/settings', (_req, res) => {
        res.json({ baseUrl: getSetting(COMFYUI_BASE_URL_SETTING) ?? '' });
    });

    router.put('/settings', (req, res) => {
        if (typeof req.body?.baseUrl !== 'string') {
            res.status(400).json({ error: '缺少 ComfyUI 地址' });
            return;
        }
        try {
            const baseUrl = normalizeComfyUiBaseUrl(req.body.baseUrl);
            setSetting(COMFYUI_BASE_URL_SETTING, baseUrl);
            registry?.get('comfyui')?.applySettings({ base_url: baseUrl });
            res.json({ baseUrl });
        } catch (error) {
            res.status(400).json({ error: databaseErrorMessage(error) });
        }
    });

    router.post('/connection/test', async (req, res) => {
        const baseUrl = typeof req.body?.baseUrl === 'string'
            ? req.body.baseUrl
            : getSetting(COMFYUI_BASE_URL_SETTING);
        if (!baseUrl) {
            res.status(400).json({ error: '请先设置默认 ComfyUI 地址' });
            return;
        }
        let normalizedBaseUrl: string;
        try {
            normalizedBaseUrl = normalizeComfyUiBaseUrl(baseUrl);
        } catch (error) {
            res.status(400).json({ error: databaseErrorMessage(error) });
            return;
        }
        try {
            const result = await checkComfyWorkflowCompatibility(normalizedBaseUrl, {});
            res.json(result);
        } catch (error) {
            res.status(502).json({ error: databaseErrorMessage(error) });
        }
    });

    router.post('/workflows/check', async (req, res) => {
        const document = resolveCompatibilityDocument(req.body);
        if (!document) {
            res.status(404).json({ error: '工作流模板不存在或缺少模板文档' });
            return;
        }
        const validation = parseWorkflowTemplateDocument(document);
        if (!validation.template || validation.errors.length > 0) {
            res.status(400).json({ error: '工作流模板校验失败', ...validation });
            return;
        }
        const baseUrl = getSetting(COMFYUI_BASE_URL_SETTING);
        if (!baseUrl) {
            res.status(400).json({ error: '请先设置默认 ComfyUI 地址' });
            return;
        }
        try {
            res.json(await checkComfyWorkflowCompatibility(baseUrl, validation.template.workflow));
        } catch (error) {
            res.status(502).json({ error: databaseErrorMessage(error) });
        }
    });

    return router;
}
