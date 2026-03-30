# AI 辅助开发指导文件 (Copilot Instructions)

## 📌 项目基本信息
- **项目定位**：个人家用的 AI 视频生成 API 聚合与异步任务管理系统。
- **架构模式**：前后端一体化（Monolithic），Node.js 作为 API 与静态资源服务器，单 Docker 镜像部署。
- **当前版本**：V1.0.0
- **已接入平台**：SiliconFlow（硅基流动）、火山引擎 Seedance，计划接入 AIHubMix。

## 🛠️ 技术栈与依赖包
- **后端**：Node.js, Express 5, better-sqlite3, TypeScript
- **前端**：React 19, Vite, shadcn/ui, Tailwind CSS 4, Lucide React (图标)
- **测试**：Vitest, Supertest
- **运行时**：tsx（TypeScript 直接执行）
- **工程化**：concurrently（本地同时启动前后端）
- **语言**：TypeScript（全栈）

## 📂 目录结构
```text
.
├── src/
│   ├── server/                # 后端代码
│   │   ├── app.ts             # Express 应用配置（路由挂载、静态资源、SPA回退）
│   │   ├── index.ts           # 服务入口（启动轮询、监听端口）
│   │   ├── database.ts        # SQLite 数据库初始化与迁移
│   │   ├── task-model.ts      # Task CRUD 操作 + Settings 键值存储
│   │   ├── task-router.ts     # API 路由定义（任务、设置、上传、Provider）
│   │   ├── task-poller.ts     # 后台轮询 Worker（状态查询 + 视频下载）
│   │   ├── provider.ts        # Provider 统一接口定义（VideoProvider, ModelInfo, ModelCapabilities）
│   │   ├── provider-registry.ts # Provider 注册中心
│   │   └── providers/         # 具体 Provider 实现
│   │       ├── mock-provider.ts       # 测试用模拟 Provider
│   │       ├── siliconflow-provider.ts # SiliconFlow 适配器
│   │       └── volcengine-provider.ts  # 火山引擎 Seedance 适配器
│   └── web/                   # 前端代码
│       ├── index.html
│       ├── vite.config.ts     # Vite 配置（代理 /api 到后端、构建输出到 dist）
│       └── src/
│           ├── App.tsx        # 主应用（标签页：创建任务/任务状态/回收站/设置）
│           ├── api.ts         # 前端 API 客户端
│           ├── components/    # UI 组件
│           │   ├── CreateTaskForm.tsx  # 任务创建表单（支持动态参数）
│           │   ├── TaskList.tsx        # 任务列表（筛选、预览、下载、重试）
│           │   ├── RecycleBin.tsx      # 回收站（查看/彻底删除）
│           │   ├── SettingsPanel.tsx   # 设置面板（API Key 等）
│           │   ├── ThemeToggle.tsx     # 主题切换
│           │   └── ui/                # shadcn/ui 基础组件
│           └── hooks/
│               └── use-theme.ts       # 主题管理 Hook
├── tests/                     # 单元测试与集成测试
├── refs/                      # API 文档参考缓存
├── data/                      # 运行时数据（数据库、视频、上传图片）
├── package.json
├── Dockerfile                 # 多阶段构建
├── docker-compose.yml         # 生产部署（使用预构建镜像）
└── docker-compose.dev.yml     # 开发部署（本地构建）
```

## 🏗️ 核心架构概念

### Provider 系统
- **接口**：`VideoProvider`（定义在 `provider.ts`），统一 `createTask`、`getStatus`、`downloadVideo` 方法。
- **模型能力**：每个模型通过 `ModelCapabilities` 声明支持的能力（i2v、首尾帧、参考图、音频生成、分辨率、时长范围等），前端根据此动态渲染表单。
- **设置架构**：Provider 通过 `getSettingsSchema()` 暴露配置项（如 API Key），支持 `secret`/`required` 标记，设置存储在 SQLite `settings` 表中。
- **注册中心**：`ProviderRegistry` 管理所有 Provider 实例，按 `name` 查找。

