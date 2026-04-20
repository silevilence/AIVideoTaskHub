import { useState, useEffect, useCallback } from 'react';
import {
    fetchPrompts,
    fetchPromptFolders,
    createPromptApi,
    updatePromptApi,
    deletePromptApi,
    fetchDefaultPromptId,
    updateDefaultPromptId,
    createPromptFolder,
    renamePromptFolder,
    deletePromptFolder,
} from '../api';
import type { Prompt, PromptFolder } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { ConfirmDialog } from './ui/dialog';
import {
    Plus,
    Trash2,
    Save,
    Search,
    Star,
    StarOff,
    Lock,
    Pencil,
    FolderPlus,
    Folder,
    FolderOpen,
    ChevronRight,
    ChevronDown,
    X,
    AlertTriangle,
    Check,
    Maximize2,
    Minimize2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { MarkdownEditor } from './ui/markdown-editor';

interface PromptEditorProps {
    prompt: Prompt | null;
    onSave: (data: { name: string; content: string; tags: string[]; folderId: number | null }) => Promise<void>;
    onCancel: () => void;
    folders: PromptFolder[];
    isNew: boolean;
}

function PromptEditor({ prompt, onSave, onCancel, folders, isNew }: PromptEditorProps) {
    const [name, setName] = useState(prompt?.name || '');
    const [content, setContent] = useState(prompt?.content || '');
    const [tagsInput, setTagsInput] = useState(prompt?.tags.join(', ') || '');
    const [folderId, setFolderId] = useState<number | null>(prompt?.folder_id ?? null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [fullscreen, setFullscreen] = useState(false);

    const handleSave = async () => {
        if (!name.trim()) {
            setError('名称不能为空');
            return;
        }
        if (!content.trim()) {
            setError('内容不能为空');
            return;
        }
        if (!content.includes('${input}')) {
            setError('模板必须包含 ${input} 占位符');
            return;
        }
        if (!content.includes('${lang}') && !warning) {
            setWarning('模板中没有 ${lang} 占位符，输出语言将不可控。再次点击保存以忽略此警告。');
            return;
        }

        setSaving(true);
        setError('');
        setWarning('');
        try {
            const tags = tagsInput.split(/[,，]/).map(t => t.trim()).filter(Boolean);
            await onSave({ name: name.trim(), content, tags, folderId });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">
                    {isNew ? '新建 Prompt' : `编辑: ${prompt?.name}`}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-1.5">
                    <Label>名称</Label>
                    <Input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="输入 Prompt 名称"
                    />
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label>内容</Label>
                        <button
                            onClick={() => setFullscreen(!fullscreen)}
                            className="p-1 hover:bg-accent rounded transition-colors cursor-pointer"
                            title={fullscreen ? '退出全屏' : '全屏编辑'}
                        >
                            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                        </button>
                    </div>
                    <MarkdownEditor
                        value={content}
                        onChange={setContent}
                        className={cn(fullscreen ? 'min-h-96' : 'min-h-48')}
                        placeholder="输入 Prompt 模板内容，使用 ${input} 和 ${lang} 占位符"
                    />
                    <p className="text-xs text-muted-foreground">
                        {'支持 ${input}（用户输入）和 ${lang}（输出语言）占位符'}
                    </p>
                </div>

                <div className="space-y-1.5">
                    <Label>标签</Label>
                    <Input
                        value={tagsInput}
                        onChange={e => setTagsInput(e.target.value)}
                        placeholder="用逗号分隔多个标签，如：视频, 优化, 简洁"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label>所属目录</Label>
                    <select
                        value={folderId ?? ''}
                        onChange={e => setFolderId(e.target.value ? Number(e.target.value) : null)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                        <option value="">根目录</option>
                        {folders.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                    </select>
                </div>

                {error && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {error}
                    </p>
                )}
                {warning && !error && (
                    <p className="text-xs text-amber-500 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {warning}
                    </p>
                )}

                <div className="flex gap-2 pt-2">
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                        <Save className="h-3 w-3 mr-1" />
                        {saving ? '保存中...' : '保存'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        取消
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

export function PromptLibrary() {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [folders, setFolders] = useState<PromptFolder[]>([]);
    const [defaultPromptId, setDefaultPromptId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());
    const [selectedFolderId, setSelectedFolderId] = useState<number | null | 'all'>('all');
    const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'prompt' | 'folder'; id: number; name: string } | null>(null);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState<'success' | 'error'>('success');
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [renamingFolder, setRenamingFolder] = useState<number | null>(null);
    const [renameFolderName, setRenameFolderName] = useState('');

    const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
        setMessage(msg);
        setMessageType(type);
        setTimeout(() => setMessage(''), 3000);
    };

    const loadData = useCallback(async () => {
        try {
            const [promptsData, foldersData, defaultId] = await Promise.all([
                fetchPrompts(searchQuery || undefined),
                fetchPromptFolders(),
                fetchDefaultPromptId(),
            ]);
            setPrompts(promptsData);
            setFolders(foldersData);
            setDefaultPromptId(defaultId);
        } catch {
            showMessage('加载数据失败', 'error');
        }
    }, [searchQuery]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleCreatePrompt = async (data: { name: string; content: string; tags: string[]; folderId: number | null }) => {
        await createPromptApi(data);
        setIsCreating(false);
        showMessage('Prompt 创建成功');
        await loadData();
    };

    const handleUpdatePrompt = async (data: { name: string; content: string; tags: string[]; folderId: number | null }) => {
        if (!editingPrompt) return;
        await updatePromptApi(editingPrompt.id, data);
        setEditingPrompt(null);
        showMessage('Prompt 更新成功');
        await loadData();
    };

    const handleDeletePrompt = async () => {
        if (!deleteConfirm || deleteConfirm.type !== 'prompt') return;
        try {
            await deletePromptApi(deleteConfirm.id);
            showMessage('Prompt 已删除');
            setDeleteConfirm(null);
            await loadData();
        } catch (err) {
            showMessage((err as Error).message, 'error');
            setDeleteConfirm(null);
        }
    };

    const handleSetDefault = async (id: number | null) => {
        try {
            await updateDefaultPromptId(id);
            setDefaultPromptId(id);
            showMessage(id ? '已设为全局默认 Prompt' : '已取消全局默认 Prompt');
        } catch (err) {
            showMessage((err as Error).message, 'error');
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        try {
            await createPromptFolder(newFolderName.trim());
            setCreatingFolder(false);
            setNewFolderName('');
            showMessage('目录创建成功');
            await loadData();
        } catch (err) {
            showMessage((err as Error).message, 'error');
        }
    };

    const handleRenameFolder = async (id: number) => {
        if (!renameFolderName.trim()) return;
        try {
            await renamePromptFolder(id, renameFolderName.trim());
            setRenamingFolder(null);
            setRenameFolderName('');
            showMessage('目录已重命名');
            await loadData();
        } catch (err) {
            showMessage((err as Error).message, 'error');
        }
    };

    const handleDeleteFolder = async () => {
        if (!deleteConfirm || deleteConfirm.type !== 'folder') return;
        try {
            await deletePromptFolder(deleteConfirm.id);
            setDeleteConfirm(null);
            if (selectedFolderId === deleteConfirm.id) setSelectedFolderId('all');
            showMessage('目录已删除');
            await loadData();
        } catch (err) {
            showMessage((err as Error).message, 'error');
            setDeleteConfirm(null);
        }
    };

    const toggleFolder = (id: number) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // 按目录过滤
    const filteredPrompts = selectedFolderId === 'all'
        ? prompts
        : prompts.filter(p => p.folder_id === selectedFolderId);

    // 正在编辑，显示编辑器
    if (isCreating) {
        return (
            <div className="space-y-4">
                <PromptEditor
                    prompt={null}
                    onSave={handleCreatePrompt}
                    onCancel={() => setIsCreating(false)}
                    folders={folders}
                    isNew
                />
            </div>
        );
    }

    if (editingPrompt) {
        return (
            <div className="space-y-4">
                <PromptEditor
                    prompt={editingPrompt}
                    onSave={handleUpdatePrompt}
                    onCancel={() => setEditingPrompt(null)}
                    folders={folders}
                    isNew={false}
                />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* 消息提示 */}
            {message && (
                <div className={cn(
                    'text-sm px-3 py-2 rounded-md',
                    messageType === 'success' ? 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950' : 'text-destructive bg-destructive/10',
                )}>
                    {message}
                </div>
            )}

            {/* 工具栏 */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="搜索 Prompt 名称或标签..."
                        className="pl-8 h-9"
                    />
                </div>
                <Button size="sm" onClick={() => setIsCreating(true)}>
                    <Plus className="h-3 w-3 mr-1" /> 新建 Prompt
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCreatingFolder(true)}>
                    <FolderPlus className="h-3 w-3 mr-1" /> 新建目录
                </Button>
            </div>

            {/* 新建目录行 */}
            {creatingFolder && (
                <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
                    <Folder className="h-4 w-4 text-muted-foreground" />
                    <Input
                        value={newFolderName}
                        onChange={e => setNewFolderName(e.target.value)}
                        placeholder="输入目录名称"
                        className="h-8 flex-1"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleCreateFolder();
                            if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
                        }}
                    />
                    <Button size="sm" variant="ghost" onClick={handleCreateFolder}>
                        <Check className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCreatingFolder(false); setNewFolderName(''); }}>
                        <X className="h-3 w-3" />
                    </Button>
                </div>
            )}

            <div className="flex gap-4">
                {/* 左侧目录树 */}
                <div className="w-48 shrink-0 space-y-1">
                    <button
                        onClick={() => setSelectedFolderId('all')}
                        className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer',
                            selectedFolderId === 'all' ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-muted-foreground',
                        )}
                    >
                        <FolderOpen className="h-4 w-4" />
                        全部
                        <span className="ml-auto text-xs">{prompts.length}</span>
                    </button>
                    <button
                        onClick={() => setSelectedFolderId(null)}
                        className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer',
                            selectedFolderId === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-muted-foreground',
                        )}
                    >
                        <Folder className="h-4 w-4" />
                        未分类
                        <span className="ml-auto text-xs">{prompts.filter(p => p.folder_id === null).length}</span>
                    </button>
                    {folders.map(folder => (
                        <div key={folder.id} className="group">
                            <div className="flex items-center">
                                <button
                                    onClick={() => { toggleFolder(folder.id); setSelectedFolderId(folder.id); }}
                                    className={cn(
                                        'flex-1 flex items-center gap-1.5 px-2 py-1.5 text-sm rounded-md transition-colors cursor-pointer',
                                        selectedFolderId === folder.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-accent text-muted-foreground',
                                    )}
                                >
                                    {expandedFolders.has(folder.id) ? (
                                        <ChevronDown className="h-3 w-3" />
                                    ) : (
                                        <ChevronRight className="h-3 w-3" />
                                    )}
                                    {renamingFolder === folder.id ? (
                                        <Input
                                            value={renameFolderName}
                                            onChange={e => setRenameFolderName(e.target.value)}
                                            className="h-6 text-xs flex-1"
                                            autoFocus
                                            onClick={e => e.stopPropagation()}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleRenameFolder(folder.id);
                                                if (e.key === 'Escape') setRenamingFolder(null);
                                            }}
                                        />
                                    ) : (
                                        <>
                                            <span className="truncate">{folder.name}</span>
                                            <span className="ml-auto text-xs">{prompts.filter(p => p.folder_id === folder.id).length}</span>
                                        </>
                                    )}
                                </button>
                                <div className="hidden group-hover:flex items-center">
                                    <button
                                        onClick={() => { setRenamingFolder(folder.id); setRenameFolderName(folder.name); }}
                                        className="p-0.5 hover:bg-accent rounded cursor-pointer"
                                        title="重命名"
                                    >
                                        <Pencil className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                    <button
                                        onClick={() => setDeleteConfirm({ type: 'folder', id: folder.id, name: folder.name })}
                                        className="p-0.5 hover:bg-accent rounded cursor-pointer"
                                        title="删除目录"
                                    >
                                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* 右侧 Prompt 列表 */}
                <div className="flex-1 space-y-2">
                    {filteredPrompts.length === 0 && (
                        <div className="text-center text-sm text-muted-foreground py-8">
                            {searchQuery ? '没有找到匹配的 Prompt' : '暂无 Prompt，点击「新建 Prompt」创建'}
                        </div>
                    )}
                    {filteredPrompts.map(prompt => (
                        <Card key={prompt.id} className={cn(
                            'transition-colors',
                            defaultPromptId === prompt.id && 'border-primary/50 bg-primary/5',
                        )}>
                            <CardContent className="py-3 px-4">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-medium truncate">{prompt.name}</h4>
                                            {prompt.is_system && (
                                                <Badge variant="secondary" className="text-xs shrink-0">
                                                    <Lock className="h-2.5 w-2.5 mr-0.5" /> 系统
                                                </Badge>
                                            )}
                                            {defaultPromptId === prompt.id && (
                                                <Badge className="text-xs shrink-0 bg-primary/20 text-primary border-primary/30">
                                                    <Star className="h-2.5 w-2.5 mr-0.5" /> 默认
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{prompt.content.slice(0, 150)}...</p>
                                        {prompt.tags.length > 0 && (
                                            <div className="flex gap-1 mt-1.5 flex-wrap">
                                                {prompt.tags.map(tag => (
                                                    <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">{tag}</Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={() => handleSetDefault(defaultPromptId === prompt.id ? null : prompt.id)}
                                            className="p-1.5 hover:bg-accent rounded-md transition-colors cursor-pointer"
                                            title={defaultPromptId === prompt.id ? '取消默认' : '设为默认'}
                                        >
                                            {defaultPromptId === prompt.id
                                                ? <StarOff className="h-4 w-4 text-primary" />
                                                : <Star className="h-4 w-4 text-muted-foreground" />
                                            }
                                        </button>
                                        {!prompt.is_system && (
                                            <>
                                                <button
                                                    onClick={() => setEditingPrompt(prompt)}
                                                    className="p-1.5 hover:bg-accent rounded-md transition-colors cursor-pointer"
                                                    title="编辑"
                                                >
                                                    <Pencil className="h-4 w-4 text-muted-foreground" />
                                                </button>
                                                <button
                                                    onClick={() => setDeleteConfirm({ type: 'prompt', id: prompt.id, name: prompt.name })}
                                                    className="p-1.5 hover:bg-accent rounded-md transition-colors cursor-pointer"
                                                    title="删除"
                                                >
                                                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {/* 删除确认弹窗 */}
            <ConfirmDialog
                open={deleteConfirm !== null}
                title={deleteConfirm?.type === 'prompt' ? '删除 Prompt' : '删除目录'}
                description={
                    deleteConfirm?.type === 'prompt'
                        ? `确认删除 "${deleteConfirm.name}"？此操作不可撤销。`
                        : `确认删除目录 "${deleteConfirm?.name}"？目录下的 Prompt 将移至根目录。`
                }
                confirmText="删除"
                cancelText="取消"
                onConfirm={deleteConfirm?.type === 'prompt' ? handleDeletePrompt : handleDeleteFolder}
                onCancel={() => setDeleteConfirm(null)}
            />
        </div>
    );
}
