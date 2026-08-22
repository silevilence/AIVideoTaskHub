import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    Check,
    CircleAlert,
    CircleCheck,
    Copy,
    Download,
    FileCode2,
    FlaskConical,
    Import,
    Loader2,
    Plus,
    Power,
    Save,
    Search,
    ServerCog,
    Sparkles,
    Trash2,
    WandSparkles,
    X,
} from 'lucide-react';
import {
    checkComfyWorkflowCompatibility,
    ComfyWorkflowApiError,
    deleteComfyWorkflowTemplate,
    duplicateComfyWorkflowTemplate,
    exportComfyWorkflowTemplate,
    fetchComfyUiSettings,
    fetchComfyWorkflowTemplates,
    saveComfyWorkflowTemplate,
    setComfyWorkflowTemplateEnabled,
    testComfyUiConnection,
    updateComfyUiSettings,
    type ComfyCompatibilityResult,
    type ComfyWorkflowTemplate,
} from '../api';
import {
    composeWorkflowTemplateDocument,
    createEmptyWorkflowDraft,
    formatWorkflowJson,
    splitWorkflowTemplateDocument,
    validateWorkflowJson,
    type WorkflowEditorDiagnostic,
    type WorkflowEditorDraft,
    type WorkflowVariableDraft,
    type WorkflowVariableType,
} from '../lib/comfy-workflow-editor';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { ConfirmDialog } from './ui/dialog';
import { Input } from './ui/input';
import { JsonEditor } from './ui/json-editor';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

interface EditorState {
    id?: string;
    enabled: boolean;
    draft: WorkflowEditorDraft;
}

interface PendingWarning {
    warnings: string[];
    confirm: () => Promise<void>;
}

const VARIABLE_TYPES: { value: WorkflowVariableType; label: string }[] = [
    { value: 'string', label: '字符串' },
    { value: 'integer', label: '整数' },
    { value: 'number', label: '小数' },
    { value: 'boolean', label: '布尔' },
    { value: 'option', label: '选项' },
    { value: 'image', label: '图片' },
];

