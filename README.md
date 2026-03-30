# AI Video Task Hub (AI视频生成任务管理中心)

## 📖 项目介绍

本项目是一个专为个人家用设计的轻量级 AI 视频生成 API 聚合与任务管理工具。
主要解决不同视频大模型（如 SiliconFlow、火山引擎 Seedance 等）API 接口不统一、生成耗时长（异步任务）的问题。

**核心特性：**
- **多平台聚合**：采用策略模式（Provider）统一不同厂商的视频生成接口，当前已接入 SiliconFlow 和火山引擎 Seedance。
- **后台异步轮询**：内置轻量级任务队列与轮询 Worker，提交任务后即可离开，系统会在后台自动追踪任务状态并下载完成的视频。
- **丰富的生成模式**：支持文生视频、图生视频（首帧/首尾帧/参考图）等多种生成方式，支持分辨率、宽高比、时长等参数配置。
- **持久化存储**：使用 SQLite 进行轻量级本地存储，重启服务不会丢失任务进度。
- **极简部署**：前后端一体化（Monolithic）架构，单 Docker 镜像部署，提供 Docker Compose 一键启动。
- **纯粹的工具**：专注个人使用体验，无需登录、无多用户权限、无计费系统。

---

## ✨ 功能概览

### 任务管理
- 创建视频生成任务（文生视频 / 图生视频）
- 实时查看任务状态（等待中、生成中、成功、失败）
- 成功任务可预览和下载视频
- 失败任务支持一键重试
- 任务列表支持按平台、状态、提示词、日期等条件筛选

### 回收站
- 删除的任务移入回收站，防止误删
- 回收站内可查看任务详情和媒体文件
- 已删除超过 30 天的任务可彻底删除并清理本地文件

### 平台与设置
- 在界面中配置各平台的 API 密钥
- 提交任务前自动检查必填设置项
- 平台选择展示图标，方便区分

### 界面与体验
- 明暗主题切换，默认跟随系统
- 使用 shadcn/ui 构建现代化界面

---

## 🔌 已接入平台

| 平台 | 支持模型 | 生成模式 |
|------|----------|----------|
| **SiliconFlow** | Wan2.2-T2V (文生视频)、Wan2.2-I2V (图生视频) | 文生视频、图生视频 |
| **火山引擎 Seedance** | 1.5 Pro、1.0 Pro、1.0 Pro Fast、1.0 Lite T2V/I2V | 文生视频、图生视频（首帧/首尾帧/参考图），支持分辨率、宽高比、时长、音频生成等参数 |

---

## 🛠️ 安装与运行

### 前提条件

- **本地开发**：Node.js >= 18
- **Docker 部署**：Docker >= 20, Docker Compose V2

### Docker 部署（推荐）

**方式一：Docker Compose**

创建 `docker-compose.yml`：

```yaml
services:
  app:
    image: ghcr.io/silevilence/aivideotaskhub:latest
    container_name: ai-video-task-hub
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=3000
    restart: unless-stopped
```

```bash
# 启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

镜像同时发布在 [GitHub Container Registry](https://ghcr.io/silevilence/aivideotaskhub) 和 [Docker Hub](https://hub.docker.com/r/silevilence/ai-video-task-hub)，可替换镜像地址：
```yaml
image: silevilence/ai-video-task-hub:latest
```

**方式二：直接使用 Docker**

```bash
docker run -d \
  --name ai-video-task-hub \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  ghcr.io/silevilence/aivideotaskhub:latest
```

启动后访问 `http://localhost:3000` 即可使用。API 密钥等配置在界面的"设置"页面中完成。

### 本地开发

```bash
# 克隆项目
git clone https://github.com/silevilence/AIVideoTaskHub.git
cd AIVideoTaskHub

# 安装依赖
npm install

# 启动开发服务（同时启动后端 + 前端热更新）
npm run dev
```

开发模式下前端运行在 `http://localhost:5173`，后端 API 运行在 `http://localhost:3000`，前端已配置代理自动转发 API 请求。

### 数据持久化

所有持久化数据存储在 `data/` 目录下，通过 Docker Volume 映射到宿主机：

| 路径 | 说明 |
|------|------|
| `data/app.db` | SQLite 数据库（任务记录与设置） |
| `data/videos/` | 下载的视频文件 |
| `data/uploads/` | 上传的参考图片 |

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3000` | 服务监听端口 |
| `DB_PATH` | `data/app.db` | 数据库文件路径 |
| `POLL_INTERVAL_MS` | `5000` | 任务轮询间隔（毫秒） |
| `MAX_RETRIES` | `3` | 任务最大重试次数 |

> **注意**：各平台的 API 密钥通过 Web 界面的"设置"页面进行配置，无需设置环境变量。

---

## 🧑‍💻 技术栈

- **后端**：Node.js, Express, better-sqlite3, TypeScript
- **前端**：React, Vite, shadcn/ui, Tailwind CSS, TypeScript
- **测试**：Vitest, Supertest
- **部署**：Docker (多阶段构建), GitHub Actions 自动发布