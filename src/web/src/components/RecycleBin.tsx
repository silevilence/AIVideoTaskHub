import { useState, useEffect, useCallback } from 'react';
import type { TrashTask, ProviderInfo } from '../api';
import { fetchTrashTasks, fetchProviders, fetchProviderModels, purgeTask } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { ConfirmDialog, AlertDialog } from './ui/dialog';
import { cn } from '../lib/utils';
import {
    Clock,
    Loader2,
    CheckCircle2,
    XCircle,
    Trash2,
    Download,
    Play,
    X,
    Copy,
    AlertTriangle,
    VideoOff,
    Info,
    HardDrive,
} from 'lucide-react';

type BadgeVariant = 'warning' | 'default' | 'success' | 'destructive';

const STATUS_CONFIG: Record<
    string,
    { label: string; variant: BadgeVariant; icon: typeof Clock }
> = {
    pending: { label: '等待中', variant: 'warning', icon: Clock },
    running: { label: '生成中', variant: 'default', icon: Loader2 },
    success: { label: '已完成', variant: 'success', icon: CheckCircle2 },
    failed: { label: '失败', variant: 'destructive', icon: XCircle },
};

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function getDaysAgo(dateStr: string): number {
    const deleted = new Date(dateStr + 'Z');
    const now = new Date();
    return Math.floor((now.getTime() - deleted.getTime()) / (1000 * 60 * 60 * 24));
}

// ── 参数显示名映射 ──────────────────────────
const PARAM_LABELS: Record<string, string> = {
    ratio: '宽高比',
    resolution: '分辨率',
    duration: '时长(秒)',
    seed: '种子',
    watermark: '水印',
    generateAudio: '生成音频',
    cameraFixed: '固定镜头',
    returnLastFrame: '返回尾帧',
    serviceTier: '服务等级',
    draft: '样片模式',
    lastFrameImageUrl: '尾帧图片',
    referenceImageUrls: '参考图片',
};

function formatParamValue(key: string, value: unknown): string {
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (key === 'duration' && value === -1) return '自动';
    if (key === 'seed' && value === -1) return '随机';
    if (key === 'serviceTier') return value === 'flex' ? '离线推理' : '在线推理';
    if (Array.isArray(value)) return value.length + ' 张';
    if (typeof value === 'string' && value.startsWith('data:')) return '(本地上传)';
    return String(value);
}