function optionalNumber(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function initialDefault(type: WorkflowVariableType, variable: WorkflowVariableDraft): unknown {
    if (type === 'boolean') return false;
    if (type === 'integer' || type === 'number') return 0;
    if (type === 'option') return variable.options?.[0]?.value ?? '';
    return '';
}

function uniqueCopyName(name: string, templates: ComfyWorkflowTemplate[]): string {
    const names = new Set(templates.map((template) => template.name.toLocaleLowerCase()));
    let candidate = `${name} 副本`;
    let sequence = 2;
    while (names.has(candidate.toLocaleLowerCase())) candidate = `${name} 副本 ${sequence++}`;
    return candidate;
}

function downloadDocument(name: string, document: string): void {
    const url = URL.createObjectURL(new Blob([document], { type: 'text/plain;charset=utf-8' }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.comfy-workflow`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function VariableEditor({
    variable,
    index,
    onChange,
    onRemove,
}: {
    variable: WorkflowVariableDraft;
    index: number;
    onChange: (value: WorkflowVariableDraft) => void;
    onRemove: () => void;
}) {
    const fieldId = useId();
    const set = (patch: Partial<WorkflowVariableDraft>) => onChange({ ...variable, ...patch });
    const hasDefault = variable.default !== undefined;

    const changeType = (type: WorkflowVariableType) => {
        onChange({
            key: variable.key,
            label: variable.label,
            description: variable.description,
            type,
            ...(type === 'option' ? { options: [{ label: '默认选项', value: 'default' }] } : {}),
        });
    };

    const editOptions = (value: string) => {
        const options = value.split('\n').map((line) => {
            const separator = line.indexOf('=');
            return separator < 0
                ? { label: line.trim(), value: line.trim() }
                : { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
        }).filter((option) => option.label || option.value);
        set({ options });
    };

    return (
        <div className="group rounded-xl border border-border/80 bg-background/55 p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 font-mono text-[11px] font-bold text-primary">
                        {index + 1}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                        {variable.key ? `\${${variable.key}}` : '未命名变量'}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`删除变量 ${variable.label || variable.key || index + 1}`}
                    className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    title="删除变量"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <Label htmlFor={`${fieldId}-key`} className="text-[11px]">变量键</Label>
                    <Input id={`${fieldId}-key`} value={variable.key} onChange={(event) => set({ key: event.target.value })} className="h-8 font-mono text-xs" placeholder="steps" />
                </div>
                <div className="space-y-1">
                    <Label htmlFor={`${fieldId}-label`} className="text-[11px]">显示名</Label>
                    <Input id={`${fieldId}-label`} value={variable.label} onChange={(event) => set({ label: event.target.value })} className="h-8 text-xs" placeholder="采样步数" />
                </div>
                <div className="col-span-2 space-y-1">
                    <Label htmlFor={`${fieldId}-type`} className="text-[11px]">类型</Label>
                    <select id={`${fieldId}-type`} value={variable.type} onChange={(event) => changeType(event.target.value as WorkflowVariableType)} className="h-8 w-full rounded-md border bg-background px-2 text-xs">
                        {VARIABLE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>
                </div>
                <div className="col-span-2 space-y-1">
                    <Label htmlFor={`${fieldId}-description`} className="text-[11px]">说明</Label>
                    <Input id={`${fieldId}-description`} value={variable.description ?? ''} onChange={(event) => set({ description: event.target.value || undefined })} className="h-8 text-xs" placeholder="创建任务时展示给用户" />
                </div>
            </div>

            {(variable.type === 'integer' || variable.type === 'number') && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['min', 'max', 'step'] as const).map((field) => (
                        <div key={field} className="space-y-1">
                            <Label htmlFor={`${fieldId}-${field}`} className="text-[10px] uppercase text-muted-foreground">{field}</Label>
                            <Input id={`${fieldId}-${field}`} type="number" value={variable[field] ?? ''} onChange={(event) => set({ [field]: optionalNumber(event.target.value) })} className="h-8 text-xs" />
                        </div>
                    ))}
                </div>
            )}

            {variable.type === 'string' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                        <Label htmlFor={`${fieldId}-min-length`} className="text-[10px] text-muted-foreground">最短长度</Label>
                        <Input id={`${fieldId}-min-length`} type="number" value={variable.minLength ?? ''} onChange={(event) => set({ minLength: optionalNumber(event.target.value) })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${fieldId}-max-length`} className="text-[10px] text-muted-foreground">最长长度</Label>
                        <Input id={`${fieldId}-max-length`} type="number" value={variable.maxLength ?? ''} onChange={(event) => set({ maxLength: optionalNumber(event.target.value) })} className="h-8 text-xs" />
                    </div>
                    <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" checked={variable.multiline ?? false} onChange={(event) => set({ multiline: event.target.checked || undefined })} />
                        创建任务时使用多行输入
                    </label>
                </div>
            )}

            {variable.type === 'option' && (
                <div className="mt-2 space-y-1">
                    <Label htmlFor={`${fieldId}-options`} className="text-[10px] text-muted-foreground">选项（每行“显示名=内部值”）</Label>
                    <textarea
                        id={`${fieldId}-options`}
                        value={(variable.options ?? []).map((option) => `${option.label}=${option.value}`).join('\n')}
                        onChange={(event) => editOptions(event.target.value)}
                        className="min-h-20 w-full rounded-md border bg-background p-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
            )}

            <div className="mt-3 border-t border-dashed pt-3">
                <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                        type="checkbox"
                        checked={hasDefault}
                        onChange={(event) => set({ default: event.target.checked ? initialDefault(variable.type, variable) : undefined })}
                    />
                    创建任务时预填默认值
                </label>
                {hasDefault && (
                    <div className="mt-2">
                        {variable.type === 'boolean' ? (
                            <select aria-label={`变量 ${variable.label || variable.key} 的默认值`} value={String(variable.default)} onChange={(event) => set({ default: event.target.value === 'true' })} className="h-8 w-full rounded-md border bg-background px-2 text-xs">
                                <option value="false">false</option>
                                <option value="true">true</option>
                            </select>
                        ) : variable.type === 'option' ? (
                            <select aria-label={`变量 ${variable.label || variable.key} 的默认值`} value={String(variable.default)} onChange={(event) => set({ default: event.target.value })} className="h-8 w-full rounded-md border bg-background px-2 text-xs">
                                {(variable.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        ) : (
                            <Input
                                aria-label={`变量 ${variable.label || variable.key} 的默认值`}
                                type={variable.type === 'integer' || variable.type === 'number' ? 'number' : 'text'}
                                value={String(variable.default ?? '')}
                                onChange={(event) => set({
                                    default: variable.type === 'integer' || variable.type === 'number'
                                        ? optionalNumber(event.target.value)
                                        : event.target.value,
                                })}
                                className="h-8 text-xs"
                                placeholder={variable.type === 'image' ? 'https://… 或 /uploads/<uuid>.png' : '默认值'}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export function ComfyWorkflowManager() {
    const [templates, setTemplates] = useState<ComfyWorkflowTemplate[]>([]);
    const [search, setSearch] = useState('');
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [diagnostics, setDiagnostics] = useState<WorkflowEditorDiagnostic[]>([]);
    const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<ComfyWorkflowTemplate | null>(null);
    const [pendingWarning, setPendingWarning] = useState<PendingWarning | null>(null);
    const [baseUrl, setBaseUrl] = useState('');
    const [savedBaseUrl, setSavedBaseUrl] = useState('');
    const [connectionBusy, setConnectionBusy] = useState(false);
    const [compatibility, setCompatibility] = useState<ComfyCompatibilityResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const requestSequenceRef = useRef(0);
    const messageTimerRef = useRef<number | undefined>(undefined);

    const notify = (text: string, kind: 'success' | 'error' = 'success') => {
        if (messageTimerRef.current !== undefined) window.clearTimeout(messageTimerRef.current);
        setMessage({ text, kind });
        messageTimerRef.current = window.setTimeout(() => setMessage(null), 3500);
    };

    const loadTemplates = useCallback(async (query = search) => {
        const requestSequence = ++requestSequenceRef.current;
        setLoading(true);
        try {
            const result = await fetchComfyWorkflowTemplates(query || undefined);
            if (requestSequence === requestSequenceRef.current) setTemplates(result);
        } catch (error) {
            if (requestSequence === requestSequenceRef.current) {
                notify((error as Error).message, 'error');
            }
        } finally {
            if (requestSequence === requestSequenceRef.current) setLoading(false);
        }
    }, [search]);

    useEffect(() => {
        void loadTemplates();
    }, [loadTemplates]);

    useEffect(() => {
        fetchComfyUiSettings().then(({ baseUrl: value }) => {
            setBaseUrl(value);
            setSavedBaseUrl(value);
        }).catch((error) => notify((error as Error).message, 'error'));
    }, []);

    useEffect(() => () => {
        if (messageTimerRef.current !== undefined) window.clearTimeout(messageTimerRef.current);
    }, []);

    const changeDraft = (updater: (draft: WorkflowEditorDraft) => WorkflowEditorDraft) => {
        setEditor((current) => current ? { ...current, draft: updater(current.draft) } : current);
        setPendingWarning(null);
        setCompatibility(null);
    };

    const editTemplate = (template: ComfyWorkflowTemplate) => {
        try {
            setEditor({ id: template.id, enabled: template.enabled, draft: splitWorkflowTemplateDocument(template.document) });
            setCompatibility(null);
        } catch (error) {
            notify((error as Error).message, 'error');
        }
    };

    const persistEditor = async (confirmWarnings = false) => {
        if (!editor) return;
        const clientDiagnostics = validateWorkflowJson(editor.draft.json);
        setDiagnostics(clientDiagnostics);
        if (clientDiagnostics.some((item) => item.severity === 'error')) {
            notify('请先修复 JSON 编辑器中的错误', 'error');
            return;
        }
        const document = composeWorkflowTemplateDocument(editor.draft.metadata, editor.draft.json);
        setSaving(true);
        try {
            const result = await saveComfyWorkflowTemplate(
                editor.id,
                document,
                editor.enabled,
                confirmWarnings
            );
            setEditor({
                id: result.template.id,
                enabled: result.template.enabled,
                draft: splitWorkflowTemplateDocument(result.template.document),
            });
            setPendingWarning(null);
            notify(editor.id ? '工作流模板已更新' : '工作流模板已创建');
            await loadTemplates();
        } catch (error) {
            if (error instanceof ComfyWorkflowApiError && error.status === 409 && error.warnings.length > 0) {
                setPendingWarning({ warnings: error.warnings, confirm: () => persistEditor(true) });
            } else if (error instanceof ComfyWorkflowApiError && error.errors.length > 0) {
                notify(error.errors.join('；'), 'error');
            } else {
                notify((error as Error).message, 'error');
            }
        } finally {
            setSaving(false);
        }
    };

    const duplicateTemplate = async (template: ComfyWorkflowTemplate, confirmWarnings = false) => {
        const name = uniqueCopyName(template.name, templates);
        try {
            await duplicateComfyWorkflowTemplate(template.id, name, confirmWarnings);
            setPendingWarning(null);
            notify(`已创建“${name}”`);
            await loadTemplates();
        } catch (error) {
            if (error instanceof ComfyWorkflowApiError && error.status === 409 && error.warnings.length > 0) {
                setPendingWarning({
                    warnings: error.warnings,
                    confirm: () => duplicateTemplate(template, true),
                });
            } else {
                notify((error as Error).message, 'error');
            }
        }
    };

    const toggleTemplate = async (template: ComfyWorkflowTemplate) => {
        try {
            await setComfyWorkflowTemplateEnabled(template.id, !template.enabled);
            await loadTemplates();
        } catch (error) {
            notify((error as Error).message, 'error');
        }
    };

    const removeTemplate = async () => {
        if (!deleteTarget) return;
        try {
            await deleteComfyWorkflowTemplate(deleteTarget.id);
            if (editor?.id === deleteTarget.id) setEditor(null);
            notify('工作流模板已删除');
            await loadTemplates();
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setDeleteTarget(null);
        }
    };

    const exportTemplate = async (template: ComfyWorkflowTemplate) => {
        try {
            downloadDocument(template.name, await exportComfyWorkflowTemplate(template.id));
        } catch (error) {
            notify((error as Error).message, 'error');
        }
    };

    const importTemplate = async (file: File) => {
        try {
            setEditor({ enabled: true, draft: splitWorkflowTemplateDocument(await file.text()) });
            notify('组合文档已载入，请检查后保存');
        } catch (error) {
            notify((error as Error).message, 'error');
        }
    };

    const saveConnection = async () => {
        setConnectionBusy(true);
        try {
            const settings = await updateComfyUiSettings(baseUrl);
            setBaseUrl(settings.baseUrl);
            setSavedBaseUrl(settings.baseUrl);
            notify('默认 ComfyUI 地址已保存');
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setConnectionBusy(false);
        }
    };

    const testConnection = async () => {
        setConnectionBusy(true);
        try {
            const result = await testComfyUiConnection(baseUrl);
            notify(`连接成功，识别到 ${result.nodeTypeCount} 种节点`);
        } catch (error) {
            notify((error as Error).message, 'error');
        } finally {
            setConnectionBusy(false);
        }
    };

    const checkCompatibility = async () => {
        if (!editor) return;
        if (baseUrl !== savedBaseUrl) {
            notify('请先保存当前默认地址，再执行模板兼容性检查', 'error');
            return;
        }
        setConnectionBusy(true);
        setCompatibility(null);
        try {
            setCompatibility(await checkComfyWorkflowCompatibility(
                composeWorkflowTemplateDocument(editor.draft.metadata, editor.draft.json)
            ));
        } catch (error) {
            if (error instanceof ComfyWorkflowApiError && error.status === 400) {
                const detail = error.errors.length > 0 ? error.errors.join('；') : error.message;
                notify(`模板无法检查：${detail}`, 'error');
            } else {
                notify(`在线检查失败，但仍可离线保存：${(error as Error).message}`, 'error');
            }
        } finally {
            setConnectionBusy(false);
        }
    };

    const updateMetadata = (patch: Partial<WorkflowEditorDraft['metadata']>) => {
        changeDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, ...patch } }));
    };

    const updateVariable = (index: number, variable: WorkflowVariableDraft) => {
        changeDraft((draft) => ({
            ...draft,
            metadata: {
                ...draft.metadata,
                variables: draft.metadata.variables.map((current, currentIndex) => currentIndex === index ? variable : current),
            },
        }));
    };

    const addVariable = () => {
        if (!editor) return;
        const sequence = editor.draft.metadata.variables.length + 1;
        updateMetadata({
            variables: [...editor.draft.metadata.variables, {
                key: `variable_${sequence}`,
                label: `变量 ${sequence}`,
                type: 'string',
            }],
        });
    };

    return (
        <div className="space-y-5">
            <Card className="overflow-hidden border-emerald-500/25 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_42%)]">
                <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <ServerCog className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-semibold tracking-wide">默认 ComfyUI 控制端</h3>
                            {savedBaseUrl && <Badge variant="secondary" className="font-mono text-[10px]">HTTP · 无认证</Badge>}
                        </div>
                        <p className="mb-3 text-xs text-muted-foreground">用于管理器在线检查；任务创建时仍可临时覆盖，不会回写此处。</p>
                        <Input aria-label="默认 ComfyUI 地址" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8188" className="max-w-xl font-mono text-sm" />
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={testConnection} disabled={connectionBusy || !baseUrl.trim()}>
                            <FlaskConical className="mr-1.5 h-4 w-4" />测试连接
                        </Button>
                        <Button onClick={saveConnection} disabled={connectionBusy || !baseUrl.trim() || baseUrl === savedBaseUrl}>
                            {connectionBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                            保存地址
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-60 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input aria-label="搜索工作流模板" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工作流模板…" className="pl-9" />
                </div>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Import className="mr-1.5 h-4 w-4" />导入组合文档
                </Button>
                <input ref={fileInputRef} type="file" accept=".json,.yaml,.yml,.comfy-workflow,text/plain,application/json" className="hidden" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importTemplate(file);
                    event.target.value = '';
                }} />
                <Button onClick={() => setEditor({ enabled: true, draft: createEmptyWorkflowDraft() })}>
                    <Plus className="mr-1.5 h-4 w-4" />新建模板
                </Button>
            </div>

            {message && (
                <div role={message.kind === 'error' ? 'alert' : 'status'} aria-live="polite" className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', message.kind === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-300')}>
                    {message.kind === 'error' ? <CircleAlert className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
                    {message.text}
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {loading && <div className="col-span-full flex items-center justify-center py-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载模板…</div>}
                {!loading && templates.length === 0 && (
                    <div className="col-span-full rounded-xl border border-dashed p-10 text-center">
                        <FileCode2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                        <p className="text-sm font-medium">{search ? '没有匹配的工作流' : '还没有工作流模板'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">导入 ComfyUI API Format 工作流，或从空白模板开始。</p>
                    </div>
                )}
                {!loading && templates.map((template) => (
                    <Card key={template.id} className={cn('transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md', editor?.id === template.id && 'border-primary/60 bg-primary/[0.035]')}>
                        <CardContent className="p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                                <button type="button" className="min-w-0 text-left" onClick={() => editTemplate(template)}>
                                    <div className="flex items-center gap-2">
                                        <span className={cn('h-2 w-2 shrink-0 rounded-full', template.enabled ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]' : 'bg-slate-400')} />
                                        <h4 className="truncate text-sm font-semibold">{template.name}</h4>
                                    </div>
                                    <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">{template.id}</p>
                                </button>
                                <Badge variant={template.enabled ? 'default' : 'secondary'} className="text-[10px]">{template.enabled ? '模型可见' : '已停用'}</Badge>
                            </div>
                            <div className="flex items-center gap-1 border-t pt-3">
                                <button aria-label={`编辑 ${template.name}`} onClick={() => editTemplate(template)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="编辑"><WandSparkles className="h-3.5 w-3.5" /></button>
                                <button aria-label={`复制 ${template.name}`} onClick={() => void duplicateTemplate(template)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="复制"><Copy className="h-3.5 w-3.5" /></button>
                                <button aria-label={`导出 ${template.name}`} onClick={() => void exportTemplate(template)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="导出"><Download className="h-3.5 w-3.5" /></button>
                                <button aria-label={`${template.enabled ? '停用' : '启用'} ${template.name}`} onClick={() => void toggleTemplate(template)} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={template.enabled ? '停用' : '启用'}><Power className="h-3.5 w-3.5" /></button>
                                <button aria-label={`删除 ${template.name}`} onClick={() => setDeleteTarget(template)} className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="删除"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {editor && (
                <section className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-slate-950/5">
                    <header className="flex flex-wrap items-center gap-3 border-b bg-muted/25 px-5 py-4">
                        <div className="mr-auto">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-primary" />
                                <h3 className="font-heading text-sm font-bold tracking-wide">{editor.id ? '工作流编辑台' : '新建工作流'}</h3>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">元数据自动写入 YAML 头；代码区始终只保存 API Format JSON。</p>
                        </div>
                        <Button variant="outline" onClick={checkCompatibility} disabled={connectionBusy || !savedBaseUrl}>
                            <FlaskConical className="mr-1.5 h-4 w-4" />检查默认实例
                        </Button>
                        <Button onClick={() => void persistEditor()} disabled={saving}>
                            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                            保存模板
                        </Button>
                        <button aria-label="关闭编辑器" onClick={() => setEditor(null)} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground" title="关闭编辑器"><X className="h-4 w-4" /></button>
                    </header>

                    <div className="grid min-h-[680px] xl:grid-cols-[minmax(0,1.45fr)_minmax(380px,.8fr)]">
                        <div className="flex min-w-0 flex-col border-b xl:border-r xl:border-b-0">
                            <div className="flex items-center justify-between border-b px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-semibold">workflow.api.json</span>
                                    <Badge variant="secondary" className="text-[9px]">JSON ONLY</Badge>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => changeDraft((draft) => ({ ...draft, json: formatWorkflowJson(draft.json) }))}>
                                    <WandSparkles className="mr-1.5 h-3.5 w-3.5" />格式化
                                </Button>
                            </div>
                            <JsonEditor value={editor.draft.json} onChange={(json) => changeDraft((draft) => ({ ...draft, json }))} onDiagnostics={setDiagnostics} className="m-3 min-h-[520px] flex-1" />
                            <div id="comfy-workflow-json-diagnostics" role={diagnostics.length > 0 ? 'alert' : 'status'} aria-live="polite" className="border-t px-4 py-3">
                                {diagnostics.length === 0 ? (
                                    <p className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-300"><Check className="h-3.5 w-3.5" />JSON 语法与 API 基础结构有效</p>
                                ) : diagnostics.map((diagnostic, index) => (
                                    <p key={`${diagnostic.code}-${index}`} className="flex items-start gap-2 text-xs text-destructive">
                                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        {diagnostic.line ? `第 ${diagnostic.line} 行，第 ${diagnostic.column} 列：` : ''}{diagnostic.message}
                                    </p>
                                ))}
                            </div>
                        </div>

                        <aside className="max-h-[760px] space-y-5 overflow-y-auto bg-muted/10 p-4">
                            <div className="space-y-3">
                                <div className="flex items-center gap-2"><span className="h-4 w-1 rounded-full bg-primary" /><h4 className="text-xs font-bold uppercase tracking-[.16em]">模板身份</h4></div>
                                <div className="space-y-1"><Label htmlFor="comfy-template-name">模板名称</Label><Input id="comfy-template-name" value={editor.draft.metadata.name} onChange={(event) => updateMetadata({ name: event.target.value })} /></div>
                                <div className="space-y-1"><Label htmlFor="comfy-template-description">说明</Label><Input id="comfy-template-description" value={editor.draft.metadata.description ?? ''} onChange={(event) => updateMetadata({ description: event.target.value || undefined })} placeholder="适用场景、模型或节点包说明" /></div>
                                <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor((current) => current ? { ...current, enabled: event.target.checked } : current)} />保存后启用并显示为可选模型</label>
                            </div>

                            <div className="space-y-3 border-t pt-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2"><span className="h-4 w-1 rounded-full bg-sky-400" /><h4 className="text-xs font-bold uppercase tracking-[.16em]">变量面板</h4></div>
                                    <Button variant="outline" size="sm" onClick={addVariable}><Plus className="mr-1 h-3 w-3" />添加</Button>
                                </div>
                                {editor.draft.metadata.variables.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">此模板尚未定义变量。</p>}
                                {editor.draft.metadata.variables.map((variable, index) => (
                                    <VariableEditor
                                        key={index}
                                        variable={variable}
                                        index={index}
                                        onChange={(value) => updateVariable(index, value)}
                                        onRemove={() => updateMetadata({ variables: editor.draft.metadata.variables.filter((_, itemIndex) => itemIndex !== index) })}
                                    />
                                ))}
                            </div>

                            <div className="space-y-3 border-t pt-4">
                                <div className="flex items-center gap-2"><span className="h-4 w-1 rounded-full bg-amber-400" /><h4 className="text-xs font-bold uppercase tracking-[.16em]">描述与主输出</h4></div>
                                <div className="space-y-1">
                                    <Label htmlFor="comfy-primary-description">主描述变量</Label>
                                    <select id="comfy-primary-description" value={editor.draft.metadata.primaryDescription ?? ''} onChange={(event) => updateMetadata({ primaryDescription: event.target.value || undefined })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                                        <option value="">不指定（使用模板名）</option>
                                        {editor.draft.metadata.variables.filter((variable) => variable.type === 'string').map((variable) => <option key={variable.key} value={variable.key}>{variable.label || variable.key} · {variable.key}</option>)}
                                    </select>
                                </div>
                                <div className="grid grid-cols-[1fr_1fr_72px] gap-2">
                                    <div className="space-y-1"><Label htmlFor="comfy-output-node">节点 ID</Label><Input id="comfy-output-node" value={editor.draft.metadata.primaryOutput.nodeId} onChange={(event) => updateMetadata({ primaryOutput: { ...editor.draft.metadata.primaryOutput, nodeId: event.target.value } })} className="font-mono" /></div>
                                    <div className="space-y-1"><Label htmlFor="comfy-output-field">输出字段</Label><Input id="comfy-output-field" value={editor.draft.metadata.primaryOutput.field} onChange={(event) => updateMetadata({ primaryOutput: { ...editor.draft.metadata.primaryOutput, field: event.target.value } })} className="font-mono" /></div>
                                    <div className="space-y-1"><Label htmlFor="comfy-output-index">序号</Label><Input id="comfy-output-index" type="number" min={0} value={editor.draft.metadata.primaryOutput.index} onChange={(event) => updateMetadata({ primaryOutput: { ...editor.draft.metadata.primaryOutput, index: Number(event.target.value) } })} /></div>
                                </div>
                            </div>

                            {compatibility && (
                                <div role="status" aria-live="polite" className={cn('rounded-xl border p-3 text-xs', compatibility.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
                                    <p className="font-semibold">{compatibility.ok ? '默认实例兼容' : '发现兼容性问题'}</p>
                                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">{compatibility.baseUrl} · {compatibility.nodeTypeCount} 种节点</p>
                                    {compatibility.missingNodeTypes.length > 0 && <p className="mt-2">缺失节点：{compatibility.missingNodeTypes.join('、')}</p>}
                                    {compatibility.missingRequiredInputs.map((item) => <p key={`missing-${item.nodeId}-${item.input}`} className="mt-1">节点 {item.nodeId}（{item.classType}）缺少必填输入 {item.input}</p>)}
                                    {compatibility.incompatibleInputs.map((item) => (
                                        <p key={`${item.nodeId}-${item.input}`} className="mt-1">
                                            节点 {item.nodeId}（{item.classType}）输入 {item.input}
                                            {item.reason ? `：${item.reason}` : ' 未被当前节点识别'}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </aside>
                    </div>
                </section>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                title="删除工作流模板"
                description={`确认删除“${deleteTarget?.name ?? ''}”？历史任务将继续使用自己的模板快照。`}
                confirmText="删除"
                variant="destructive"
                onConfirm={() => void removeTemplate()}
                onCancel={() => setDeleteTarget(null)}
            />
            <ConfirmDialog
                open={pendingWarning !== null}
                title="模板包含可确认警告"
                description={pendingWarning?.warnings.join('；')}
                confirmText="忽略警告并保存"
                onConfirm={() => void pendingWarning?.confirm()}
                onCancel={() => setPendingWarning(null)}
            />
        </div>
    );
}
