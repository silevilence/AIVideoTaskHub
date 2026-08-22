import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, initDb } from '../src/server/database.js';
import {
    createWorkflowTemplate,
    deleteWorkflowTemplate,
    setWorkflowTemplateEnabled,
} from '../src/server/comfy-workflow-model.js';
import { registerAllTools } from '../src/server/mcp/mcp-tools.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { ComfyUIProvider } from '../src/server/providers/comfyui-provider.js';
import { createTaskRouter } from '../src/server/task-router.js';
import { getAllTasks, getTaskById, insertTask, updateTaskStatus } from '../src/server/task-model.js';
import { comfyWorkflowTemplateDocument } from './fixtures/comfy-workflow.js';

const baseUrl = 'http://comfy.internal:8188';
const safeTarget = {
    origin: baseUrl,
    address: { address: '127.0.0.1', family: 4 },
};
const resolver = async () => [{ address: '127.0.0.1', family: 4 as const }];

function historicalSnapshot(templateId = 'deleted-template') {
    return {
        snapshotVersion: 1,
        templateId,
        templateName: '已删除电影模板',
        templateDocument: comfyWorkflowTemplateDocument('已删除电影模板'),
        comfyuiBaseUrl: baseUrl,
        comfyuiSafeTarget: safeTarget,
        workflowInputs: { prompt: '历史云海' },
        resolvedWorkflowInputs: { prompt: '历史云海' },
        imageResolutions: [{
            variableKey: 'image',
            source: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
            name: 'input.png',
            subfolder: 'tasks',
            type: 'input',
            fileIdentifier: 'tasks/input.png',
        }],
        workflow: {
            '1': { class_type: 'TextNode', inputs: { text: '历史云海' } },
            '2': { class_type: 'VideoNode', inputs: { source: ['1', 0] } },
        },
        primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
    };
}

function setup(provider: ComfyUIProvider) {
    const registry = new ProviderRegistry();
    registry.register(provider);
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(registry));
    return { app, registry };
}