export function RecycleBin() {
    const [tasks, setTasks] = useState<TrashTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [modelDisplayNames, setModelDisplayNames] = useState<Record<string, string>>({});
    const [previewTask, setPreviewTask] = useState<TrashTask | null>(null);
    const [paramsTask, setParamsTask] = useState<TrashTask | null>(null);
    const [purgeStep, setPurgeStep] = useState<'idle' | 'confirm1' | 'confirm2'>('idle');
    const [purgeTarget, setPurgeTarget] = useState<TrashTask | null>(null);
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    const loadTasks = useCallback(async () => {
        try {
            const data = await fetchTrashTasks();
            setTasks(data);
        } catch {
            console.error('加载回收站任务列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProviders().then((p) => setProviders(p)).catch(() => {});
        fetchProviderModels().then((data) => {
            const names: Record<string, string> = {};
            for (const models of Object.values(data)) {
                for (const m of models) {
                    names[m.id] = m.displayName;
                }
            }
            setModelDisplayNames(names);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        loadTasks();
    }, [loadTasks]);

    const providerDisplayName = useCallback((name: string) => {
        const info = providers.find(p => p.name === name);
        return info?.displayName ?? name;
    }, [providers]);

    const handlePurgeRequest = (task: TrashTask) => {
        const daysAgo = getDaysAgo(task.deleted_at!);
        if (daysAgo < 30) {
            setAlertMessage(`该任务删除仅 ${daysAgo} 天，需满 30 天才能彻底删除。`);
            return;
        }
        setPurgeTarget(task);
        setPurgeStep('confirm1');
    };

    const handlePurgeConfirm1 = () => {
        setPurgeStep('confirm2');
    };

    const handlePurgeConfirm2 = async () => {
        if (!purgeTarget) return;
        const id = purgeTarget.id;
        setPurgeStep('idle');
        setPurgeTarget(null);
        try {
            await purgeTask(id);
            await loadTasks();
        } catch (err) {
            setAlertMessage((err as Error).message);
        }
    };

    const handlePurgeCancel = () => {
        setPurgeStep('idle');
        setPurgeTarget(null);
    };

    const totalFileSize = tasks.reduce((sum, t) => sum + t.file_size, 0);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-3" />
                <p className="text-sm">加载中...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-heading font-bold tracking-wide">
                        回收站
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        共 {tasks.length} 个已删除任务
                        {totalFileSize > 0 && (
                            <span className="ml-2 inline-flex items-center gap-1">
                                <HardDrive className="h-3 w-3" />
                                占用 {formatFileSize(totalFileSize)}
                            </span>
                        )}
                    </p>
                </div>
            </div>

            {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Trash2 className="h-12 w-12 mb-4 opacity-40" />
                    <p className="text-lg font-medium">回收站为空</p>
                    <p className="text-sm mt-1">删除的任务会在这里显示</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tasks.map((task) => (
                        <TrashTaskCard
                            key={task.id}
                            task={task}
                            onPurge={handlePurgeRequest}
                            onPreview={setPreviewTask}
                            onShowParams={setParamsTask}
                            providerDisplayName={providerDisplayName}
                            modelDisplayNames={modelDisplayNames}
                        />
                    ))}
                </div>
            )}

            {/* 视频预览覆盖层 */}
            {previewTask && previewTask.result_url && (
                <VideoPreviewOverlay
                    task={previewTask}
                    onClose={() => setPreviewTask(null)}
                    providerDisplayName={providerDisplayName}
                    modelDisplayNames={modelDisplayNames}
                />
            )}

            {/* 任务参数弹窗 */}
            {paramsTask && (
                <TrashParamsModal
                    task={paramsTask}
                    onClose={() => setParamsTask(null)}
                    providerDisplayName={providerDisplayName}
                    modelDisplayNames={modelDisplayNames}
                />
            )}

            {/* 彻底删除第一步确认 */}
            <ConfirmDialog
                open={purgeStep === 'confirm1'}
                title="彻底删除任务"
                description="确定要彻底删除此任务吗？此操作不可撤销，相关媒体文件将从磁盘上永久删除。"
                confirmText="继续"
                cancelText="取消"
                variant="destructive"
                onConfirm={handlePurgeConfirm1}
                onCancel={handlePurgeCancel}
            />

            {/* 彻底删除第二步确认 */}
            <ConfirmDialog
                open={purgeStep === 'confirm2'}
                title="再次确认"
                description="彻底删除后任务将无法恢复，所有关联的视频和图片文件都会被永久删除。确定继续？"
                confirmText="确定删除"
                cancelText="取消"
                variant="destructive"
                onConfirm={handlePurgeConfirm2}
                onCancel={handlePurgeCancel}
            />

            {/* 提示对话框 */}
            <AlertDialog
                open={alertMessage !== null}
                title="操作失败"
                description={alertMessage ?? ''}
                variant="destructive"
                onClose={() => setAlertMessage(null)}
            />
        </div>
    );
}

function TrashTaskCard({
    task,
    onPurge,
    onPreview,
    onShowParams,
    providerDisplayName,
    modelDisplayNames,
}: {
    task: TrashTask;
    onPurge: (task: TrashTask) => void;
    onPreview: (task: TrashTask) => void;
    onShowParams: (task: TrashTask) => void;
    providerDisplayName: (name: string) => string;
    modelDisplayNames: Record<string, string>;
}) {
    const config = STATUS_CONFIG[task.status] ?? {
        label: task.status,
        variant: 'secondary' as BadgeVariant,
        icon: Clock,
    };
    const StatusIcon = config.icon;
    const daysAgo = getDaysAgo(task.deleted_at!);
    const canPurge = daysAgo >= 30;

    return (
        <Card className={cn('transition-shadow duration-200 hover:shadow-md', canPurge && 'border-destructive/30')}>
            <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={config.variant}>
                                <StatusIcon
                                    className={`h-3 w-3 mr-1 ${task.status === 'running' ? 'animate-spin' : ''}`}
                                />
                                {config.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                                {providerDisplayName(task.provider)}
                                {task.model ? ` · ${modelDisplayNames[task.model] ?? task.model}` : ''}
                            </span>
                            <span className="text-xs text-muted-foreground/50">
                                #{task.id}
                            </span>
                        </div>
                        <p className="text-sm leading-relaxed wrap-break-word">
                            {task.prompt}
                        </p>
                        {task.error_message && (
                            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3">
                                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                <p className="text-xs text-destructive wrap-break-word">
                                    {task.error_message}
                                </p>
                            </div>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>
                                删除于 {new Date(task.deleted_at! + 'Z').toLocaleString()}
                                （{daysAgo} 天前）
                            </span>
                            {task.file_size > 0 && (
                                <span className="inline-flex items-center gap-1">
                                    <HardDrive className="h-3 w-3" />
                                    {formatFileSize(task.file_size)}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {task.status === 'success' && task.result_url && (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onPreview(task)}
                                >
                                    <Play className="h-3.5 w-3.5 mr-1" />
                                    预览
                                </Button>
                                <a href={task.result_url} download>
                                    <Button variant="outline" size="sm">
                                        <Download className="h-3.5 w-3.5 mr-1" />
                                        下载
                                    </Button>
                                </a>
                            </>
                        )}
                        {canPurge && (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => onPurge(task)}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                彻底删除
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onShowParams(task)}
                            className="text-muted-foreground"
                            title="查看任务参数"
                        >
                            <Info className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function TrashParamsModal({
    task,
    onClose,
    providerDisplayName,
    modelDisplayNames,
}: {
    task: TrashTask;
    onClose: () => void;
    providerDisplayName: (name: string) => string;
    modelDisplayNames: Record<string, string>;
}) {
    const params: Record<string, unknown> = (() => {
        try {
            return task.extra_params ? JSON.parse(task.extra_params) : {};
        } catch {
            return {};
        }
    })();

    const entries = Object.entries(params);
    const daysAgo = getDaysAgo(task.deleted_at!);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-md mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-auto max-h-[80vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                            #{task.id} · {providerDisplayName(task.provider)}
                            {task.model ? ` · ${modelDisplayNames[task.model] ?? task.model}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">任务参数详情（已删除）</p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="shrink-0 ml-3"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* 基础信息 */}
                <div className="px-5 pt-4 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">平台</span>
                        <span className="font-medium">{providerDisplayName(task.provider)}</span>
                    </div>
                    {task.model && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">模型</span>
                            <span className="font-medium">{modelDisplayNames[task.model] ?? task.model}</span>
                        </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">状态</span>
                        <span className="font-medium">{STATUS_CONFIG[task.status]?.label ?? task.status}</span>
                    </div>
                    {task.image_url && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">首帧图片</span>
                            <span className="font-medium">{task.image_url.startsWith('data:') ? '(本地上传)' : '(URL)'}</span>
                        </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">创建时间</span>
                        <span className="font-medium">{new Date(task.created_at + 'Z').toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">删除时间</span>
                        <span className="font-medium">
                            {new Date(task.deleted_at! + 'Z').toLocaleString()}（{daysAgo} 天前）
                        </span>
                    </div>
                    {task.file_size > 0 && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">文件占用</span>
                            <span className="font-medium">{formatFileSize(task.file_size)}</span>
                        </div>
                    )}
                    {task.provider_task_id && (
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">平台任务ID</span>
                            <span className="font-medium text-xs font-mono truncate max-w-50" title={task.provider_task_id}>
                                {task.provider_task_id}
                            </span>
                        </div>
                    )}
                </div>

                {/* 额外参数 */}
                {entries.length > 0 && (
                    <div className="px-5 pt-3 space-y-2">
                        <p className="text-xs text-muted-foreground font-medium">生成参数</p>
                        {entries.map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">
                                    {PARAM_LABELS[key] ?? key}
                                </span>
                                <span className="font-medium">
                                    {formatParamValue(key, value)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Prompt */}
                <div className="px-5 py-4 border-t border-border mt-3">
                    <p className="text-xs text-muted-foreground mb-1">Prompt</p>
                    <p className="text-sm leading-relaxed">{task.prompt}</p>
                </div>

                {/* 错误信息 */}
                {task.error_message && (
                    <div className="px-5 pb-4">
                        <p className="text-xs text-muted-foreground mb-1">错误信息</p>
                        <p className="text-sm text-destructive">{task.error_message}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function VideoPreviewOverlay({
    task,
    onClose,
    providerDisplayName,
    modelDisplayNames,
}: {
    task: TrashTask;
    onClose: () => void;
    providerDisplayName: (name: string) => string;
    modelDisplayNames: Record<string, string>;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopyLink = () => {
        navigator.clipboard.writeText(
            window.location.origin + task.result_url,
        );
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-4xl max-h-[90vh] mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                            #{task.id} · {providerDisplayName(task.provider)}
                            {task.model ? ` · ${modelDisplayNames[task.model] ?? task.model}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {task.prompt}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        className="shrink-0 ml-3"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* Video */}
                <div className="p-5">
                    <video
                        src={task.result_url!}
                        controls
                        autoPlay
                        className="w-full max-h-[70vh] rounded-lg object-contain"
                    />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 px-5 pb-4">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyLink}
                    >
                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                        {copied ? '已复制' : '复制链接'}
                    </Button>
                    <a href={task.result_url!} download>
                        <Button variant="outline" size="sm">
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            下载视频
                        </Button>
                    </a>
                </div>
            </div>
        </div>
    );
}
