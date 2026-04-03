# AI 辅助开发指导文件 (Copilot Instructions)

## 📌 项目基本信息
- **项目定位**：个人家用的 AI 视频生成 API 聚合与异步任务管理系统。
- **架构模式**：前后端一体化（Monolithic），Node.js 负责 API、静态资源托管与后台轮询，单 Docker 镜像部署。
- **当前代码版本**：1.2.0
- **最近变更记录**：最新 Change Log 条目为 V1.2.0
- **已接入平台**：SiliconFlow（硅基流动）、火山引擎 Seedance、AIHubMix。

## 🛠️ 技术栈与依赖包
- **后端**：Node.js、Express 5.2.1、better-sqlite3 12.8.0、TypeScript 6.0.2
- **前端**：React 19.2.4、React DOM 19.2.4、Vite 6.4.1、Tailwind CSS 4.2.2、shadcn/ui、Lucide React 1.7.0
- **测试**：Vitest 2.1.9、Supertest 7.2.2
- **运行时**：tsx 4.21.0
- **工程化**：concurrently 9.2.1、@tailwindcss/vite 4.0、@vitejs/plugin-react 4.7.0
- **语言**：TypeScript（全栈，ESM）

## 📂 目录结构
```text
.
├── src/
│   ├── server/                      # 后端代码
│   │   ├── app.ts                   # Express 应用配置（静态资源、API、SPA 回退）
│   │   ├── index.ts                 # 服务入口（初始化数据库、Provider、轮询器）
│   │   ├── database.ts              # SQLite 初始化与轻量迁移
│   │   ├── logger.ts                # 控制台 + 文件日志
│   │   ├── llm-client.ts            # OpenAI/Ollama 兼容的 LLM 客户端
│   │   ├── provider.ts              # Provider 接口、模型能力声明、设置项声明
│   │   ├── provider-registry.ts     # Provider 注册中心
│   │   ├── task-model.ts            # Task/Settings 数据访问层
│   │   ├── task-poller.ts           # 后台轮询 Worker（状态同步、下载、重试）
│   │   ├── task-router.ts           # API 路由
│   │   ├── text-settings.ts         # 文本 AI 和提示词优化设置的数据层
│   │   └── providers/
│   │       ├── mock-provider.ts
│   │       ├── siliconflow-provider.ts
│   │       ├── volcengine-provider.ts
│   │       └── aihubmix-provider.ts
│   └── web/
│       ├── index.html
│       ├── vite.config.ts           # Vite 配置，构建输出到 src/web/dist
│       └── src/
│           ├── App.tsx              # 主应用，管理标签页和参数套用流转
│           ├── api.ts               # 前端 API 客户端与类型定义
│           ├── index.css
│           ├── main.tsx
│           ├── assets/
│           │   └── icons/           # 平台图标与应用图标
│           ├── components/
│           │   ├── CreateTaskForm.tsx  # 创建任务、套用参数、图片库选择
│           │   ├── PromptOptimizer.tsx # AI 提示词智能优化组件
│           │   ├── TaskList.tsx        # 任务列表、筛选、预览、下载、套用参数
│           │   ├── RecycleBin.tsx      # 回收站、分类筛选、恢复、彻底删除
│           │   ├── SettingsPanel.tsx   # Provider 设置、来源展示、模型刷新
│           │   ├── TextSettingsPanel.tsx # 文本模型和提示词优化设置面板
│           │   ├── ThemeToggle.tsx
│           │   └── ui/                # 基础 UI 组件
│           ├── hooks/
│           │   └── use-theme.ts
│           └── lib/
│               └── utils.ts
├── tests/                           # Provider、路由、轮询器、回收站、UI 逻辑测试
├── refs/                            # 第三方 API 文档缓存
├── data/                            # 数据目录（数据库、上传、视频、日志）
├── package.json
├── Dockerfile
├── docker-compose.yml               # 生产部署，使用预构建镜像
└── docker-compose.dev.yml           # 本地构建镜像的开发部署配置
```

