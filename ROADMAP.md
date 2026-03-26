# 项目开发路线图 (Roadmap)

## 📅 计划中

- [ ] **[P0] 任务轮询调度系统**
    - [ ] 实现后台 Worker 逻辑
        - 使用 `setInterval` 定时（如每隔 5 秒）查询数据库中处于 `running` / `pending` 的任务
    - [ ] 状态同步与更新
        - 调用对应的 Provider 适配器查询最新状态，并回写至 SQLite
    - [ ] 更新任务状态与资源下载
        - 若状态为 `success`，触发对应 provider 的 `downloadVideo` 方法下载到本地 `data/videos/` 目录（根据平台切换data的父目录）
        - 下载成功后，将本地相对路径（如 `/videos/abc.mp4`）写入数据库的 `result_url` 字段
        - 失败则写入 error 状态与重试机制

- [ ] **[P1] 后端 API 接口开发**
    - [ ] 任务创建接口 (`POST /api/tasks`)
        - 接收前端 prompt 和 provider 参数，插入数据库并触发提供商 API
    - [ ] 任务列表接口 (`GET /api/tasks`)
        - 支持按创建时间倒序返回所有任务
    - [ ] 任务详情/重试/删除接口
        - 提供基本的任务管理能力

- [ ] **[P1] 前端交互界面开发**
    - [ ] 构建任务列表视图
        - 轮询请求后端 `GET /api/tasks` 接口，展示任务状态（等待、生成中、成功、失败）
        - 对于成功的任务，提供视频预览与链接复制功能
    - [ ] 构建任务提交表单
        - 提供平台选择（下拉框）和 Prompt 输入框

- [ ] **[P2] 部署与容器化**
    - [ ] 编写 Dockerfile
        - 使用 Node 基础镜像，分阶段构建（先 build 前端，再暴露后端端口运行）
    - [ ] 完善文档
    - 更新 `README.md` 的安装与部署说明

## 🚧 开发中

- [ ] **[P0] 接入 SiliconFlow 视频生成 Provider**
    - [ ] 实现 `createTask` 接口适配
        - 请求 `POST https://api.siliconflow.cn/v1/video/submit`
        - 根据配置的 model (i2v/t2v) 动态组装 prompt 和 image 参数
        - 解析并返回统一的 taskId
        - 文档 `https://docs.siliconflow.cn/cn/api-reference/videos/videos_submit`，实现前请参考
    - [ ] 实现 `getStatus` 接口适配
        - 请求 `POST https://api.siliconflow.cn/v1/video/status`
        - 映射平台状态到统一状态 (`pending` / `running` / `success` / `failed`)
        - 提取成功后的临时视频 URL
        - 文档 `https://docs.siliconflow.cn/cn/api-reference/videos/get_videos_status`，实现前请参考
    - [ ] 实现 `downloadVideo` 接口适配
        - 使用 axios (stream 模式) 或 Node 原生 stream 将临时 URL 下载至本地

## ✅ 已完成

- [x] **[P0] 项目初始化与基础架构**
    - [x] 初始化 Node.js 根项目
        - 生成 `package.json` 并配置基础脚本
        - 安装 concurrently 等开发依赖
    - [x] 初始化 React 前端工程
        - 在 `src/web` 目录下使用 Vite 初始化 React 项目
        - 配置 Vite 构建输出目录到后端的静态资源伺服路径
    - [x] 搭建 Express 基础服务
        - 在 `src/server` 实现基础 HTTP 服务
        - 挂载静态资源中间件以托管前端构建产物

- [x] **[P0] 数据库与核心模型建立**
    - [x] 配置 SQLite 数据库
        - 引入 `better-sqlite3` 并编写数据库连接工具
        - 编写建表脚本（表名：`tasks`）
    - [x] 实现 Task 核心操作方法 (TDD 驱动)
        - 编写数据库操作测试用例
        - 实现 `insertTask`, `getTaskById`, `updateTaskStatus`, `getRunningTasks` 方法

- [x] **[P0] API 适配器策略模式实现**
    - [x] 定义 Provider 基础接口标准
        - 统一 `createTask(params)`
        - 统一 `getStatus(taskId)`
        - 统一 `downloadVideo(videoUrl, targetPath)` （处理流式下载与可能的鉴权）
    - [x] 实现 Mock/测试适配器
        - 编写一个模拟延迟 30 秒生成视频的 Mock 适配器用于开发测试
