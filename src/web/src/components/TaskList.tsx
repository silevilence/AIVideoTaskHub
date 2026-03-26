import { useState, useEffect, useCallback } from 'react';
import type { Task } from '../api';
import { fetchTasks, retryTask, deleteTask } from '../api';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    pending: { label: '等待中', color: 'bg-yellow-100 text-yellow-800' },
    running: { label: '生成中', color: 'bg-blue-100 text-blue-800' },
    success: { label: '已完成', color: 'bg-green-100 text-green-800' },
    failed: { label: '失败', color: 'bg-red-100 text-red-800' },
};

export function TaskList({ refreshKey }: { refreshKey: number }) {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);

    const loadTasks = useCallback(async () => {
        try {
            const data = await fetchTasks();
            setTasks(data);
        } catch {
            console.error('加载任务列表失败');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTasks();
        const timer = setInterval(loadTasks, 5000);
        return () => clearInterval(timer);
    }, [loadTasks]);

    // 外部 refreshKey 变化时立即刷新
    useEffect(() => {
        if (refreshKey > 0) loadTasks();
    }, [refreshKey, loadTasks]);

    const handleRetry = async (id: number) => {
        try {
            await retryTask(id);
            await loadTasks();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('确定删除此任务？')) return;
        try {
            await deleteTask(id);
            await loadTasks();
        } catch (err) {
            alert((err as Error).message);
        }
    };

    if (loading) {
        return <div className="text-center py-12 text-gray-400">加载中...</div>;
    }

    if (tasks.length === 0) {
        return (
            <div className="text-center py-12 text-gray-400">
                暂无任务，创建一个试试吧
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {tasks.map((task) => (
                <TaskCard
                    key={task.id}
                    task={task}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                />
            ))}
        </div>
    );
}

function TaskCard({
    task,
    onRetry,
    onDelete,
}: {
    task: Task;
    onRetry: (id: number) => void;
    onDelete: (id: number) => void;
}) {
    const status = STATUS_MAP[task.status] ?? {
        label: task.status,
        color: 'bg-gray-100 text-gray-800',
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                        >
                            {status.label}
                        </span>
                        <span className="text-xs text-gray-400">
                            {task.provider}
                            {task.model ? ` · ${task.model}` : ''}
                        </span>
                        <span className="text-xs text-gray-300">#{task.id}</span>
                    </div>
                    <p className="text-sm text-gray-700 wrap-break-word">{task.prompt}</p>
                    {task.error_message && (
                        <p className="mt-1 text-xs text-red-500 wrap-break-word">
                            错误: {task.error_message}
                        </p>
                    )}
                    <p className="mt-1 text-xs text-gray-300">
                        {new Date(task.created_at + 'Z').toLocaleString()}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {task.status === 'failed' && (
                        <button
                            onClick={() => onRetry(task.id)}
                            className="px-3 py-1 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded hover:bg-yellow-100"
                        >
                            重试
                        </button>
                    )}
                    <button
                        onClick={() => onDelete(task.id)}
                        className="px-3 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
                    >
                        删除
                    </button>
                </div>
            </div>

            {task.status === 'success' && task.result_url && (
                <div className="mt-3">
                    <video
                        src={task.result_url}
                        controls
                        className="w-full max-w-md rounded border border-gray-200"
                    />
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(
                                window.location.origin + task.result_url
                            );
                        }}
                        className="mt-1 px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                        复制链接
                    </button>
                </div>
            )}
        </div>
    );
}
