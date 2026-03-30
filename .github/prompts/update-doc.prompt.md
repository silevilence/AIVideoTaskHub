---
description: "更新项目文档使其与当前代码实际状态保持同步。Use when: 代码架构变更后需要同步文档、新增 Provider 后更新文档、版本发布前文档审查。"
agent: "agent"
argument-hint: "可选：指定要更新的文档文件名，如 README.md、copilot-instructions.md，不指定则更新全部"
---

# 更新项目文档

根据当前代码库的实际状态，更新项目文档使其保持同步。

## 目标文档及侧重点

- **README.md**：面向用户，侧重项目功能介绍、已接入平台、部署方式（Docker Compose / Docker）、环境变量、数据持久化说明
- **copilot-instructions.md**：面向 AI 开发者，侧重技术架构、目录结构、Provider 系统、API 端点、数据库 Schema、命名规范、测试规范、开发流程

## 执行步骤

1. **收集当前项目状态**：
  - 读取 `package.json` 获取版本号、依赖包及版本
  - 扫描 `src/server/providers/` 获取已实现的 Provider 列表
  - 读取 `src/server/provider.ts` 确认接口定义和模型能力声明
  - 读取 `src/server/task-router.ts` 确认 API 端点
  - 读取 `src/server/task-model.ts` 确认数据库表结构
  - 读取 `src/server/database.ts` 确认数据库迁移
  - 扫描 `src/web/src/components/` 确认前端功能模块
  - 读取 `docker-compose.yml` 和 `Dockerfile` 确认部署方式
  - 读取 `ROADMAP.md` 了解功能完成状态和计划中的功能
  - 读取 `changelog.md` 了解最新版本变更

2. **对比现有文档与实际状态**，识别过时或缺失的内容

3. **更新文档**，确保：
  - 版本号、技术栈版本与 `package.json` 一致
  - 已接入平台及模型列表与 Provider 实现一致
  - API 端点与路由定义一致
  - 目录结构与实际文件树一致
  - 部署方式与 Docker 配置一致

## 参考

- 项目指导文件：[copilot-instructions.md](../copilot-instructions.md)
- 变更日志：[changelog.md](../../changelog.md)
- 路线图：[ROADMAP.md](../../ROADMAP.md)
