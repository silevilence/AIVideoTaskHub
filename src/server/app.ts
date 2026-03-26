import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());

// 托管前端构建产物
const distPath = path.resolve(__dirname, '../web/dist');
app.use(express.static(distPath));

// 托管下载的视频文件
const videosPath = path.resolve(process.env.DATA_DIR || 'data/videos');
app.use('/videos', express.static(videosPath));

// API 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// SPA 回退：非 API 路由返回前端 index.html
app.get('*path', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

export default app;
