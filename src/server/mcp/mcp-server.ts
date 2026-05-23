/**
 * MCP 服务端管理器
 *
 * 负责 MCP 服务端的生命周期管理（启动、停止、状态查询），
 * 使用 MCP 官方 TypeScript SDK + Streamable HTTP 传输协议。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ProviderRegistry } from '../provider-registry.js';
import { registerAllTools } from './mcp-tools.js';
import { getSetting, setSetting } from '../task-model.js';
import { logger } from '../logger.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 常量 ──────────────────────────────────

const SETTING_KEY_ENABLED = 'mcp:enabled';
const SETTING_KEY_EXPLICITLY_DISABLED = 'mcp:explicitly_disabled';

// ── 类型 ──────────────────────────────────

export interface McpStatus {
    running: boolean;
    sessionId?: string;
}

// ── MCP 服务端管理器 ──────────────────────

export class McpServerManager {
    private server: McpServer | null = null;
    private transport: StreamableHTTPServerTransport | null = null;
    private _running = false;

    constructor(private registry: ProviderRegistry) {}

    /** 获取当前运行状态 */
    get running(): boolean {
        return this._running;
    }

    /**
     * 启动 MCP 服务端。
     * 创建 McpServer 实例、注册工具、初始化 Streamable HTTP 传输。
     * 注意：MCP 服务嵌入在 Express 中，端口由 Express 统一管理。
     */
    async start(): Promise<void> {
        if (this._running) {
            logger.warn('MCP 服务已在运行中，忽略重复启动');
            return;
        }

        await this._startInternal();

        // 持久化启用状态
        setSetting(SETTING_KEY_ENABLED, 'true');
        setSetting(SETTING_KEY_EXPLICITLY_DISABLED, 'false');

        logger.info('MCP 服务端已启动（Streamable HTTP 端点: /mcp）');
    }

    /**
     * 停止 MCP 服务端。
     */
    async stop(): Promise<void> {
        if (!this._running) {
            logger.warn('MCP 服务未在运行中，忽略重复停止');
            return;
        }

        try {
            await this.transport?.close();
            await this.server?.close();
        } catch (err) {
            logger.error(`MCP 服务端关闭异常: ${(err as Error).message}`);
        }

        this.server = null;
        this.transport = null;
        this._running = false;

        // 持久化禁用状态（用户手动停止 = 显式禁用，下次不再自动启动）
        setSetting(SETTING_KEY_ENABLED, 'false');
        setSetting(SETTING_KEY_EXPLICITLY_DISABLED, 'true');

        logger.info('MCP 服务端已停止');
    }

    /**
     * 内部重启传输层（不修改持久化设置）。
     *
     * 用于在客户端通过 DELETE 正常终止会话后，
     * 重建传输层以接受新的 initialize 请求。
     * SDK 的 close() 不会重置 _initialized 标志，
     * 导致旧传输层拒绝后续的 initialize，因此需要重建实例。
     */
    private async _restartTransport(): Promise<void> {
        // 关闭旧实例（忽略错误，因为可能已被 DELETE 内部关闭）
        if (this.transport) {
            try { await this.transport.close(); } catch { /* 忽略 */ }
        }
        if (this.server) {
            try { await this.server.close(); } catch { /* 忽略 */ }
        }

        this.server = null;
        this.transport = null;
        this._running = false;

        // 重新启动（内部调用 start() 但不修改持久化设置）
        await this._startInternal();
    }

    /**
     * 内部启动：创建 McpServer + Transport 并连接，不修改持久化设置。
     */
    private async _startInternal(): Promise<void> {
        if (this._running) return;

        // 多路径尝试读取版本号，兼容源码运行与 Docker 编译产物目录结构
        let version = 'unknown';
        try {
            const pkgPaths = [
                path.resolve(__dirname, '../../../package.json'), // 源码: src/server/mcp -> /
                path.resolve(process.cwd(), 'package.json'),       // Docker: CWD=/app
            ];
            for (const pkgPath of pkgPaths) {
                if (existsSync(pkgPath)) {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                    version = pkg.version || 'unknown';
                    break;
                }
            }
        } catch { /* 忽略 */ }

        this.server = new McpServer(
            {
                name: 'ai-video-task-hub',
                version,
            },
            {
                capabilities: { tools: {} },
                instructions:
                    'AI 视频生成任务管理 MCP 服务。提供模型查询、任务提交、状态追踪、视频资产提取等能力。',
            },
        );

        registerAllTools(this.server, this.registry);

        // enableJsonResponse: true 使用 JSON 响应代替 SSE 流，
        // 对 AstrBot 等简化客户端更友好，同时 Cherry Studio 完全兼容
        this.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
        });

        await this.server.connect(this.transport);
        this._running = true;
    }

    /**
     * 处理 MCP HTTP 请求。
     * 由 Express 路由调用，将请求转发给 Streamable HTTP 传输层。
     */
    async handleRequest(
        req: IncomingMessage,
        res: ServerResponse,
        parsedBody?: unknown,
    ): Promise<void> {
        if (!this._running || !this.transport) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'MCP 服务未启动' }));
            return;
        }

        // 检测到 initialize 请求但传输层已有 session（上次会话未被 DELETE 清理），
        // 自动重建传输层以避免 SDK 的 "Server already initialized" 错误。
        const isInitialize = this._isInitializeRequest(parsedBody);
        if (isInitialize && this.transport?.sessionId) {
            logger.info('检测到重复 initialize 请求，自动重建传输层');
            await this._restartTransport();
        }

        // 部分 MCP 客户端（如 AstrBot）可能直接发送 tools/list 而不先 initialize。
        // 此时状态化传输层尚未初始化，SDK 会返回 400 "Server not initialized"。
        // 为此类请求创建独立的无状态传输层实例来处理，无需预先握手。
        if (!isInitialize && !this.transport?.sessionId && parsedBody) {
            logger.info('检测到未初始化会话的请求，使用无状态传输层处理');
            await this._handleStatelessFallback(req, res, parsedBody);
            return;
        }

        const isDelete = req.method === 'DELETE';

        try {
            await this.transport.handleRequest(req, res, parsedBody);
        } catch (err) {
            logger.error(`MCP 请求处理异常: ${(err as Error).message}`);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'MCP 内部处理错误' }));
            }
            return;
        }

        // DELETE 处理完成后异步重启传输层，确保下次 initialize 可正常进行
        if (isDelete && this._running) {
            setImmediate(() => {
                this._restartTransport().catch((err) => {
                    logger.error(`MCP 传输层自动重启失败: ${(err as Error).message}`);
                });
            });
        }
    }

    /**
     * 检查已解析的请求体是否为 MCP initialize 请求。
     */
    private _isInitializeRequest(body: unknown): boolean {
        if (body && typeof body === 'object' && !Array.isArray(body)) {
            const obj = body as Record<string, unknown>;
            return obj.method === 'initialize' && obj.jsonrpc === '2.0';
        }
        return false;
    }

    /**
     * 使用无状态传输层处理单个请求。
     *
     * 为兼容不遵循 MCP Streamable HTTP 完整握手流程的客户端（如 AstrBot），
     * 创建独立的无状态 McpServer + Transport 实例，无需预先 initialize 即可
     * 直接响应 tools/list 等业务请求。
     *
     * 无状态模式下 sessionIdGenerator 为 undefined，SDK 不进行会话校验，
     * 但要求一个 Transport 实例只能处理一次请求，因此每次调用都新建实例。
     */
    private async _handleStatelessFallback(
        req: IncomingMessage,
        res: ServerResponse,
        parsedBody: unknown,
    ): Promise<void> {
        let version = 'unknown';
        try {
            const pkgPaths = [
                path.resolve(__dirname, '../../../package.json'),
                path.resolve(process.cwd(), 'package.json'),
            ];
            for (const pkgPath of pkgPaths) {
                if (existsSync(pkgPath)) {
                    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                    version = pkg.version || 'unknown';
                    break;
                }
            }
        } catch { /* 忽略 */ }

        const server = new McpServer(
            { name: 'ai-video-task-hub', version },
            {
                capabilities: { tools: {} },
                instructions:
                    'AI 视频生成任务管理 MCP 服务。提供模型查询、任务提交、状态追踪、视频资产提取等能力。',
            },
        );

        registerAllTools(server, this.registry);

        // 无状态模式：不生成 session ID，每次请求独立
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });

        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, parsedBody);
        } catch (err) {
            logger.error(`无状态传输层处理异常: ${(err as Error).message}`);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'MCP 内部处理错误' }));
            }
        } finally {
            try { await transport.close(); } catch { /* 忽略 */ }
            try { await server.close(); } catch { /* 忽略 */ }
        }
    }

    /**
     * 获取当前状态快照。
     */
    getStatus(): McpStatus {
        return {
            running: this._running,
            sessionId: this.transport?.sessionId,
        };
    }

    /**
     * 从持久化存储加载启用状态。
     * 返回 true 表示之前是启用状态，调用方应在服务启动时自动恢复。
     */
    static wasEnabled(): boolean {
        return getSetting(SETTING_KEY_ENABLED) === 'true';
    }
}
