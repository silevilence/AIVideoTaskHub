/**
 * MCP 工具定义与实现
 * 将系统的核心能力封装为 MCP 标准化工具，供外部 AI 客户端调用。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProviderRegistry } from '../provider-registry.js';
import {
    insertTask,
    getTaskById,
    getAllTasks,
    filterTasks,
    updateTaskStatus,
    type Task,
} from '../task-model.js';
import {
    resolveCreateTaskImages,
} from '../image-utils.js';
import { logger } from '../logger.js';
import * as fs from 'fs';
import * as path from 'path';

// ── 辅助函数 ──────────────────────────────

/** 截断文本到指定长度 */
function truncate(text: string, maxLen = 50): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
}

/** 获取视频文件大小 */
function getVideoFileSize(resultUrl: string): number | null {
    if (!resultUrl || !resultUrl.startsWith('/videos/')) return null;
    try {
        const dataDir = process.env.DATA_DIR || 'data';
        const filePath = path.resolve(dataDir, resultUrl.slice(1));
        return fs.statSync(filePath).size;
    } catch {
        return null;
    }
}

/** 生成任务详情的格式化文本 */
function formatTaskDetail(task: Task): string {
    const lines: string[] = [
        `📋 任务 ID: ${task.id}`,
        `📌 状态: ${task.status}`,
        `🏭 供应商: ${task.provider}`,
        `🧠 模型: ${task.model || '未指定'}`,
        `📝 提示词: ${task.prompt}`,
        `🖼️ 参考图: ${task.image_url || '无'}`,
        `🎬 结果视频: ${task.result_url || '未生成'}`,
        `❌ 错误信息: ${task.error_message || '无'}`,
        `🔄 重试次数: ${task.retry_count}`,
        `⏰ 创建时间: ${task.created_at}`,
        `🕐 更新时间: ${task.updated_at}`,
        `🔗 平台任务 ID: ${task.provider_task_id || '无'}`,
    ];
    return lines.join('\n');
}

// ── 工具注册 ──────────────────────────────

/**
 * 向 McpServer 注册所有业务工具。
 * @param server MCP Server 实例
 * @param registry Provider 注册中心
 */
