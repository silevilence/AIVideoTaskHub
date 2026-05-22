import { useState, useEffect, useCallback } from 'react';
import { fetchMcpStatus, startMcpServer, stopMcpServer } from '../api';
import type { McpStatus } from '../api';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Play, Square, RefreshCw, Server, Wifi, WifiOff, ExternalLink } from 'lucide-react';

export function McpSettingsPanel() {
    const [status, setStatus] = useState<McpStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        try {
            const s = await fetchMcpStatus();
            setStatus(s);
            setError('');
        } catch {
            setError('获取 MCP 状态失败');
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const handleStart = async () => {
        setLoading(true);
        setError('');
        try {
            const s = await startMcpServer();
            setStatus(s);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        setLoading(true);
        setError('');
        try {
            const s = await stopMcpServer();
            setStatus(s);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const isRunning = status?.running === true;
    // MCP 端点与当前页面同源，直接使用相对路径
    const mcpUrl = `${window.location.origin}/mcp`;

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5 text-primary" />
                        MCP 服务
                    </CardTitle>
                    <CardDescription>
                        MCP（模型上下文协议）服务端，对外暴露标准化的工具调用接口，
                        供支持 MCP 的 AI 客户端（如 Claude Desktop、Cursor 等）连接使用。
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    {/* 状态指示 */}
                    <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center gap-2">
                            {isRunning ? (
                                <>
                                    <Wifi className="h-4 w-4 text-emerald-500" />
                                    <span className="text-sm font-medium text-emerald-600">运行中</span>
                                    <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 ml-1">
                                        MCP 端点活跃
                                    </Badge>
                                </>
                            ) : (
                                <>
                                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium text-muted-foreground">已停止</span>
                                </>
                            )}
                        </div>
                        <div className="ml-auto">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={refresh}
                                disabled={loading}
                                className="gap-1"
                            >
                                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                                刷新
                            </Button>
                        </div>
                    </div>

                    {/* 连接信息 */}
                    {isRunning && (
                        <div className="space-y-2 p-3 bg-muted/20 rounded-md">
                            <Label className="text-xs text-muted-foreground">MCP 连接地址</Label>
                            <div className="flex items-center gap-2">
                                <code className="text-sm font-mono bg-muted px-2 py-1 rounded flex-1 break-all">
                                    {mcpUrl}
                                </code>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => window.open(mcpUrl, '_blank')}
                                    className="gap-1 shrink-0"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    打开
                                </Button>
                            </div>
                            {status?.sessionId && (
                                <p className="text-xs text-muted-foreground">
                                    当前会话 ID: {status.sessionId}
                                </p>
                            )}
                        </div>
                    )}

                    {/* 已注册工具列表 */}
                    <div className="space-y-2">
                        <Label className="text-sm font-medium">可用工具</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[
                                { name: 'get_models', desc: '获取所有供应商的模型列表' },
                                { name: 'get_param_spec', desc: '查询供应商/模型的参数规范' },
                                { name: 'submit_task', desc: '提交视频生成任务' },
                                { name: 'query_all_tasks', desc: '批量检索任务列表' },
                                { name: 'query_task_detail', desc: '查询单个任务详情' },
                                { name: 'get_video_asset', desc: '提取已完成任务的视频资产' },
                            ].map((tool) => (
                                <div
                                    key={tool.name}
                                    className="flex items-start gap-2 p-2.5 bg-muted/30 rounded-md"
                                >
                                    <Badge variant="secondary" className="text-xs shrink-0 mt-0.5 font-mono">
                                        {tool.name}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground leading-relaxed">
                                        {tool.desc}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 控制按钮 */}
                    <div className="flex items-center gap-3 pt-2">
                        {!isRunning ? (
                            <Button
                                onClick={handleStart}
                                disabled={loading}
                                size="sm"
                                className="gap-1.5"
                            >
                                <Play className="h-4 w-4" />
                                {loading ? '启动中...' : '启动服务'}
                            </Button>
                        ) : (
                            <Button
                                onClick={handleStop}
                                disabled={loading}
                                variant="destructive"
                                size="sm"
                                className="gap-1.5"
                            >
                                <Square className="h-4 w-4" />
                                {loading ? '停止中...' : '停止服务'}
                            </Button>
                        )}
                    </div>

                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}

                    {/* 使用说明 */}
                    <div className="mt-2 p-3 bg-muted/20 rounded-md">
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            启动后，可在支持 MCP 的客户端中配置以下连接信息来使用本服务：
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                            协议类型：<Badge variant="secondary" className="text-xs align-middle">Streamable HTTP</Badge>
                            &nbsp;端点地址：<code className="text-xs bg-muted px-1 py-0.5 rounded">{mcpUrl}</code>
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
