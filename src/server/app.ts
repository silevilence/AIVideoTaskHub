import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import type { ProviderRegistry } from './provider-registry.js';
import { createTaskRouter } from './task-router.js';
import { getDb } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(registry?: ProviderRegistry) {
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
    app.use('/api', createTaskRouter(registry));
  }

  // SPA 回退：非 API 路由返回前端 index.html
  app.get('*path', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });

  return app;
}

// 默认导出无 registry 的 app 以保持向后兼容
const app = createApp();
export default app;
