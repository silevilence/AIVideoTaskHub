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

        // 读取 package.json 获取版本号
        let version = 'unknown';
        try {
            const pkgPath = path.resolve(__dirname, '../../../package.json');
            if (existsSync(pkgPath)) {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                version = pkg.version;
            }
        } catch {
            // 忽略，使用默认版本号
        }

        // 创建 MCP Server 实例
        this.server = new McpServer(
            {
                name: 'ai-video-task-hub',
                version,
            },
            {
                capabilities: {
                    tools: {},
                },
                instructions:
                    'AI 视频生成任务管理 MCP 服务。提供模型查询、任务提交、状态追踪、视频资产提取等能力。',
            },
        );

        // 注册所有业务工具
        registerAllTools(this.server, this.registry);

        // 创建 Streamable HTTP 传输
        this.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
        });

        // 连接 Server 与 Transport
        await this.server.connect(this.transport);
        this._running = true;

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

        try {
            await this.transport.handleRequest(req, res, parsedBody);
        } catch (err) {
            logger.error(`MCP 请求处理异常: ${(err as Error).message}`);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'MCP 内部处理错误' }));
            }
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