describe('ComfyUI 历史任务兼容', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    it('任务与回收站详情公开可读的模板、变量、主输出、地址和图片快照', async () => {
        const { app } = setup(new ComfyUIProvider());
        const task = insertTask({
            provider: 'comfyui',
            prompt: '历史云海',
            model: 'deleted-template',
            extraParams: historicalSnapshot(),
        });

        const active = await request(app).get(`/api/tasks/${task.id}`);
        expect(active.body.comfyui_snapshot).toEqual({
            templateId: 'deleted-template',
            templateName: '已删除电影模板',
            baseUrl,
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            parameterSchema: {
                kind: 'comfyui-workflow',
                variables: [{ key: 'prompt', label: '提示词', type: 'string' }],
                primaryDescription: 'prompt',
                primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            },
            variables: [{ key: 'prompt', label: '提示词', type: 'string', value: '历史云海' }],
            images: [expect.objectContaining({
                variableKey: 'image',
                source: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
            })],
        });

        await request(app).delete(`/api/tasks/${task.id}`);
        const trash = await request(app).get(`/api/trash/${task.id}`);
        expect(trash.body.comfyui_snapshot).toEqual(active.body.comfyui_snapshot);
    });

    it('模板删除后仍按历史快照重新预检并重置为待提交，失败时保持原状态', async () => {
        let compatible = true;
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            if (!String(input).endsWith('/object_info')) throw new Error('不应在 retry API 直接排队');
            return new Response(JSON.stringify(compatible ? {
                TextNode: { input: { required: { text: ['STRING', {}] } } },
                VideoNode: { input: { required: { source: ['VIDEO', {}] } } },
            } : {}), { status: 200 });
        });
        const { app } = setup(new ComfyUIProvider({ fetcher, resolver }));
        const template = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('稍后删除'),
        });
        deleteWorkflowTemplate(template.id);
        const task = insertTask({
            provider: 'comfyui',
            prompt: '历史云海',
            model: template.id,
            extraParams: historicalSnapshot(template.id),
        });
        updateTaskStatus(task.id, 'failed', {
            providerTaskId: 'old-prompt-id',
            errorMessage: '旧错误',
            resultUrl: '/videos/old.mp4',
        });

        const retried = await request(app).post(`/api/tasks/${task.id}/retry`);
        expect(retried.status).toBe(200);
        expect(retried.body).toMatchObject({
            status: 'pending',
            provider_task_id: null,
            result_url: null,
            error_message: '',
        });
        expect(fetcher).toHaveBeenCalledWith(`${baseUrl}/object_info`, expect.any(Object));

        updateTaskStatus(task.id, 'failed', {
            providerTaskId: 'second-old-id',
            errorMessage: '第二次错误',
        });
        compatible = false;
        const blocked = await request(app).post(`/api/tasks/${task.id}/retry`);
        expect(blocked.status).toBe(400);
        expect(getTaskById(task.id)).toMatchObject({
            status: 'failed',
            provider_task_id: 'second-old-id',
            error_message: '第二次错误',
        });
    });

    it('模板变更或删除后可用历史快照创建等价新任务', async () => {
        const template = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('原始快照模板'),
        });
        const sourceSnapshot = historicalSnapshot(template.id);
        const sourceTask = insertTask({
            provider: 'comfyui',
            prompt: '历史来源任务',
            model: template.id,
            extraParams: sourceSnapshot,
        });
        deleteWorkflowTemplate(template.id);
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/object_info')) {
                return new Response(JSON.stringify({
                    TextNode: { input: { required: { text: ['STRING', {}] } } },
                    VideoNode: { input: { required: { source: ['VIDEO', {}] } } },
                }), { status: 200 });
            }
            if (url.endsWith('/prompt')) {
                return new Response(JSON.stringify({ prompt_id: 'historical-new-prompt' }), {
                    status: 200,
                });
            }
            throw new Error(`未模拟请求：${url}`);
        });
        const { app } = setup(new ComfyUIProvider({ fetcher, resolver }));
        await request(app).delete(`/api/tasks/${sourceTask.id}`);

        const response = await request(app).post('/api/tasks').send({
            provider: 'comfyui',
            prompt: '历史快照新任务',
            model: template.id,
            extra: {
                workflowInputs: { prompt: '等价重建的云海' },
                comfyuiBaseUrl: baseUrl,
                sourceTaskId: sourceTask.id,
            },
        });

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
            provider_task_id: 'historical-new-prompt',
            prompt: '等价重建的云海',
        });
        expect(JSON.parse(response.body.extra_params)).toMatchObject({
            templateId: template.id,
            templateName: '已删除电影模板',
            workflowInputs: { prompt: '等价重建的云海' },
        });
    });

    it('拒绝客户端伪造内联历史快照', async () => {
        const { app } = setup(new ComfyUIProvider());
        const response = await request(app).post('/api/tasks').send({
            provider: 'comfyui',
            prompt: '伪造快照',
            model: 'missing-template',
            extra: {
                workflowInputs: { prompt: '绕过模板管理' },
                comfyuiBaseUrl: baseUrl,
                sourceSnapshot: historicalSnapshot('missing-template'),
            },
        });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain('sourceTaskId');
        expect(getAllTasks()).toHaveLength(0);
    });

    it('异步重试预检期间任务状态变化时返回冲突且不覆盖新状态', async () => {
        const provider = new ComfyUIProvider();
        let releasePrepare!: (value: Parameters<typeof provider.prepareRetry>[0]) => void;
        const prepareStarted = new Promise<void>((resolve) => {
            vi.spyOn(provider, 'prepareRetry').mockImplementation((params) => {
                resolve();
                return new Promise((release) => {
                    releasePrepare = release;
                });
            });
        });
        const { app } = setup(provider);
        const task = insertTask({
            provider: 'comfyui',
            prompt: '并发重试',
            model: 'deleted-template',
            extraParams: historicalSnapshot(),
        });
        updateTaskStatus(task.id, 'failed', {
            providerTaskId: 'old-id',
            errorMessage: '旧失败',
        });

        const retryResponse = request(app)
            .post(`/api/tasks/${task.id}/retry`)
            .then((response) => response);
        await prepareStarted;
        updateTaskStatus(task.id, 'running', { providerTaskId: 'new-id' });
        releasePrepare({
            prompt: task.prompt,
            model: task.model ?? undefined,
            extra: historicalSnapshot(),
        });

        const response = await retryResponse;
        expect(response.status).toBe(409);
        expect(getTaskById(task.id)).toMatchObject({
            status: 'running',
            provider_task_id: 'new-id',
            error_message: '旧失败',
        });
    });

    it('MCP 使用与 Web 相同的 prepareTask 校验，并支持变量值和临时地址', async () => {
        const template = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('MCP 模板'),
        });
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/object_info')) {
                return new Response(JSON.stringify({
                    TextNode: { input: { required: { text: ['STRING', {}] } } },
                    VideoNode: { input: { required: { source: ['VIDEO', {}] } } },
                }), { status: 200 });
            }
            if (url.endsWith('/prompt')) {
                return new Response(JSON.stringify({ prompt_id: 'mcp-prompt' }), { status: 200 });
            }
            throw new Error(`未模拟请求：${url}`);
        });
        const provider = new ComfyUIProvider({ fetcher, resolver });
        const { registry } = setup(provider);
        const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
            isError?: boolean;
        }>>();
        registerAllTools({
            registerTool: vi.fn((name: string, _definition: unknown, handler: never) => {
                handlers.set(name, handler);
            }),
        } as never, registry);

        const invalid = await handlers.get('submit_task')!({
            provider: 'comfyui',
            model: template.id,
            params: { workflowInputs: {}, comfyuiBaseUrl: baseUrl },
        });
        expect(invalid.isError).toBe(true);
        expect(getAllTasks()).toEqual([]);

        const created = await handlers.get('submit_task')!({
            provider: 'comfyui',
            model: template.id,
            params: {
                workflowInputs: { prompt: 'MCP 云海' },
                comfyuiBaseUrl: baseUrl,
            },
        });
        expect(created.isError).not.toBe(true);
        expect(getAllTasks()[0]).toMatchObject({
            provider: 'comfyui',
            provider_task_id: 'mcp-prompt',
            prompt: 'MCP 云海',
        });
        expect(JSON.parse(getAllTasks()[0].extra_params!)).toMatchObject({
            templateName: 'MCP 模板',
            workflowInputs: { prompt: 'MCP 云海' },
            comfyuiBaseUrl: baseUrl,
        });
        const detail = await handlers.get('query_task_detail')!({ task_id: getAllTasks()[0].id });
        expect(detail.content[0].text).toContain('🧩 ComfyUI 模板: MCP 模板');
        expect(detail.content[0].text).toContain(`🌐 实际地址: ${baseUrl}`);
        expect(detail.content[0].text).toContain('"prompt":"MCP 云海"');

        setWorkflowTemplateEnabled(template.id, false);
        const models = await handlers.get('get_models')!({ provider: 'comfyui' });
        expect(JSON.parse(models.content[0].text).comfyui.models).toEqual([]);
    });
});
