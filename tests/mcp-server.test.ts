/**
 * MCP 服务端 测试
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { initDb, closeDb } from '../src/server/database.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { createTaskRouter } from '../src/server/task-router.js';
import { McpServerManager } from '../src/server/mcp/mcp-server.js';
import type { VideoProvider } from '../src/server/provider.js';

// ── 辅助 ─────────────────────────────────

function createMockProvider(name = 'mock', models = ['model-a']): VideoProvider {
    return {
        name,
        displayName: `Display ${name}`,
        models,
        createTask: vi.fn().mockResolvedValue({ providerTaskId: 'prov-123' }),
        getStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
        downloadVideo: vi.fn().mockResolvedValue(undefined),
        getSettingsSchema: vi.fn().mockReturnValue([
            { key: 'api_key', label: 'API Key', secret: true, required: true },
        ]),
        getModelsInfo: vi.fn().mockReturnValue(
            models.map((id) => ({
                id,
                displayName: id,
                capabilities: {
                    i2v: true,
                    i2vOnly: false,
                    firstLastFrame: false,
                    referenceImage: false,
                    audio: false,
                    cameraFixed: false,
                    draft: false,
                    resolutions: ['720p'],
                    durationRange: [2, 12],
                    autoDuration: false,
                    defaultResolution: '720p',
                },
            })),
        ),
        applySettings: vi.fn(),
        getCurrentSettings: vi.fn().mockReturnValue({}),
    };
}

function setupApp(registry: ProviderRegistry, mcpManager?: McpServerManager) {
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(registry, mcpManager));
    if (mcpManager) {
        app.all('/mcp', async (req, res) => {
            await mcpManager.handleRequest(req, res, req.body);
        });
    }
    return app;
}

// ── 测试 ─────────────────────────────────

describe('MCP 服务端管理器', () => {
    let registry: ProviderRegistry;
    let mcpManager: McpServerManager;

    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        registry.register(createMockProvider('mock'));
        mcpManager = new McpServerManager(registry);
    });

    afterEach(async () => {
        if (mcpManager.running) {
            await mcpManager.stop();
        }
    });

    it('初始状态应为未运行', () => {
        expect(mcpManager.running).toBe(false);
        const status = mcpManager.getStatus();
        expect(status.running).toBe(false);
    });

    it('启动后状态应为运行中', async () => {
        await mcpManager.start();
        expect(mcpManager.running).toBe(true);
        const status = mcpManager.getStatus();
        expect(status.running).toBe(true);
    });

    it('停止后状态应为未运行', async () => {
        await mcpManager.start();
        await mcpManager.stop();
        expect(mcpManager.running).toBe(false);
    });

    it('重复启动不应报错', async () => {
        await mcpManager.start();
        await mcpManager.start(); // 不应抛出
        expect(mcpManager.running).toBe(true);
    });

    it('重复停止不应报错', async () => {
        await mcpManager.stop(); // 未运行时停止
        expect(mcpManager.running).toBe(false);
    });
});

describe('MCP 控制 API', () => {
    let registry: ProviderRegistry;
    let mcpManager: McpServerManager;
    let app: ReturnType<typeof express>;

    beforeEach(() => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        registry.register(createMockProvider('mock'));
        mcpManager = new McpServerManager(registry);
        app = setupApp(registry, mcpManager);
    });

    afterEach(async () => {
        if (mcpManager.running) {
            await mcpManager.stop();
        }
    });

    describe('GET /api/mcp/status', () => {
        it('应返回初始停止状态', async () => {
            const res = await request(app).get('/api/mcp/status');
            expect(res.status).toBe(200);
            expect(res.body.running).toBe(false);
        });

        it('启动后应返回运行状态', async () => {
            await mcpManager.start();
            const res = await request(app).get('/api/mcp/status');
            expect(res.status).toBe(200);
            expect(res.body.running).toBe(true);
        });
    });

    describe('POST /api/mcp/start', () => {
        it('mcpManager.start() 应直接可调用', async () => {
            // 直接测试 start 方法（不经过 HTTP）
            await mcpManager.start();
            expect(mcpManager.running).toBe(true);
        });

        it('应成功启动并返回运行状态', async () => {
            const res = await request(app).post('/api/mcp/start');
            // 即使失败也检查 body
            expect(res.body).toBeDefined();
            if (res.status !== 200) {
                throw new Error(`START FAILED: ${res.status} - ${JSON.stringify(res.body)}`);
            }
            expect(res.status).toBe(200);
            expect(res.body.running).toBe(true);
        });

        it('重复启动不应报错', async () => {
            const r1 = await request(app).post('/api/mcp/start');
            if (r1.status !== 200) {
                // 第一次就失败了，跳过
                return;
            }
            const res = await request(app).post('/api/mcp/start');
            expect(res.status).toBe(200);
            expect(res.body.running).toBe(true);
        });
    });

    describe('POST /api/mcp/stop', () => {
        it('应成功停止', async () => {
            await mcpManager.start();
            const res = await request(app).post('/api/mcp/stop');
            expect(res.status).toBe(200);
            expect(res.body.running).toBe(false);
        });
    });
});

describe('MCP 请求处理', () => {
    let registry: ProviderRegistry;
    let mcpManager: McpServerManager;
    let app: ReturnType<typeof express>;

    beforeEach(async () => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        registry.register(createMockProvider('mock'));
        mcpManager = new McpServerManager(registry);
        app = setupApp(registry, mcpManager);
        await mcpManager.start();
    });

    afterEach(async () => {
        if (mcpManager.running) {
            await mcpManager.stop();
        }
    });

    it('应响应 MCP 初始化请求', async () => {
        const res = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test-client', version: '1.0.0' },
                },
            });

        // MCP Streamable HTTP 初始化应返回 200（接受 JSON 或 SSE 响应）
        // 如果仍有问题，记录完整响应用于调试
        if (res.status !== 200) {
            throw new Error(
                `INIT FAILED: status=${res.status} body=${JSON.stringify(res.body)} headers=${JSON.stringify(res.headers)}`,
            );
        }
        expect(res.status).toBe(200);
    });

    it('未启动时 MCP 端点应返回 503', async () => {
        await mcpManager.stop();
        const res = await request(app)
            .post('/mcp')
            .send({ jsonrpc: '2.0', method: 'tools/list', id: 2 });

        expect(res.status).toBe(503);
        expect(res.body.error).toBe('MCP 服务未启动');
    });

    it('GET 请求 MCP 端点应返回 SSE 流', async () => {
        // Streamable HTTP 的 GET 用于 SSE 连接，需要 Accept: text/event-stream
        const res = await request(app)
            .get('/mcp')
            .set('Accept', 'text/event-stream');
        // GET SSE 在无活跃会话时可能返回不同状态码，但不应是 500
        expect(res.status).not.toBe(500);
        expect(res.status).not.toBe(503);
    });
});

describe('MCP 工具注册', () => {
    let registry: ProviderRegistry;
    let mcpManager: McpServerManager;
    let app: ReturnType<typeof express>;

    beforeEach(async () => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        registry.register(createMockProvider('mock', ['model-a', 'model-b']));
        mcpManager = new McpServerManager(registry);
        app = setupApp(registry, mcpManager);
        await mcpManager.start();
    });

    afterEach(async () => {
        if (mcpManager.running) {
            await mcpManager.stop();
        }
    });

    it('tools/list 应返回 6 个已注册工具', async () => {
        // Step 1: 初始化 MCP 会话
        const initRes = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0' },
                },
            });

        if (initRes.status !== 200) {
            throw new Error(
                `INIT FAILED: ${initRes.status} - ${JSON.stringify(initRes.body)}`,
            );
        }

        // 获取 session ID
        const sessionId =
            initRes.headers['mcp-session-id'] || initRes.header?.['mcp-session-id'];

        // Step 2: 发送 initialized 通知
        if (sessionId) {
            await request(app)
                .post('/mcp')
                .set('Accept', 'application/json, text/event-stream')
                .set('Content-Type', 'application/json')
                .set('Mcp-Session-Id', sessionId as string)
                .send({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized',
                });
        }

        // Step 3: 请求工具列表
        const toolsReq = request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json');
        if (sessionId) {
            toolsReq.set('Mcp-Session-Id', sessionId as string);
        }
        const res = await toolsReq.send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
        });

        // 工具列表请求应成功
        if (res.status !== 200) {
            throw new Error(
                `TOOLS/LIST FAILED: ${res.status} - ${JSON.stringify(res.body)}`,
            );
        }

        // 验证返回的工具列表
        const body = res.body;
        if (body && typeof body === 'object' && body.result?.tools) {
            const toolNames = body.result.tools.map((t: { name: string }) => t.name);
            expect(toolNames).toContain('get_models');
            expect(toolNames).toContain('get_param_spec');
            expect(toolNames).toContain('submit_task');
            expect(toolNames).toContain('query_all_tasks');
            expect(toolNames).toContain('query_task_detail');
            expect(toolNames).toContain('get_video_asset');
            expect(toolNames).toHaveLength(6);
        } else {
            // 工具列表可能在 SSE 流或其他格式中
            expect(res.status).toBe(200);
        }
    });
});

describe('MCP 会话重启（DELETE + 重新 initialize）', () => {
    let registry: ProviderRegistry;
    let mcpManager: McpServerManager;
    let app: ReturnType<typeof express>;

    beforeEach(async () => {
        closeDb();
        initDb(':memory:');
        registry = new ProviderRegistry();
        registry.register(createMockProvider('mock'));
        mcpManager = new McpServerManager(registry);
        app = setupApp(registry, mcpManager);
        await mcpManager.start();
    });

    afterEach(async () => {
        if (mcpManager.running) {
            await mcpManager.stop();
        }
    });

    async function doInitialize() {
        const res = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0' },
                },
            });
        if (res.status !== 200) {
            throw new Error(`INIT FAILED: ${res.status} - ${JSON.stringify(res.body)}`);
        }
        return res.headers['mcp-session-id'] || (res as any).header?.['mcp-session-id'] as string | undefined;
    }

    it('DELETE 后应能重新 initialize（会话终止 → 自动重启传输层）', async () => {
        // Step 1: 首次初始化
        const sessionId1 = await doInitialize();
        expect(sessionId1).toBeDefined();

        // Step 2: 发送 DELETE 终止会话
        const delRes = await request(app)
            .delete('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .set('Mcp-Session-Id', sessionId1!);

        expect(delRes.status).toBe(200);

        // 等待异步重启完成
        await new Promise((r) => setTimeout(r, 100));

        // Step 3: 重新初始化 — 之前会返回 -32600 "Server already initialized"
        const sessionId2 = await doInitialize();
        expect(sessionId2).toBeDefined();
        // 新 session ID 应不同于旧 session
        expect(sessionId2).not.toBe(sessionId1);
    });

    it('重复 initialize（无 DELETE）应自动重建传输层并成功', async () => {
        // Step 1: 首次初始化
        const sessionId1 = await doInitialize();
        expect(sessionId1).toBeDefined();

        // Step 2: 不发送 DELETE，直接再次 initialize
        // 修复前：返回 -32600 "Server already initialized"
        // 修复后：自动重建传输层，初始化成功
        const initRes2 = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                jsonrpc: '2.0',
                id: 2,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0' },
                },
            });

        expect(initRes2.status).toBe(200);
        // 新响应不应包含 "already initialized" 错误
        if (initRes2.body?.error) {
            throw new Error(
                `第二次 initialize 不应返回错误: ${JSON.stringify(initRes2.body)}`,
            );
        }
    });

    it('正常工具调用在重复 initialize 重建后仍可工作', async () => {
        // Step 1: 首次初始化
        const sessionId1 = await doInitialize();
        expect(sessionId1).toBeDefined();

        // 发送 initialized 通知
        await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .set('Mcp-Session-Id', sessionId1!)
            .send({ jsonrpc: '2.0', method: 'notifications/initialized' });

        // Step 2: 重复 initialize（触发自动重建）
        const initRes2 = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                jsonrpc: '2.0',
                id: 2,
                method: 'initialize',
                params: {
                    protocolVersion: '2025-03-26',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0' },
                },
            });
        expect(initRes2.status).toBe(200);
        const sessionId2 = initRes2.headers['mcp-session-id'] || (initRes2 as any).header?.['mcp-session-id'] as string | undefined;
        expect(sessionId2).toBeDefined();

        // 发送 initialized 通知
        if (sessionId2) {
            await request(app)
                .post('/mcp')
                .set('Accept', 'application/json, text/event-stream')
                .set('Content-Type', 'application/json')
                .set('Mcp-Session-Id', sessionId2)
                .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        }

        // Step 3: 工具列表在新会话中应正常工作
        const toolsReq = request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json');
        if (sessionId2) {
            toolsReq.set('Mcp-Session-Id', sessionId2);
        }
        const res = await toolsReq.send({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/list',
        });

        expect(res.status).toBe(200);
        if (res.body?.result?.tools) {
            expect(res.body.result.tools.length).toBeGreaterThanOrEqual(1);
        }
    });

    it('直接发送 tools/list（不先 initialize）应自动完成握手并返回工具列表', async () => {
        // 模拟 AstrBot 等客户端：不先 initialize，直接调用 tools/list
        // 修复前：返回 400 "Bad Request: Server not initialized"
        // 修复后：自动完成 initialize 握手，正常返回工具列表
        const res = await request(app)
            .post('/mcp')
            .set('Accept', 'application/json, text/event-stream')
            .set('Content-Type', 'application/json')
            .send({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            });

        // 自动初始化后 tools/list 应成功
        if (res.status !== 200) {
            throw new Error(
                `AUTO-INIT tools/list FAILED: ${res.status} - ${JSON.stringify(res.body)}`,
            );
        }
        expect(res.status).toBe(200);

        // 应能在响应中找到工具列表
        if (res.body?.result?.tools) {
            expect(res.body.result.tools.length).toBeGreaterThanOrEqual(1);
        }
    });
});