### 任务生命周期
`pending` → `running` → `success` / `failed`
- 创建任务 → 调用 Provider 的 `createTask` → 获取 `providerTaskId` → 存入数据库。
- 后台轮询 → 调用 `getStatus` → 状态变化时更新数据库 → 成功则下载视频到 `data/videos/`。
- 软删除 → 设置 `deleted_at` → 回收站可见 → 超过30天可彻底删除（清理文件）。

### 数据库
- **tasks 表**：id, provider, provider_task_id, status, prompt, model, image_url, result_url, error_message, extra_params (JSON), retry_count, created_at, updated_at, deleted_at, purged_at
- **settings 表**：key-value 存储，键命名 `provider:{providerName}:{settingKey}`

### API 端点
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/providers` | 列出所有 Provider |
| GET | `/api/providers/models` | 获取所有模型及能力 |
| GET | `/api/settings` | 获取所有 Provider 设置 |
| PUT | `/api/settings/:provider` | 更新 Provider 设置 |
| POST | `/api/upload` | 上传图片（10MB限制） |
| POST | `/api/tasks` | 创建任务 |
| GET | `/api/tasks` | 获取任务列表（支持筛选） |
| GET | `/api/tasks/:id` | 获取单个任务详情 |
| DELETE | `/api/tasks/:id` | 软删除任务 |
| POST | `/api/tasks/:id/retry` | 重试失败任务 |
| GET | `/api/tasks/trash` | 获取回收站任务 |
| DELETE | `/api/tasks/trash/:id/purge` | 彻底删除任务 |

## 💻 开发与命名规范
- **变量与函数**：`camelCase`（例：`createTask`, `videoUrl`）
- **React 组件**：`PascalCase`（例：`TaskList`, `CreateTaskForm`）
- **数据库字段**：`snake_case`（例：`task_id`, `created_at`）
- **配置文件/普通文件**：`kebab-case`（例：`task-router.ts`）

## 🧪 测试规范
- 测试框架：Vitest + Supertest
- 测试文件：`tests/` 目录，命名 `*.test.ts`
- 数据库测试使用内存数据库 `initDb(':memory:')`
- API 测试通过 `supertest(app)` 发送请求
- 每个测试需在 `beforeEach` 中重新初始化数据库

## 🐛 问题修复流程

当用户提交一个问题或bug时，请按以下流程进行：

1. **确认问题**：首先确认用户描述的问题是否清晰明确。如果不清楚，主动询问用户以获取更多细节。
2. **定位问题**：根据用户提供的信息，尝试定位问题所在的代码文件和相关函数。
3. **修复问题**：在定位到问题后，进行代码修改以修复该问题。确保修改后的代码符合项目的编码规范和架构要求。
4. **编写测试**：在修复问题后，编写相应的测试用例来验证问题是否已经被修复，并且没有引入新的问题。
5. **确认修复**：向用户说明修复结果，并使用 askQuestions 的方式确认用户是否满意修复结果，或者是否需要进一步的帮助。

## 🚀 核心开发要求 (严格遵守)
1. **测试驱动开发 (TDD) 强制执行**：在实现具体业务逻辑（如任务增删改查、API 适配器）之前，**必须**先编写对应的单元测试/接口测试。
2. **禁止擅自更新文档**：除非用户在对话中明确要求，否则**绝对禁止**主动修改 `README.md`、`ROADMAP.md` 及本说明文件。
3. **禁止擅自提交 Git**：除非用户明确下达类似 "commit changes" 或 "提交代码" 的指令，否则**绝对禁止**自动执行 git commit 命令。

## 🌿 Git 提交规范
当你被允许进行 Git 提交时，必须严格遵守以下格式：
第一行：`<emoji> <type>: <简要说明>`
如果有复杂修改，从第二行（空一行后）起进行详细说明。

**Type 列表：**
- `feat`: 新功能 (✨)
- `fix`: 修复 Bug (🐛)
- `docs`: 文档修改 (📚)
- `style`: 代码格式化/无逻辑更改 (💎)
- `refactor`: 重构 (♻️)
- `test`: 增加测试 (🚨)
- `chore`: 构建过程或辅助工具变动 (🔧)

**示例：**
✨ feat: 新增 Seedance 接口适配器

- 实现了基于统一策略模式的创建任务接口
- 实现了状态查询接口的字段映射