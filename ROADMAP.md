# 项目开发路线图 (Roadmap)

## 📅 计划中

## 🚧 开发中

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

- [x] **[P0] 接入 SiliconFlow 视频生成 Provider**
    - [x] 实现 `createTask` 接口适配
        - 请求 `POST https://api.siliconflow.cn/v1/video/submit`
        - 根据配置的 model (i2v/t2v) 动态组装 prompt 和 image 参数
        - 解析并返回统一的 taskId
        - 文档 `https://docs.siliconflow.cn/cn/api-reference/videos/videos_submit`，实现前请参考
    - [x] 实现 `getStatus` 接口适配
        - 请求 `POST https://api.siliconflow.cn/v1/video/status`
        - 映射平台状态到统一状态 (`pending` / `running` / `success` / `failed`)
        - 提取成功后的临时视频 URL
        - 文档 `https://docs.siliconflow.cn/cn/api-reference/videos/get_videos_status`，实现前请参考
    - [x] 实现 `downloadVideo` 接口适配
        - 使用 axios (stream 模式) 或 Node 原生 stream 将临时 URL 下载至本地

- [x] **[P0] 任务轮询调度系统**
    - [x] 实现后台 Worker 逻辑
        - 使用 `setInterval` 定时（如每隔 5 秒）查询数据库中处于 `running` / `pending` 的任务
    - [x] 状态同步与更新
        - 调用对应的 Provider 适配器查询最新状态，并回写至 SQLite
    - [x] 更新任务状态与资源下载
        - 若状态为 `success`，触发对应 provider 的 `downloadVideo` 方法下载到本地 `data/videos/` 目录（根据平台切换data的父目录）
        - 下载成功后，将本地相对路径（如 `/videos/abc.mp4`）写入数据库的 `result_url` 字段
        - 失败则写入 error 状态与重试机制

- [x] **[P1] 后端 API 接口开发**
    - [x] 任务创建接口 (`POST /api/tasks`)
        - 接收前端 prompt 和 provider 参数，插入数据库并触发提供商 API
    - [x] 任务列表接口 (`GET /api/tasks`)
        - 支持按创建时间倒序返回所有任务
    - [x] 任务详情/重试/删除接口
        - 提供基本的任务管理能力

- [x] **[P1] 前端交互界面开发**
    - [x] 构建任务列表视图
        - 轮询请求后端 `GET /api/tasks` 接口，展示任务状态（等待、生成中、成功、失败）
        - 对于成功的任务，提供视频预览与链接复制功能
    - [x] 构建任务提交表单
        - 提供平台选择（下拉框）和 Prompt 输入框

- [x] **[P1] 前端界面美化**
    - [x] 分为三个界面：设置、提交视频生成任务、查看任务状态
    - [x] 界面要有科技感，有日间和夜间模式，默认跟随系统
    - [x] 使用shadcn/ui重构界面
    - [x] 设置界面的设置要在本地保存下来（后端保存数据库）
    - [x] 任务状态界面，列出所有任务的状态，已完成的可以预览和下载视频，视频下载到本地失败的要提示原因（查看任务异常）
    - [x] 提交任务页，不需要加载mock provider

- [x] **[P2] 部署与容器化**
    - [x] 编写 Dockerfile
        - 使用 Node 基础镜像，分阶段构建
    - [x] Compose 配置文件
        - 映射前端端口
        - 数据保存目录（包括数据库目录和视频保存目录）通过volumns映射出来
    - [x] 完善文档
    - 更新 `README.md` 的安装与部署说明

- [x] **[P2]接入火山引擎 Seedance**
    - [x] 创建任务
        - [x] 根据不同模型支持不同的视频生成能力
            - [x] 文生视频
            - [x] 图生视频-首尾帧
            - [x] 图生视频-首帧
            - [x] 图生视频-参考图
        - [x] 支持创建任务时输入不同的参数
            - `model`：用户选择
            - `content`：暂不需要支持样片参考功能
            - `callback_url`, `service_tier`, `execution_expires_after`, `draft`, `frames`, `camera_fixed`：不需要支持
            - `return_last_frame`：用户选择开关
            - `generate_audio`：使用 Seedance 1.5 pro时，用户选择开关
            - `resolution`：用户选择枚举，枚举值定义及默认值见文档
            - `ratio`：用户选择枚举，枚举值定义及默认值见文档
            - `duration`：2~12，默认5,int
            - `seed`：[-1, 2^32-1]之间的整数，默认-1
            - `watermark`：用户选择开关
        - [x] 参考文档
            - 官方文档参考：`https://www.volcengine.com/docs/82379/1520757?lang=zh`
            - 本地缓存：`refs/volce/create-task.md`
        - [x] 界面修改
            - 任务状态查询界面，每个任务加上查看详细参数按钮，点击在弹窗中显示详细参数
    - [x] 查询状态
        - [x] 查询任务状态
        - [x] 完成后下载视频
        - [x] 尾帧图暂不下载
        - [x] 参考文档
            - 官方文档参考：`https://www.volcengine.com/docs/82379/1521309?lang=zh`
            - 本地缓存：`refs/volce/task-status.md`
    - [x] 支持模型
        - [x] Seedance 1.5 pro
            - id: `doubao-seedance-1-5-pro-251215`
            - 支持能力：图生视频-首尾帧、图生视频-首帧、文生视频
        - [x] Seedance 1.0 pro
            - id: `doubao-seedance-1-0-pro-250528`
            - 支持能力：图生视频-首尾帧、图生视频-首帧、文生视频
        - [x] Seedance 1.0 pro fast
            - id: `doubao-seedance-1-0-pro-fast-251015`
            - 支持能力：图生视频-首帧、文生视频
        - [x] Seedance 1.0 lite
            - 文生视频
                - id: `doubao-seedance-1-0-lite-t2v-250428`
                - 支持能力：文生视频
            - 图生视频
                - id: `doubao-seedance-1-0-lite-i2v-250428`
                - 支持能力：图生视频-参考图、图生视频-首尾帧、图生视频-首帧