## 🏗️ 核心架构概念

### Provider 系统
- **统一接口**：`VideoProvider` 定义 `createTask`、`getStatus`、`downloadVideo` 等标准方法。
- **模型能力声明**：`ModelCapabilities` 描述图生视频、首尾帧、参考图、音频、固定镜头、分辨率、时长、比例等能力，前端按能力动态渲染表单。
- **设置项声明**：`ProviderSettingSchema` 定义设置项的 `key`、`label`、`secret`、`required`、`defaultValue` 和 `description`。
- **动态模型刷新**：Provider 可选实现 `refreshModels`、`needsModelRefresh`、`getCacheData`。当前 AIHubMix 使用该机制缓存模型列表，并通过设置表持久化更新时间。
- **注册中心**：`ProviderRegistry` 负责注册、查找和列出 Provider。

### 任务生命周期
`pending` → `running` → `success` / `failed`

- 创建任务时先写入 `tasks` 表，再调用 Provider 创建远端任务。
- 轮询器读取 `pending` / `running` 任务，调用 Provider 查询状态。
- 状态成功后下载视频到本地 `data/videos/`，再把相对路径写入 `result_url`。
- 状态失败时记录 `error_message`，并按配置进行重试。
- 删除任务时写入 `deleted_at` 进入回收站；恢复时清空 `deleted_at`；彻底删除时写入 `purged_at` 并清理本地文件。

### 数据库

#### tasks 表
- `id`: 自增主键
- `provider`: Provider 名称
- `provider_task_id`: 第三方平台任务 ID
- `status`: 当前任务状态
- `prompt`: 用户输入的提示词
- `model`: 选中的模型 ID
- `image_url`: 首帧图或主参考图地址
- `result_url`: 下载后的视频相对路径
- `error_message`: 失败信息
- `extra_params`: Provider 扩展参数 JSON
- `retry_count`: 重试次数
- `created_at`: 创建时间
- `updated_at`: 更新时间
- `deleted_at`: 软删除时间
- `purged_at`: 彻底删除时间

#### settings 表
- `key`: 配置键，命名格式 `provider:{providerName}:{settingKey}`
- `value`: 配置值

### 数据库迁移策略
- `database.ts` 在启动时自动创建 `tasks` 与 `settings` 表。
- 对已有库进行轻量迁移：缺少 `deleted_at`、`extra_params`、`purged_at` 时自动补列。
- 测试环境统一使用 `initDb(':memory:')`。

### 前端功能模块
- **CreateTaskForm**：支持 Provider/模型选择、动态参数、图片上传、图片库复用、从任务/回收站套用参数。
- **PromptOptimizer**：支持对话式提示词优化、流式输出与快速采纳。
- **TaskList**：支持任务筛选、状态展示、视频预览、错误查看、参数详情和参数套用。
- **RecycleBin**：支持回收站浏览、恢复、彻底删除、媒体大小展示和参数套用。支持按服务商、状态、提示词等筛选。
- **SettingsPanel**：支持设置保存、显示环境变量/本地保存来源、AIHubMix 模型刷新。
- **TextSettingsPanel**：支持配置独立的文本 Provider 和多种模型参数项配置。
- **ThemeToggle**：管理亮色/暗色主题切换。

