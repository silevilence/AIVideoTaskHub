# AI Video Task Hub (AI视频生成任务管理中心)

## 📖 项目介绍

本项目是一个专为个人家用设计的轻量级 AI 视频生成 API 聚合与任务管理工具。
主要解决不同视频大模型（如 Seedance、即梦等）API 接口不统一、生成耗时长（异步任务）的问题。

**核心特性：**
- **统一入口**：采用策略模式（Adapter）统一不同厂商的视频生成接口调用格式。
- **后台异步轮询**：内置轻量级任务队列与轮询 Worker，提交任务后即可离开，系统会在后台自动追踪任务状态。
- **持久化存储**：使用 SQLite 进行轻量级本地存储，重启服务不会丢失任务进度。
- **极简部署**：前后端混合（Monolithic）架构，结合 Docker，实现一键打包与单镜像部署。
- **纯粹的工具**：专注个人使用体验，剥离复杂的多用户权限、登录、计费等系统。

---

## 🛠️ 安装与运行

### 前提条件

- **本地开发**：Node.js >= 18
- **Docker 部署**：Docker >= 20, Docker Compose V2

### 本地开发环境

```bash
# 克隆项目
git clone <your-repo-url>
cd AIVideoTaskHub

# 安装依赖
npm install

# 启动开发服务（同时启动后端 + 前端热更新）
npm run dev
```

开发模式下前端运行在 `http://localhost:5173`，后端 API 运行在 `http://localhost:3000`，前端已配置代理自动转发 API 请求。

### Docker 部署

**方式一：Docker Compose（推荐）**

```bash
# 按需在 .env 文件或环境变量中配置 API Key
export SILICONFLOW_API_KEY=your_api_key

# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

**方式二：直接使用 Docker**

```bash
# 构建镜像
docker build -t ai-video-task-hub .

# 运行容器
docker run -d \
  --name ai-video-task-hub \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e SILICONFLOW_API_KEY=your_api_key \
  ai-video-task-hub
```

启动后访问 `http://localhost:3000` 即可使用。

### 数据持久化

所有持久化数据存储在 `data/` 目录下，通过 Docker Volume 映射到宿主机：

| 路径 | 说明 |
|------|------|
| `data/app.db` | SQLite 数据库文件 |
| `data/videos/` | 下载的视频文件 |
| `data/uploads/` | 上传的图片文件 |

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `SILICONFLOW_API_KEY` | - | SiliconFlow API 密钥 |
| `DB_PATH` | `data/app.db` | 数据库文件路径 |
| `POLL_INTERVAL_MS` | `5000` | 任务轮询间隔（毫秒） |
| `MAX_RETRIES` | `3` | 任务最大重试次数 |