export function registerAllTools(
    server: McpServer,
    registry: ProviderRegistry,
): void {
    // ── 1. 获取模型列表 ─────────────────────
    server.registerTool(
        'get_models',
        {
            title: '获取模型列表',
            description:
                '聚合查询所有供应商当前支持的可用模型矩阵。' +
                '返回各 Provider 的模型 ID、显示名称及能力声明（如图生视频、分辨率、时长等）。',
            inputSchema: {
                provider: z
                    .string()
                    .optional()
                    .describe('可选，指定供应商名称筛选。不传则返回全部供应商的模型。'),
            },
        },
        async ({ provider }) => {
            const names = provider
                ? registry.listNames().filter((n) => n === provider)
                : registry.listNames();

            if (names.length === 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: provider
                                ? `未找到供应商 "${provider}"`
                                : '当前没有注册任何供应商',
                        },
                    ],
                };
            }

            const result: Record<string, unknown> = {};
            for (const name of names) {
                const p = registry.get(name);
                if (!p) continue;
                result[name] = {
                    displayName: p.displayName,
                    models: p.getModelsInfo(),
                };
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        },
    );

    // ── 2. 获取参数规范 ─────────────────────
    server.registerTool(
        'get_param_spec',
        {
            title: '获取参数规范',
            description:
                '查询指定供应商及模型对应的前置入参约束与配置协议。' +
                '返回模型的完整能力声明，包括支持的功能、分辨率选项、时长范围等。',
            inputSchema: {
                provider: z
                    .string()
                    .describe('供应商名称，如 siliconflow、volcengine、aihubmix'),
                model: z.string().optional().describe('模型 ID，不传则返回该供应商全部模型的参数规范'),
            },
        },
        async ({ provider, model }) => {
            const p = registry.get(provider);
            if (!p) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `供应商 "${provider}" 不存在。可用: ${registry.listNames().join(', ')}`,
                        },
                    ],
                    isError: true,
                };
            }

            const allModels = p.getModelsInfo();
            const models = model
                ? allModels.filter((m) => m.id === model)
                : allModels;

            if (model && models.length === 0) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `模型 "${model}" 在供应商 "${provider}" 中不存在。` +
                                `可用模型: ${allModels.map((m) => m.id).join(', ')}`,
                        },
                    ],
                    isError: true,
                };
            }

            const settingsSchema = p.getSettingsSchema();
            const result = {
                provider,
                displayName: p.displayName,
                requiredSettings: settingsSchema
                    .filter((s) => s.required)
                    .map((s) => ({ key: s.key, label: s.label, description: s.description })),
                models: models.map((m) => ({
                    id: m.id,
                    displayName: m.displayName,
                    capabilities: m.capabilities || null,
                    disabled: m.disabled || false,
                    disabledReason: m.disabledReason || null,
                    parameterSchema: m.parameterSchema || null,
                })),
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        },
    );

    // ── 3. 提交生成任务 ─────────────────────
    server.registerTool(
        'submit_task',
        {
            title: '提交生成任务',
            description:
                '基于 Prompt、参考图像（支持 URL 与 Base64）、供应商 ID、模型 ID ' +
                '及动态参数集触发异步生成作业，并返回全局唯一任务 ID。',
            inputSchema: {
                provider: z
                    .string()
                    .describe('供应商名称，如 siliconflow、volcengine、aihubmix'),
                prompt: z.string().describe('视频生成的提示词描述'),
                model: z.string().optional().describe('模型 ID，不传则使用供应商默认模型'),
                image_url: z
                    .string()
                    .optional()
                    .describe('参考图片 URL 或 Base64 数据（图生视频时需要）'),
                params: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe('额外参数（JSON 对象），如 duration、resolution、ratio 等，需与入参规范匹配'),
            },
        },
        async ({ provider, prompt, model, image_url, params }) => {
            const p = registry.get(provider);
            if (!p) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `供应商 "${provider}" 不存在。可用: ${registry.listNames().join(', ')}`,
                        },
                    ],
                    isError: true,
                };
            }

            // 将本地 /uploads/ 路径转换为 base64，确保外部 API 可访问
            const { resolvedImageUrl, resolvedExtra } = resolveCreateTaskImages(
                image_url || undefined,
                params as Record<string, unknown> | undefined,
            );

            try {
                const task = insertTask({
                    provider,
                    prompt,
                    model,
                    imageUrl: image_url,
                    extraParams: resolvedExtra,
                });

                const result = await p.createTask({
                    prompt,
                    model,
                    imageUrl: resolvedImageUrl,
                    extra: resolvedExtra,
                });

                updateTaskStatus(task.id, 'pending', {
                    providerTaskId: result.providerTaskId,
                });

                const created = getTaskById(task.id)!;
                logger.taskCreated(task.id, provider, model || 'default');

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `✅ 任务创建成功\n任务 ID: ${created.id}\n平台任务 ID: ${result.providerTaskId}\n状态: ${created.status}`,
                        },
                    ],
                };
            } catch (err) {
                const msg = (err as Error).message;
                logger.error(`MCP 提交任务失败: ${msg}`);
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `❌ 创建任务失败: ${msg}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    // ── 4. 查询任务大盘 ─────────────────────
    server.registerTool(
        'query_all_tasks',
        {
            title: '查询任务大盘',
            description:
                '批量检索全局任务列表，返回核心字段涵盖任务 ID、实时运行状态、' +
                '承载模型及 Prompt 摘要（前 50 字符截断）。支持按供应商和状态筛选。',
            inputSchema: {
                providers: z
                    .string()
                    .optional()
                    .describe('供应商名称，多个用逗号分隔'),
                statuses: z
                    .string()
                    .optional()
                    .describe('任务状态，多个用逗号分隔。可选: pending, running, success, failed'),
                prompt_keyword: z
                    .string()
                    .optional()
                    .describe('按提示词关键字搜索（模糊匹配）'),
            },
        },
        async ({ providers, statuses, prompt_keyword }) => {
            const providerList = providers
                ? providers.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined;
            const statusList = statuses
                ? statuses.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined;

            const tasks = filterTasks({
                providers: providerList,
                statuses: statusList,
                prompt: prompt_keyword || undefined,
            });

            const summary = tasks.map((t) => ({
                id: t.id,
                provider: t.provider,
                status: t.status,
                model: t.model,
                prompt_summary: truncate(t.prompt, 50),
                created_at: t.created_at,
                updated_at: t.updated_at,
                has_video: !!t.result_url,
                has_error: !!t.error_message,
            }));

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(
                            {
                                total: summary.length,
                                tasks: summary,
                            },
                            null,
                            2,
                        ),
                    },
                ],
            };
        },
    );

    // ── 5. 查询任务详情 ─────────────────────
    server.registerTool(
        'query_task_detail',
        {
            title: '查询任务详情',
            description:
                '基于目标任务 ID 进行精确穿透，获取该任务的完整生命周期节点状态及全量入参快照。',
            inputSchema: {
                task_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('任务 ID（数字）'),
            },
        },
        async ({ task_id }) => {
            const task = getTaskById(task_id);
            if (!task) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `任务 ID ${task_id} 不存在或已被删除。`,
                        },
                    ],
                    isError: true,
                };
            }

            // 解析 extra_params
            let extraParams: unknown = null;
            if (task.extra_params) {
                try {
                    extraParams = JSON.parse(task.extra_params);
                } catch {
                    extraParams = task.extra_params;
                }
            }

            const detail = {
                ...task,
                extra_params: extraParams,
                video_file_size: getVideoFileSize(task.result_url || ''),
            };

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: formatTaskDetail(task) +
                            '\n\n📦 完整 JSON:\n' +
                            JSON.stringify(detail, null, 2),
                    },
                ],
            };
        },
    );

    // ── 6. 提取视频资产 ─────────────────────
    server.registerTool(
        'get_video_asset',
        {
            title: '提取视频资产',
            description:
                '基于任务 ID 换取最终视频产物的下载链接。' +
                '内置状态屏障：仅当任务状态为 "success" 且视频资产就绪时返回有效 URL，' +
                '否则返回错误说明。',
            inputSchema: {
                task_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('任务 ID（数字）'),
            },
        },
        async ({ task_id }) => {
            const task = getTaskById(task_id);
            if (!task) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `任务 ID ${task_id} 不存在或已被删除。`,
                        },
                    ],
                    isError: true,
                };
            }

            if (task.status !== 'success') {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `⛔ 任务尚未完成\n当前状态: ${task.status}${task.error_message ? `\n错误信息: ${task.error_message}` : ''}\n请在任务成功后再获取视频资产。`,
                        },
                    ],
                    isError: true,
                };
            }

            if (!task.result_url) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `⛔ 视频资产未就绪\n任务 ${task_id} 状态为 "success" 但未找到视频文件路径。可能是下载过程异常。`,
                        },
                    ],
                    isError: true,
                };
            }

            const dataDir = process.env.DATA_DIR || 'data';
            const filePath = path.resolve(dataDir, task.result_url.slice(1));
            const exists = fs.existsSync(filePath);
            const fileSize = exists ? fs.statSync(filePath).size : 0;

            // 构建完整的下载 URL
            const host = process.env.MCP_PUBLIC_HOST || 'http://localhost:' + (process.env.PORT || 3000);
            const downloadUrl = `${host.replace(/\/+$/, '')}${task.result_url}`;

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: [
                            `✅ 视频资产就绪`,
                            `任务 ID: ${task.id}`,
                            `文件路径: ${task.result_url}`,
                            `下载 URL: ${downloadUrl}`,
                            `文件大小: ${exists ? (fileSize / 1024 / 1024).toFixed(2) + ' MB' : '文件不存在'}`,
                            `模型: ${task.model || '未指定'}`,
                            `供应商: ${task.provider}`,
                        ].join('\n'),
                    },
                ],
            };
        },
    );

    logger.info('MCP 工具注册完成: 6 个工具已就绪');
}