## 🌐 API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/providers` | 列出所有 Provider |
| GET | `/api/providers/models` | 获取所有 Provider 的模型与能力声明 |
| POST | `/api/providers/:provider/refresh-models` | 刷新支持动态模型的 Provider |
| GET | `/api/settings` | 获取 Provider 设置、当前值和来源 |
| PUT | `/api/settings/:provider` | 更新指定 Provider 设置 |
| POST | `/api/upload` | 上传图片，限制 10MB |
| GET | `/api/uploads` | 获取已上传图片列表 |
| GET | `/api/text-settings` | 获取文本设置 |
| PUT | `/api/text-settings` | 更新文本设置 |
| GET | `/api/text-settings/model-languages` | 获取默认文本请求语言表 |
| PUT | `/api/text-settings/model-languages` | 更新文本请求语言表 |
| POST | `/api/text-settings/fetch-models` | 获取目标文本 Provider 支持的模型 |
| POST | `/api/prompt/optimize` | 发起 LLM 提示词优化（含流式）|
| POST | `/api/prompt/optimize/abort` | 取消优化 |
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks` | 获取任务列表，支持 providers/statuses/prompt/startDate/endDate 过滤 |
| GET | `/api/tasks/:id` | 获取单个任务详情 |
| POST | `/api/tasks/:id/retry` | 重试失败任务 |
| DELETE | `/api/tasks/:id` | 软删除任务 |
| GET | `/api/trash` | 获取回收站任务列表 |
| GET | `/api/trash/:id` | 获取回收站任务详情 |
| POST | `/api/trash/:id/restore` | 恢复回收站任务 |
| DELETE | `/api/trash/:id` | 彻底删除回收站任务 |

## 🔐 环境变量与运行时约定
- `PORT`：服务端口，默认 3000
- `DB_PATH`：数据库路径，默认 `data/app.db`
- `DATA_DIR`：数据根目录，默认 `data`
- `POLL_INTERVAL_MS`：轮询间隔，默认 5000
- `MAX_RETRIES`：最大重试次数，默认 3
- `LOG_LEVEL`：日志级别，默认 `info`
- `SILICONFLOW_API_KEY`、`VOLCENGINE_API_KEY`、`AIHUBMIX_API_KEY`：可直接通过环境变量注入 Provider 凭据

## 💻 开发与命名规范
- **变量与函数**：`camelCase`
- **React 组件**：`PascalCase`
- **数据库字段**：`snake_case`
- **普通文件**：`kebab-case`
- **缩进风格**：项目现有代码统一使用 4 空格

## 🧪 测试规范
- 测试框架：Vitest + Supertest
- 测试文件位于 `tests/`，命名为 `*.test.ts`
- 数据库测试统一使用内存数据库 `initDb(':memory:')`
- API 测试通过 `supertest(app)` 发起请求
- 每个测试在 `beforeEach` 中重新初始化数据库
- 新增业务逻辑时优先补充对应测试，尤其是 Provider、路由和数据层

## 🐛 问题修复流程

当用户提交一个问题或 bug 时，请按以下流程进行：

1. **确认问题**：先确认用户描述是否清晰；不清楚时主动补充问题上下文。
2. **定位问题**：根据描述定位到对应文件、函数和行为路径。
3. **修复问题**：优先修根因，不做表面性补丁。
4. **编写测试**：补充能稳定复现并验证修复结果的测试。
5. **确认修复**：向用户说明修改结果、验证方式和剩余风险。

## 🚀 核心开发要求 (严格遵守)
1. **测试驱动开发 (TDD) 强制执行**：在实现具体业务逻辑之前，优先先写或先补测试。
2. **禁止擅自更新文档**：除非用户明确要求，否则不要主动修改 `README.md`、`ROADMAP.md` 及本说明文件。
3. **禁止擅自提交 Git**：除非用户明确要求，否则不要执行 git commit。

## 🌿 Git 提交规范
当被允许提交代码时，提交信息必须严格使用以下格式：

第一行：`<emoji> <type>: <简要说明>`

如果修改较复杂，从第二行空行后开始写详细说明。

**Type 列表：**
- `feat`: 新功能 (✨)
- `fix`: 修复 Bug (🐛)
- `docs`: 文档修改 (📚)
- `style`: 代码格式化或无逻辑更改 (💎)
- `refactor`: 重构 (♻️)
- `test`: 增加测试 (🚨)
- `chore`: 构建过程或辅助工具变动 (🔧)

**示例：**
```text
✨ feat: 新增 AIHubMix Provider

- 接入动态模型拉取与缓存
- 增加模型刷新接口与设置页入口
```