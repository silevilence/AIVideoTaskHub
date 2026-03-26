import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Task, TaskFilter, ProviderInfo } from '../api';
import { fetchTasks, fetchProviders, retryTask, deleteTask } from '../api';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from '../lib/utils';
import {
    Clock,
    Loader2,
    CheckCircle2,
    XCircle,
    RotateCw,
    Trash2,
    Download,
    Copy,
    AlertTriangle,
    VideoOff,
    Play,
    X,
    Search,
    Filter,
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

const ALL_STATUSES = ['pending', 'running', 'success', 'failed'];

export function TaskList({ refreshKey }: { refreshKey: number }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [previewTask, setPreviewTask] = useState<Task | null>(null);

    // Filter state
    const [filterOpen, setFilterOpen] = useState(false);
    const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
    const [selectedStatuses, setSelectedStatuses] = useState<string[]>([...ALL_STATUSES]);
    const [promptSearch, setPromptSearch] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const activeFilter = useMemo<TaskFilter | undefined>(() => {
        const realCount = providers.filter(p => p.name !== 'mock').length;
        const hasProviderFilter = selectedProviders.length > 0 && selectedProviders.length < realCount;
        const hasStatusFilter = selectedStatuses.length > 0 && selectedStatuses.length < ALL_STATUSES.length;
        const hasPrompt = promptSearch.trim().length > 0;
        const hasStart = startDate.length > 0;
        const hasEnd = endDate.length > 0;

        if (!hasProviderFilter && !hasStatusFilter && !hasPrompt && !hasStart && !hasEnd) return undefined;

        return {
            providers: hasProviderFilter ? selectedProviders : undefined,
            statuses: hasStatusFilter ? selectedStatuses : undefined,
            prompt: hasPrompt ? promptSearch.trim() : undefined,
            startDate: hasStart ? startDate : undefined,
            endDate: hasEnd ? endDate : undefined,
        };
    }, [selectedProviders, selectedStatuses, promptSearch, startDate, endDate, providers]);

    const loadTasks = useCallback(async (filter?: TaskFilter) => {
        try {
            const data = await fetchTasks(filter);
            setTasks(data);
        } catch {
            console.error('加载任务列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProviders().then((p) => setProviders(p)).catch(() => {});
    }, []);

    useEffect(() => {
        loadTasks(activeFilter);
        const timer = setInterval(() => loadTasks(activeFilter), 5000);
        return () => clearInterval(timer);
    }, [loadTasks, activeFilter]);

    useEffect(() => {
        if (refreshKey > 0) loadTasks(activeFilter);
    }, [refreshKey, loadTasks, activeFilter]);

    const handleRetry = async (id: number) => {
        try {
            await retryTask(id);
            await loadTasks(activeFilter);
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('确定删除此任务？')) return;
        try {
            await deleteTask(id);
            await loadTasks(activeFilter);
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const handleReset = useCallback(() => {
        setSelectedProviders([]);
        setSelectedStatuses([...ALL_STATUSES]);
        setPromptSearch('');
        setStartDate('');
        setEndDate('');
        // Force immediate refetch without filter
        loadTasks(undefined);
    }, [loadTasks]);

    const toggleStatus = (s: string) => {
        setSelectedStatuses((prev) =>
            prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
        );
    };

    const toggleProvider = (p: string) => {
        setSelectedProviders((prev) =>
            prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
        );
    };

    const realProviders = providers.filter(p => p.name !== 'mock');

    const providerDisplayName = useCallback((name: string) => {
        const info = providers.find(p => p.name === name);
        return info?.displayName ?? name;
    }, [providers]);

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
                        任务状态
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        共 {tasks.length} 个任务
                    </p>
                </div>
                <Button
                    variant={filterOpen ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setFilterOpen(!filterOpen)}
                >
                    <Filter className="h-4 w-4 mr-1.5" />
                    筛选
                </Button>
            </div>

            {/* 筛选面板 */}
            {filterOpen && (
                <Card>
                    <CardContent className="pt-5 space-y-4">
                        {/* 提示词搜索 */}
                        <div className="space-y-1.5">
                            <Label>提示词搜索</Label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    value={promptSearch}
                                    onChange={(e) => setPromptSearch(e.target.value)}
                                    placeholder="模糊搜索提示词..."
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        {/* 状态筛选 */}
                        <div className="space-y-1.5">
                            <Label>任务状态</Label>
                            <div className="flex flex-wrap gap-2">
                                {ALL_STATUSES.map((s) => {
                                    const cfg = STATUS_CONFIG[s];
                                    const active = selectedStatuses.includes(s);
                                    return (
                                        <button
                                            key={s}
                                            onClick={() => toggleStatus(s)}
                                            className={cn(
                                                'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
                                                active
                                                    ? 'bg-primary/15 text-primary border-primary/30'
                                                    : 'bg-muted text-muted-foreground border-transparent opacity-50',
                                            )}
                                        >
                                            {cfg.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Provider 筛选 */}
                        {realProviders.length > 1 && (
                            <div className="space-y-1.5">
                                <Label>平台</Label>
                                <div className="flex flex-wrap gap-2">
                                    {realProviders.map((p) => {
                                        const active = selectedProviders.length === 0 || selectedProviders.includes(p.name);
                                        return (
                                            <button
                                                key={p.name}
                                                onClick={() => toggleProvider(p.name)}
                                                className={cn(
                                                    'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
                                                    active
                                                        ? 'bg-primary/15 text-primary border-primary/30'
                                                        : 'bg-muted text-muted-foreground border-transparent opacity-50',
                                                )}
                                            >
                                                {p.displayName}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 时间范围 */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label>开始时间</Label>
                                <Input
                                    type="datetime-local"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>结束时间</Label>
                                <Input
                                    type="datetime-local"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                />
                            </div>
                        </div>

                        <Button
                            variant="ghost"
                            size="sm"
                            type="button"
                            onClick={handleReset}
                        >
                            重置筛选
                        </Button>
                    </CardContent>
                </Card>
            )}

            {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <VideoOff className="h-12 w-12 mb-4 opacity-40" />
                    <p className="text-lg font-medium">暂无任务</p>
                    <p className="text-sm mt-1">
                        {activeFilter ? '没有匹配筛选条件的任务' : '创建一个视频生成任务试试吧'}
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tasks.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onRetry={handleRetry}
                            onDelete={handleDelete}
                            onPreview={setPreviewTask}
                            providerDisplayName={providerDisplayName}
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
                />
            )}
        </div>
    );
}

function TaskCard({
    task,
    onRetry,
    onDelete,
    onPreview,
    providerDisplayName,
}: {
    task: Task;
    onRetry: (id: number) => void;
    onDelete: (id: number) => void;
    onPreview: (task: Task) => void;
    providerDisplayName: (name: string) => string;
}) {
    const config = STATUS_CONFIG[task.status] ?? {
        label: task.status,
        variant: 'secondary' as BadgeVariant,
        icon: Clock,
    };
    const StatusIcon = config.icon;

    return (
        <Card className="transition-shadow duration-200 hover:shadow-md">
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
                                {task.model ? ` · ${task.model}` : ''}
                            </span>
                            <span className="text-xs text-muted-foreground/50">
                                #{task.id}
                            </span>
                        </div>
                        <p className="text-sm leading-relaxed break-words">
                            {task.prompt}
                        </p>
                        {task.error_message && (
                            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3">
                                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                <p className="text-xs text-destructive break-words">
                                    {task.error_message}
                                </p>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {new Date(
                                task.created_at + 'Z',
                            ).toLocaleString()}
                        </p>
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
                        {task.status === 'failed' && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRetry(task.id)}
                            >
                                <RotateCw className="h-3.5 w-3.5 mr-1" />
                                重试
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(task.id)}
                            className="text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function VideoPreviewOverlay({
    task,
    onClose,
    providerDisplayName,
}: {
    task: Task;
    onClose: () => void;
    providerDisplayName: (name: string) => string;
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
                            {task.model ? ` · ${task.model}` : ''}
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
