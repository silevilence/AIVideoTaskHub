# AI Video Task Hub (AI 视频生成任务管理中心)

## 项目介绍

AI Video Task Hub 是一个面向个人使用场景的轻量级 AI 视频生成任务管理工具，用来统一接入不同平台的视频生成能力，并持续追踪异步任务状态。

它主要解决四类问题：

- 不同平台接口风格不一致，切换成本高
- 视频生成通常需要较长时间，用户需要反复手动查询状态
- 生成结果、上传图片和平台配置缺少统一管理入口
- 常用提示词模板难以沉淀、复用和统一管理

## 核心功能

### 统一任务管理

- 支持创建文生视频、图生视频任务
- 基于 AI 大语言模型提供提示词智能优化，支持流式输出、多语言选项和自定义模板
- 上传的本地图片在提交任务时自动转换格式，确保外部平台可正确识别
- 自动轮询任务状态，无需手动刷新平台后台
- 生成成功后自动下载结果到本地 data/videos
- 失败任务支持重试
- 任务列表支持按平台、状态、提示词、日期筛选

### 提示词库与优化

- 新增提示词库，可集中管理常用提示词模板
- 支持文件夹分类、标签、关键词搜索和默认提示词设置
- 系统内置多套预置模板，覆盖通用视频优化和 Seedance 2.0 场景
- 提示词优化面板可直接选择指定模板，也可回退到全局默认模板
- 自定义模板支持占位符校验和 Markdown 高亮编辑体验

### 参数复用与素材复用

- 支持从任务列表或回收站一键套用历史参数重新创建任务
- 切换服务商或模型时自动暂存和恢复参数设置，避免反复配置
- 切换生成模式时保持已上传的图片资源不丢失
- 支持查看任务详细参数和图片预览
- 支持从已上传图片库中直接选择图片，避免重复上传同一素材

### 回收站

- 删除任务时先进入回收站，避免误删
- 支持按平台、状态、提示词和删除时间对回收站进行筛选
- 支持从回收站恢复任务
- 删除满 30 天后可彻底删除，并清理本地媒体文件
- 清理本地图片时会检查是否仍被其他任务引用，避免误删共享素材

### 设置与模型管理

- 统一管理各种视频平台和文本提示词大语言模型配置
- 可在界面中配置各平台 API Key（兼容 OpenAI/Ollama 协议的自定义文本服务端点）
- 支持区分环境变量配置和界面内保存配置
- 设置项支持下拉选择框，配置操作更直观
- AIHubMix 支持直接接入和 OpenAI SDK 两种调用模式
- AIHubMix 支持动态模型列表缓存，可手动刷新模型
- 设置页面拆分为视频设置、文本设置、提示词库三个标签页

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
| 火山引擎 Seedance | 已接入固定模型 | 支持 Seedance 2.0/2.0 Fast/1.5/1.0 系列，涵盖文生视频、首帧、首尾帧、参考图、分辨率、比例、时长、音频等能力 |
| AIHubMix | 已接入动态模型 | 支持直接接入和 OpenAI SDK 两种调用模式，模型列表动态拉取并缓存 |

其中：

- SiliconFlow 当前内置模型为 Wan-AI/Wan2.2-T2V-A14B 和 Wan-AI/Wan2.2-I2V-A14B
- 火山引擎当前内置 7 个 Seedance 模型（2.0、2.0 Fast、1.5 Pro、1.0 Pro、1.0 Pro Fast、1.0 Lite 文生视频、1.0 Lite 图生视频）
- AIHubMix 的视频模型由后端动态获取，不在 README 中硬编码完整列表
- 当前 AIHubMix 已内置多组能力映射，覆盖 Sora、Veo、通义万相、即梦 3.0 等常见视频模型，实际可用列表以平台返回为准

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

该配置会将本地 data 目录挂载到容器内 /app/data，并启用 /api/health 健康检查。

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

镜像采用双阶段构建：先构建前端并编译服务端 TypeScript，再在生产镜像中仅安装生产依赖。

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
| SILICONFLOW_MODEL | 无 | 可覆盖 SiliconFlow 默认创建任务模型 |
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
| data/app.db | SQLite 数据库，保存任务记录、Provider 设置、文本设置、提示词和提示词目录 |
| data/uploads | 上传图片和可复用图片素材 |
| data/videos | 下载到本地的视频结果 |
| data/logs | 运行日志文件 |

部署时建议把整个 data 目录映射到宿主机，避免容器重建后数据丢失。

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查，返回服务状态、数据库状态和版本号 |
| GET | /api/providers | 获取已注册平台列表 |
| GET | /api/providers/models | 获取所有平台模型及能力声明 |
| POST | /api/providers/:provider/refresh-models | 刷新指定平台的动态模型缓存 |
| GET | /api/settings | 获取平台设置、当前值与来源 |
| PUT | /api/settings/:provider | 更新指定平台设置 |
| GET | /api/text-settings | 获取文本平台与提示词设置 |
| PUT | /api/text-settings | 更新文本平台与提示词设置 |
| GET | /api/text-settings/model-languages | 获取特定模型语言覆盖 |
| PUT | /api/text-settings/model-languages | 更新特定模型语言覆盖 |
| POST | /api/text-settings/fetch-models | 从兼容服务端获取可用文本模型 |
| POST | /api/prompt/optimize | 提交提示词优化，可选流式输出和指定 promptId |
| POST | /api/prompt/optimize/abort | 取消进行中的提示词优化请求 |
| GET | /api/prompts | 获取提示词列表，支持关键词搜索 |
| GET | /api/prompts/config/default | 获取全局默认提示词 |
| PUT | /api/prompts/config/default | 设置或清空全局默认提示词 |
| GET | /api/prompts/:id | 获取单个提示词详情 |
| POST | /api/prompts | 新建自定义提示词 |
| PUT | /api/prompts/:id | 更新自定义提示词 |
| DELETE | /api/prompts/:id | 删除自定义提示词 |
| GET | /api/prompt-folders | 获取提示词目录列表 |
| POST | /api/prompt-folders | 创建提示词目录 |
| PUT | /api/prompt-folders/:id | 重命名提示词目录 |
| DELETE | /api/prompt-folders/:id | 删除提示词目录 |
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
- 沉淀自己的提示词模板库，并在不同任务间复用