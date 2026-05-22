import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import type { ProviderRegistry } from './provider-registry.js';
import type { McpServerManager } from './mcp/mcp-server.js';
import { createTaskRouter } from './task-router.js';
import { getDb } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateAppOptions {
    registry?: ProviderRegistry;
    mcpManager?: McpServerManager;
}

export function createApp(registryOrOptions?: ProviderRegistry | CreateAppOptions) {
    let registry: ProviderRegistry | undefined;
    let mcpManager: McpServerManager | undefined;

    if (registryOrOptions && typeof (registryOrOptions as ProviderRegistry).get === 'function') {
        // 向后兼容：直接传入 ProviderRegistry 实例
        registry = registryOrOptions as ProviderRegistry;
    } else if (registryOrOptions) {
        registry = (registryOrOptions as CreateAppOptions).registry;
        mcpManager = (registryOrOptions as CreateAppOptions).mcpManager;
    }

    const app = express();

  app.use(express.json({ limit: '20mb' }));

  // 托管前端构建产物
  const distPath = path.resolve(__dirname, '../web/dist');
  app.use(express.static(distPath));

  // 托管下载的视频文件
  const videosPath = path.resolve(process.env.DATA_DIR || 'data/videos');
  app.use('/videos', express.static(videosPath));

  // 托管上传的图片文件
  const uploadsPath = path.resolve(process.env.DATA_DIR || 'data', 'uploads');
  app.use('/uploads', express.static(uploadsPath));

  // API 健康检查
  app.get('/api/health', (_req, res) => {
    let dbOk = false;
    try {
      const row = getDb().prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      dbOk = row?.ok === 1;
    } catch {
      // DB 未初始化或连接异常
    }

    let version = 'unknown';
    try {
      const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
      version = pkg.version;
    } catch {
      // 无法读取版本号
    }

    const healthy = dbOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      timestamp: Date.now(),
      version,
      db: dbOk ? 'ok' : 'unavailable',
    });
  });

  // 挂载任务路由
  if (registry) {
    app.use('/api', createTaskRouter(registry, mcpManager));
  }

  // MCP Streamable HTTP 端点（仅当 MCP 管理器存在时）
  if (mcpManager) {
    // MCP 端点 CORS 头 — 外部 AI 客户端（如 Cherry Studio）需跨域访问
    const mcpCorsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Authorization, App-Code',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    };

    app.all('/mcp', async (req, res) => {
      // 设置 CORS 响应头
      for (const [key, value] of Object.entries(mcpCorsHeaders)) {
        res.setHeader(key, value);
      }

      // 预检请求直接返回 204
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      // Express 5: req.body 已通过 express.json() 解析
      await mcpManager.handleRequest(req, res, req.body);
    });
  }

  // SPA 回退：非 API/MCP 路由返回前端 index.html
  app.get('*path', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  return app;
}

// 默认导出无 registry 的 app 以保持向后兼容
const app = createApp();
export default app;
