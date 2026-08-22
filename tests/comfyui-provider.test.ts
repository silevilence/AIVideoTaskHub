import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, initDb } from '../src/server/database.js';
import {
    createWorkflowTemplate,
    deleteWorkflowTemplate,
    setWorkflowTemplateEnabled,
    updateWorkflowTemplate,
} from '../src/server/comfy-workflow-model.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { ComfyUIProvider } from '../src/server/providers/comfyui-provider.js';
import { MockProvider } from '../src/server/providers/mock-provider.js';
import { createTaskRouter } from '../src/server/task-router.js';
import { getSetting } from '../src/server/task-model.js';
import { getAllTasks } from '../src/server/task-model.js';
import { registerAllTools } from '../src/server/mcp/mcp-tools.js';
import { comfyWorkflowTemplateDocument } from './fixtures/comfy-workflow.js';

function setupApp(registry: ProviderRegistry) {
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(registry));
    return app;
}

describe('ComfyUI Provider', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    it('将已启用模板实时映射为稳定模型 ID 和动态参数协议', () => {
        const provider = new ComfyUIProvider();
        const enabled = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('动态模板'),
        });
        createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('停用模板'),
            enabled: false,
        });

        expect(provider.models).toEqual([enabled.id]);
        expect(provider.getModelsInfo()).toEqual([{
            id: enabled.id,
            displayName: '动态模板',
            parameterSchema: {
                kind: 'comfyui-workflow',
                variables: [{ key: 'prompt', label: '提示词', type: 'string' }],
                primaryDescription: 'prompt',
                primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            },
        }]);

        const renamedDocument = comfyWorkflowTemplateDocument('已改名模板');
        updateWorkflowTemplate(enabled.id, { document: renamedDocument });
        expect(provider.getModelsInfo()[0].displayName).toBe('已改名模板');

        setWorkflowTemplateEnabled(enabled.id, false);
        expect(provider.getModelsInfo()).toEqual([]);
        setWorkflowTemplateEnabled(enabled.id, true);
        deleteWorkflowTemplate(enabled.id);
        expect(provider.models).toEqual([]);
    });

    it('规范化默认地址且临时地址不会覆盖当前设置', () => {
        const provider = new ComfyUIProvider();
        expect(provider.getSettingsSchema()).toEqual([expect.objectContaining({
            key: 'base_url',
            label: 'ComfyUI 地址',
            required: true,
            defaultValue: 'http://127.0.0.1:8188',
        })]);

        provider.applySettings({ base_url: ' http://192.168.1.20:8188/// ' });
        expect(provider.getCurrentSettings()).toEqual({
            base_url: 'http://192.168.1.20:8188',
        });
        expect(provider.resolveBaseUrl(' https://render.local:8188/ ')).toBe(
            'https://render.local:8188'
        );
        expect(provider.getCurrentSettings().base_url).toBe('http://192.168.1.20:8188');
        expect(() => provider.resolveBaseUrl('file:///tmp/comfy')).toThrow(
            'ComfyUI 地址仅支持 HTTP 或 HTTPS'
        );
    });

    it('Provider 设置接口持久化规范化地址并同步管理器设置', async () => {
        const registry = new ProviderRegistry();
        const provider = new ComfyUIProvider();
        registry.register(new MockProvider());
        registry.register(provider);
        const app = setupApp(registry);

        const saved = await request(app)
            .put('/api/settings/comfyui')
            .send({ base_url: ' http://127.0.0.1:8188/// ' });
        expect(saved.status).toBe(200);
        expect(getSetting('provider:comfyui:base_url')).toBe('http://127.0.0.1:8188');
        expect(provider.getCurrentSettings().base_url).toBe('http://127.0.0.1:8188');
        expect((await request(app).get('/api/comfyui/settings')).body).toEqual({
            baseUrl: 'http://127.0.0.1:8188',
        });

        const managerSaved = await request(app)
            .put('/api/comfyui/settings')
            .send({ baseUrl: 'https://comfy.lan/root/' });
        expect(managerSaved.body.baseUrl).toBe('https://comfy.lan/root');
        expect(provider.getCurrentSettings().base_url).toBe('https://comfy.lan/root');

        const rejected = await request(app)
            .put('/api/settings/comfyui')
            .send({ base_url: 'file:///tmp/comfy' });
        expect(rejected.status).toBe(400);
        expect(provider.getCurrentSettings().base_url).toBe('https://comfy.lan/root');
    });

    it('模型 API 同时保留其他 Provider 并公开模板参数协议', async () => {
        const registry = new ProviderRegistry();
        registry.register(new MockProvider());
        registry.register(new ComfyUIProvider());
        const created = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('API 动态模板'),
        });

        const response = await request(setupApp(registry)).get('/api/providers/models');
        expect(response.status).toBe(200);
        expect(response.body.mock[0].id).toBe('mock-model');
        expect(response.body.comfyui[0]).toMatchObject({
            id: created.id,
            displayName: 'API 动态模板',
            parameterSchema: {
                kind: 'comfyui-workflow',
                primaryDescription: 'prompt',
            },
        });
    });

    it('MCP 参数规范复用同一份模板变量协议', async () => {
        const registry = new ProviderRegistry();
        registry.register(new ComfyUIProvider());
        const created = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('MCP 动态模板'),
        });
        const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{
            content: Array<{ type: string; text: string }>;
        }>>();
        const server = {
            registerTool: vi.fn((name: string, _definition: unknown, handler: typeof handlers extends Map<string, infer T> ? T : never) => {
                handlers.set(name, handler);
            }),
        };
        registerAllTools(server as never, registry);

        const result = await handlers.get('get_param_spec')!({
            provider: 'comfyui',
            model: created.id,
        });
        const protocol = JSON.parse(result.content[0].text);
        expect(protocol.models[0].parameterSchema).toMatchObject({
            kind: 'comfyui-workflow',
            variables: [{ key: 'prompt', label: '提示词', type: 'string' }],
            primaryDescription: 'prompt',
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
        });
    });

    it('在创建任务前校验变量并生成类型安全的工作流快照', async () => {
        const record = createWorkflowTemplate({
            document: `---
schemaVersion: 1
name: 渲染模板
primaryDescription: prompt
primaryOutput:
  nodeId: "2"
  field: videos
  index: 0
variables:
  - key: prompt
    label: 提示词
    type: string
  - key: steps
    label: 步数
    type: integer
    default: 20
---
{
  "1": { "class_type": "TextNode", "inputs": { "text": "${'${prompt}'}", "steps": "${'${steps}'}" } },
  "2": { "class_type": "VideoNode", "inputs": { "source": ["1", 0] } }
}`,
        });
        const provider = new ComfyUIProvider();
        provider.applySettings({ base_url: 'http://127.0.0.1:8188' });

        const prepared = await provider.prepareTask!({
            prompt: 'ignored client summary',
            model: record.id,
            extra: {
                workflowInputs: { prompt: '雪山航拍', steps: 20 },
                comfyuiBaseUrl: 'http://192.168.1.20:8188/',
            },
        });

        expect(prepared.prompt).toBe('雪山航拍');
        expect(prepared.extra).toMatchObject({
            templateId: record.id,
            comfyuiBaseUrl: 'http://192.168.1.20:8188',
            workflowInputs: { prompt: '雪山航拍', steps: 20 },
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            workflow: {
                '1': { class_type: 'TextNode', inputs: { text: '雪山航拍', steps: 20 } },
            },
        });
        expect(provider.getCurrentSettings().base_url).toBe('http://127.0.0.1:8188');
    });

    it('任务接口在落库前拒绝缺失或越权的工作流变量', async () => {
        const registry = new ProviderRegistry();
        const provider = new ComfyUIProvider();
        provider.applySettings({ base_url: 'http://127.0.0.1:8188' });
        registry.register(provider);
        const record = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('任务校验模板'),
        });

        const response = await request(setupApp(registry))
            .post('/api/tasks')
            .send({
                provider: 'comfyui',
                prompt: '伪造摘要',
                model: record.id,
                extra: { workflowInputs: { injected: 'evil' } },
            });

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual(expect.arrayContaining([
            'prompt 不能为空',
            '存在未定义的变量值：injected',
        ]));
        expect(getAllTasks()).toEqual([]);
    });

    it('任务接口将准备后的摘要和工作流传给 Provider 并保存', async () => {
        const registry = new ProviderRegistry();
        const provider = new ComfyUIProvider();
        provider.applySettings({ base_url: 'http://127.0.0.1:8188' });
        vi.spyOn(provider, 'createTask').mockResolvedValue({ providerTaskId: 'prompt-42' });
        registry.register(provider);
        const record = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('可提交模板'),
        });

        const response = await request(setupApp(registry))
            .post('/api/tasks')
            .send({
                provider: 'comfyui',
                prompt: '客户端摘要',
                model: record.id,
                extra: { workflowInputs: { prompt: '服务端摘要' } },
            });

        expect(response.status).toBe(201);
        expect(response.body.prompt).toBe('服务端摘要');
        expect(provider.createTask).toHaveBeenCalledWith(expect.objectContaining({
            prompt: '服务端摘要',
            extra: expect.objectContaining({
                templateId: record.id,
                workflowInputs: { prompt: '服务端摘要' },
            }),
        }));
        expect(JSON.parse(response.body.extra_params).workflow).toBeDefined();
    });
});
