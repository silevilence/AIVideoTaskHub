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

const compatibleTextVideoFetcher = vi.fn(async () => new Response(JSON.stringify({
    TextNode: {
        input: {
            required: { text: ['STRING', {}] },
            optional: { steps: ['INT', {}] },
        },
    },
    VideoNode: { input: { required: { source: ['VIDEO', {}] } } },
}), { status: 200 }));

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
        const provider = new ComfyUIProvider({ fetcher: compatibleTextVideoFetcher });
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
        const provider = new ComfyUIProvider({ fetcher: compatibleTextVideoFetcher });
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
        const savedSnapshot = JSON.parse(response.body.extra_params);
        expect(savedSnapshot).toMatchObject({
            snapshotVersion: 1,
            templateId: record.id,
            templateName: '可提交模板',
            templateDocument: record.document,
            workflowInputs: { prompt: '服务端摘要' },
            resolvedWorkflowInputs: { prompt: '服务端摘要' },
            imageResolutions: [],
            workflow: expect.any(Object),
        });

        updateWorkflowTemplate(record.id, {
            document: comfyWorkflowTemplateDocument('任务创建后改名'),
        });
        deleteWorkflowTemplate(record.id);
        expect(JSON.parse(getAllTasks()[0].extra_params!)).toEqual(savedSnapshot);
    });

    it('按本次实际地址强制预检、上传图片并保存完整快照', async () => {
        const calls: string[] = [];
        const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
        const fetcher = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            calls.push(url);
            if (url.endsWith('/object_info')) {
                return new Response(JSON.stringify({
                    LoadImage: {
                        input: {
                            required: { image: ['IMAGE', {}] },
                            optional: { caption: ['STRING', {}] },
                        },
                    },
                    SaveVideo: { input: { required: { source: ['VIDEO', {}] } } },
                }), { status: 200 });
            }
            if (url.endsWith('/upload/image')) {
                return new Response(JSON.stringify({
                    name: 'resolved.png',
                    subfolder: 'tasks',
                    type: 'input',
                }), { status: 200 });
            }
            throw new Error(`unexpected request: ${url}`);
        });
        const provider = new ComfyUIProvider({ fetcher, resolver });
        const record = createWorkflowTemplate({
            document: `---
schemaVersion: 1
name: 图片快照
primaryDescription: prompt
primaryOutput:
  nodeId: "2"
  field: videos
  index: 0
variables:
  - key: prompt
    label: 提示词
    type: string
  - key: image
    label: 图片
    type: image
---
{
  "1": { "class_type": "LoadImage", "inputs": { "image": "${'${image}'}", "caption": "${'${prompt}'}" } },
  "2": { "class_type": "SaveVideo", "inputs": { "source": ["1", 0] } }
}`,
        });

        const prepared = await provider.prepareTask!({
            prompt: '客户端摘要',
            model: record.id,
            extra: {
                comfyuiBaseUrl: 'http://comfy.internal:8188',
                workflowInputs: {
                    prompt: '让云层流动',
                    image: 'data:image/png;base64,aGVsbG8=',
                },
            },
        });

        expect(calls).toEqual([
            'http://comfy.internal:8188/object_info',
            'http://comfy.internal:8188/upload/image',
        ]);
        expect(resolver).toHaveBeenCalledOnce();
        expect(prepared.extra).toMatchObject({
            snapshotVersion: 1,
            templateId: record.id,
            templateName: '图片快照',
            templateDocument: record.document,
            comfyuiBaseUrl: 'http://comfy.internal:8188',
            workflowInputs: {
                prompt: '让云层流动',
                image: 'data:image/png;base64,aGVsbG8=',
            },
            resolvedWorkflowInputs: {
                prompt: '让云层流动',
                image: 'tasks/resolved.png',
            },
            imageResolutions: [{
                variableKey: 'image',
                source: 'data:image/png;base64,aGVsbG8=',
                name: 'resolved.png',
                subfolder: 'tasks',
                type: 'input',
                fileIdentifier: 'tasks/resolved.png',
            }],
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            workflow: {
                '1': { class_type: 'LoadImage', inputs: { image: 'tasks/resolved.png' } },
            },
        });

        updateWorkflowTemplate(record.id, {
            document: comfyWorkflowTemplateDocument('后来改名'),
        });
        deleteWorkflowTemplate(record.id);
        expect(prepared.extra).toMatchObject({
            templateName: '图片快照',
            templateDocument: expect.stringContaining('name: 图片快照'),
            workflowInputs: { image: 'data:image/png;base64,aGVsbG8=' },
            workflow: { '1': { inputs: { image: 'tasks/resolved.png' } } },
        });
    });

    it('预检返回完整问题并在本地落库和远端排队前阻断', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({
            KnownNode: {
                input: {
                    required: { required_input: ['STRING', {}] },
                    optional: { count: ['INT', { min: 1, max: 10 }] },
                },
            },
        }), { status: 200 }));
        const provider = new ComfyUIProvider({ fetcher });
        vi.spyOn(provider, 'createTask');
        const registry = new ProviderRegistry();
        registry.register(provider);
        const record = createWorkflowTemplate({
            document: `---
schemaVersion: 1
name: 不兼容模板
primaryOutput:
  nodeId: "2"
  field: videos
  index: 0
variables: []
---
{
  "1": { "class_type": "KnownNode", "inputs": { "unknown_input": true, "count": 99 } },
  "2": { "class_type": "MissingNode", "inputs": {} },
  "3": { "class_type": "__proto__", "inputs": {} }
}`,
        });

        const response = await request(setupApp(registry))
            .post('/api/tasks')
            .send({
                provider: 'comfyui',
                prompt: '预检失败',
                model: record.id,
                extra: {
                    comfyuiBaseUrl: 'http://192.168.1.31:8188',
                    workflowInputs: {},
                },
            });

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual([
            '缺少节点类型：MissingNode',
            '缺少节点类型：__proto__',
            '节点 1（KnownNode）缺少必填输入：required_input',
            '节点 1（KnownNode）包含不可识别输入：unknown_input',
            '节点 1（KnownNode）输入 count 不兼容：不能大于 10',
        ]);
        expect(getAllTasks()).toEqual([]);
        expect(provider.createTask).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledWith(
            'http://192.168.1.31:8188/object_info',
            expect.any(Object)
        );
    });

    it('实际地址不可达时返回诊断且不创建本地任务', async () => {
        const provider = new ComfyUIProvider({
            fetcher: vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }),
        });
        const registry = new ProviderRegistry();
        registry.register(provider);
        const record = createWorkflowTemplate({
            document: comfyWorkflowTemplateDocument('不可达实例模板'),
        });

        const response = await request(setupApp(registry))
            .post('/api/tasks')
            .send({
                provider: 'comfyui',
                prompt: '连接失败',
                model: record.id,
                extra: {
                    comfyuiBaseUrl: 'http://192.168.1.99:8188',
                    workflowInputs: { prompt: '连接失败' },
                },
            });

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual([
            '无法连接 ComfyUI：connect ECONNREFUSED',
        ]);
        expect(getAllTasks()).toEqual([]);
    });
});
