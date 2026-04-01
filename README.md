# AI Video Task Hub (AI 视频生成任务管理中心)

## 项目介绍

AI Video Task Hub 是一个面向个人使用场景的轻量级 AI 视频生成任务管理工具，用来统一接入不同平台的视频生成能力，并持续追踪异步任务状态。

当前代码库版本为 0.1.0。

它主要解决三类问题：

- 不同平台接口风格不一致，切换成本高
- 视频生成通常需要较长时间，用户需要反复手动查询状态
- 生成结果、上传图片和平台配置缺少统一管理入口

## 核心功能

### 统一任务管理

- 支持创建文生视频、图生视频任务
- 自动轮询任务状态，无需手动刷新平台后台
- 生成成功后自动下载结果到本地 data/videos
- 失败任务支持重试
- 任务列表支持按平台、状态、提示词、日期筛选

### 参数复用与素材复用

- 支持从任务列表或回收站一键套用历史参数重新创建任务
- 支持查看任务详细参数和图片预览
- 支持从已上传图片库中直接选择图片，避免重复上传同一素材

### 回收站

- 删除任务时先进入回收站，避免误删
- 支持从回收站恢复任务
- 删除满 30 天后可彻底删除，并清理本地媒体文件
- 清理本地图片时会检查是否仍被其他任务引用，避免误删共享素材

### 设置与模型管理

- 可在界面中配置各平台 API Key
- 支持区分环境变量配置和界面内保存配置
- AIHubMix 支持动态模型列表缓存，并可手动刷新模型

### 界面体验

- 提供明暗主题切换
- 平台与应用图标已内置
- 支持图片悬停预览、视频预览和常用操作弹窗

### 日志与持久化

- 使用 SQLite 保存任务和设置
- 运行日志同时输出到控制台和 data/logs
- 重启服务后仍能保留任务记录、设置和本地文件

## 已接入平台

| 平台 | 当前接入情况 | 说明 |
|------|--------------|------|
| SiliconFlow 硅基流动 | 已接入固定模型 | 支持 Wan 2.2 文生视频和图生视频 |
| 火山引擎 Seedance | 已接入固定模型 | 支持首帧、首尾帧、参考图、分辨率、比例、时长、音频等能力 |
| AIHubMix | 已接入动态模型 | 模型列表通过接口拉取并缓存，支持手动刷新 |

其中：

- SiliconFlow 当前内置模型为 Wan-AI/Wan2.2-T2V-A14B 和 Wan-AI/Wan2.2-I2V-A14B
- 火山引擎当前内置 5 个 Seedance 模型
- AIHubMix 的视频模型由后端动态获取，不在 README 中硬编码完整列表

## 安装与运行

### 前提条件

- 本地开发：Node.js 18 及以上
- Docker 部署：Docker 20+，建议使用 Docker Compose V2

### Docker Compose 部署

使用仓库根目录自带的 docker-compose.yml：

```bash
docker compose up -d
docker compose logs -f
docker compose down
```

默认会拉取预构建镜像：

- ghcr.io/silevilence/aivideotaskhub:latest

如果你希望本地构建镜像进行部署，可使用开发版 Compose 配置：

```bash
docker compose -f docker-compose.dev.yml up --build
```

启动后访问 http://localhost:3000。

### 直接使用 Docker

拉取预构建镜像运行：

```bash
docker run -d \
  --name ai-video-task-hub \
  -p 3000:3000 \
  -v ${PWD}/data:/app/data \
  -e PORT=3000 \
  ghcr.io/silevilence/aivideotaskhub:latest
```

如果需要自行构建镜像：

```bash
docker build -t ai-video-task-hub .
docker run -d --name ai-video-task-hub -p 3000:3000 -v ${PWD}/data:/app/data ai-video-task-hub
```

### 本地开发

```bash
git clone https://github.com/silevilence/AIVideoTaskHub.git
cd AIVideoTaskHub
npm install
npm run dev
```

开发模式下：

- 前端开发服务器默认地址为 http://localhost:5173
- 后端服务默认地址为 http://localhost:3000
- 前端已配置代理，访问 /api 时会自动转发到后端

### 生产构建与启动

```bash
npm run build
npm run start
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| PORT | 3000 | 服务监听端口 |
| DB_PATH | data/app.db | SQLite 数据库文件路径 |
| DATA_DIR | data | 数据根目录，上传、视频、日志都会写入该目录 |
| POLL_INTERVAL_MS | 5000 | 后台轮询间隔，单位毫秒 |
| MAX_RETRIES | 3 | 任务失败后的最大重试次数 |
| LOG_LEVEL | info | 日志级别，支持 debug、info、warn、error |
| SILICONFLOW_API_KEY | 无 | SiliconFlow API Key，可替代界面中的保存设置 |
| VOLCENGINE_API_KEY | 无 | 火山引擎 API Key，可替代界面中的保存设置 |
| AIHUBMIX_API_KEY | 无 | AIHubMix API Key，可替代界面中的保存设置 |

说明：

- 如果同时设置了环境变量和界面内保存的配置，界面会显示来源差异
- API Key 也可以完全通过 Web 设置页面维护

## 数据持久化

默认所有运行时数据都保存在 data 目录下：

| 路径 | 说明 |
|------|------|
| data/app.db | SQLite 数据库，保存任务记录与 Provider 设置 |
| data/uploads | 上传图片和可复用图片素材 |
| data/videos | 下载到本地的视频结果 |
| data/logs | 运行日志文件 |

部署时建议把整个 data 目录映射到宿主机，避免容器重建后数据丢失。

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/providers | 获取已注册平台列表 |
| GET | /api/providers/models | 获取所有平台模型及能力声明 |
| POST | /api/providers/:provider/refresh-models | 刷新指定平台的动态模型缓存 |
| GET | /api/settings | 获取平台设置、当前值与来源 |
| PUT | /api/settings/:provider | 更新指定平台设置 |
| POST | /api/upload | 上传图片 |
| GET | /api/uploads | 获取已上传图片列表 |
| POST | /api/tasks | 创建任务 |
| GET | /api/tasks | 查询任务列表或按条件筛选 |
| GET | /api/tasks/:id | 获取单个任务详情 |
| POST | /api/tasks/:id/retry | 重试失败任务 |
| DELETE | /api/tasks/:id | 软删除任务 |
| GET | /api/trash | 获取回收站列表 |
| GET | /api/trash/:id | 获取回收站任务详情 |
| POST | /api/trash/:id/restore | 从回收站恢复任务 |
| DELETE | /api/trash/:id | 彻底删除回收站任务 |

## 技术栈

- 后端：Node.js + Express 5.2 + better-sqlite3 12.8 + TypeScript 6
- 前端：React 19.2 + Vite 6.4 + Tailwind CSS 4.2 + shadcn/ui + Lucide React
- 测试：Vitest 2.1 + Supertest 7.2
- 运行：tsx 4.21
- 本地开发编排：concurrently 9.2

## 适合的使用场景

- 个人统一管理多个 AI 视频平台账号和任务
- 持续观察长耗时视频生成任务
- 本地保存生成结果、上传素材和参数记录
- 在不同平台之间快速切换并复用历史任务配置