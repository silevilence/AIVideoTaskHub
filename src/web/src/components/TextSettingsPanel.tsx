import { useState, useEffect, useCallback } from 'react';
import {
    fetchTextSettings,
    updateTextSettings,
    fetchRemoteModels,
} from '../api';
import type {
    TextSettings,
    TextProviderConfig,
    TextProviderType,
    TextModel,
    PresetProvider,
} from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import {
    Save,
    Check,
    Plus,
    Trash2,
    RefreshCw,
    RotateCcw,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Link2,
    Key,
    Globe,
    Search,
    Maximize2,
    Minimize2,
} from 'lucide-react';

export function TextSettingsPanel() {
    const [settings, setSettings] = useState<TextSettings | null>(null);
    const [editProviders, setEditProviders] = useState<TextProviderConfig[]>([]);
    const [streaming, setStreaming] = useState(false);
    const [promptTemplate, setPromptTemplate] = useState('');
    const [promptLanguage, setPromptLanguage] = useState('中文');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState<'success' | 'error'>('success');
    const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
    const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
    const [remoteModels, setRemoteModels] = useState<Record<string, { id: string; owned_by?: string }[]>>({});
    const [templateWarning, setTemplateWarning] = useState('');
    const [modelSearchQuery, setModelSearchQuery] = useState<Record<string, string>>({});
    const [templateFullscreen, setTemplateFullscreen] = useState(false);

    // 视频提供商名称到 API Key 来源映射
    const VIDEO_PROVIDER_LABELS: Record<string, string> = {
        siliconflow: '硅基流动',
        volcengine: '火山引擎',
        aihubmix: 'AIHubMix',
    };

    const loadSettings = useCallback(async () => {
        try {
            const textData = await fetchTextSettings();
            setSettings(textData);
            setEditProviders(textData.providers);
            setStreaming(textData.streaming);
            setPromptTemplate(textData.promptTemplate);
            setPromptLanguage(textData.promptLanguage);
        } catch {
            setMessage('获取设置失败');
            setMessageType('error');
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    // ── 提供商管理 ──────────────────────────

    const addPresetProvider = (preset: PresetProvider) => {
        if (editProviders.some(p => p.name === preset.name)) return;
        setEditProviders(prev => [...prev, {
            ...preset,
            apiKey: '',
            apiKeySource: 'own',
            models: [],
        }]);
        setExpandedProvider(preset.name);
    };

    const addCustomProvider = (type: TextProviderType) => {
        const name = `custom-${Date.now()}`;
        const defaultBaseUrl = type === 'ollama' ? 'http://localhost:11434' : '';
        setEditProviders(prev => [...prev, {
            name,
            displayName: type === 'ollama' ? 'Ollama' : '新建提供商',
            baseUrl: defaultBaseUrl,
            apiKey: type === 'ollama' ? 'ollama' : '',
            apiKeySource: 'own',
            models: [],
            isPreset: false,
            type,
        }]);
        setExpandedProvider(name);
    };

    const removeProvider = (name: string) => {
        setEditProviders(prev => prev.filter(p => p.name !== name));
        if (expandedProvider === name) setExpandedProvider(null);
    };

    const updateProvider = (name: string, updates: Partial<TextProviderConfig>) => {
        setEditProviders(prev => prev.map(p =>
            p.name === name ? { ...p, ...updates } : p
        ));
    };

    // ── 模型管理 ──────────────────────────

    const addModel = (providerName: string, model: TextModel) => {
        setEditProviders(prev => prev.map(p => {
            if (p.name !== providerName) return p;
            if (p.models.some(m => m.id === model.id)) return p;
            return { ...p, models: [...p.models, model] };
        }));
    };

    const removeModel = (providerName: string, modelId: string) => {
        setEditProviders(prev => prev.map(p => {
            if (p.name !== providerName) return p;
            return { ...p, models: p.models.filter(m => m.id !== modelId) };
        }));
    };

    const updateModel = (providerName: string, modelId: string, updates: Partial<TextModel>) => {
        setEditProviders(prev => prev.map(p => {
            if (p.name !== providerName) return p;
            return {
                ...p,
                models: p.models.map(m => m.id === modelId ? { ...m, ...updates } : m),
            };
        }));
    };

    // ── 远程模型拉取（通过 providerName 让后端解析 API Key）──────────────────────────

    const handleFetchModels = async (providerName: string) => {
        const provider = editProviders.find(p => p.name === providerName);
        if (!provider) return;

        if (!provider.baseUrl) {
            setMessage('需要先填写 Base URL');
            setMessageType('error');
            setTimeout(() => setMessage(''), 3000);
            return;
        }

        setFetchingModels(prev => ({ ...prev, [providerName]: true }));
        try {
            const models = await fetchRemoteModels({
                name: provider.name,
                baseUrl: provider.baseUrl,
                apiKey: provider.apiKey,
                apiKeySource: provider.apiKeySource,
                appCode: provider.appCode,
            });
            setRemoteModels(prev => ({ ...prev, [providerName]: models }));
        } catch (err) {
            setMessage(`获取模型失败: ${(err as Error).message}`);
            setMessageType('error');
            setTimeout(() => setMessage(''), 5000);
        } finally {
            setFetchingModels(prev => ({ ...prev, [providerName]: false }));
        }
    };

    // ── 保存 ──────────────────────────

    const handleSave = async () => {
        setSaving(true);
        setMessage('');
        try {
            await updateTextSettings({
                providers: editProviders,
                streaming,
                promptTemplate,
                promptLanguage,
            });
            setMessage('已保存');
            setMessageType('success');
            setTimeout(() => setMessage(''), 2000);
        } catch (err) {
            setMessage((err as Error).message);
            setMessageType('error');
        } finally {
            setSaving(false);
        }
    };

    const handleResetTemplate = async () => {
        if (!settings) return;
        try {
            await updateTextSettings({ promptTemplate: undefined as unknown as string });
            await loadSettings();
            setMessage('已恢复默认模板');
            setMessageType('success');
            setTimeout(() => setMessage(''), 2000);
        } catch {
            setPromptTemplate(settings.promptTemplate);
        }
    };

    // 模板校验
    useEffect(() => {
        if (!promptTemplate.includes('${input}')) {
            setTemplateWarning('模板必须包含 ${input} 占位符');
        } else if (!promptTemplate.includes('${lang}')) {
            setTemplateWarning('建议添加 ${lang} 占位符以控制输出语言');
        } else {
            setTemplateWarning('');
        }
    }, [promptTemplate]);

    if (!settings) {
        return <div className="text-center text-muted-foreground py-8">加载中...</div>;
    }

    const unusedPresets = settings.presetProviders.filter(
        pp => !editProviders.some(ep => ep.name === pp.name)
    );

    return (
        <div className="space-y-6 pb-16">
            {/* ── 文本提供商配置 ────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Key className="h-4 w-4 text-primary" />
                        文本提供商
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* 添加按钮 */}
                    <div className="flex flex-wrap gap-2">
                        {unusedPresets.map(preset => (
                            <Button
                                key={preset.name}
                                variant="outline"
                                size="sm"
                                onClick={() => addPresetProvider(preset)}
                            >
                                <Plus className="h-3 w-3 mr-1" />
                                {preset.displayName}
                            </Button>
                        ))}
                        <Button variant="outline" size="sm" onClick={() => addCustomProvider('openai')}>
                            <Plus className="h-3 w-3 mr-1" />
                            自定义 (OpenAI 兼容)
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => addCustomProvider('ollama')}>
                            <Plus className="h-3 w-3 mr-1" />
                            Ollama
                        </Button>
                    </div>

                    {editProviders.length === 0 && (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            暂未配置文本提供商，请点击上方按钮添加
                        </p>
                    )}

                    {/* 提供商列表 */}
                    {editProviders.map(provider => {
                        const isExpanded = expandedProvider === provider.name;
                        const isOllama = provider.type === 'ollama';
                        return (
                            <div key={provider.name} className="border rounded-lg overflow-hidden">
                                {/* 展开/收起头部 */}
                                <button
                                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer"
                                    onClick={() => setExpandedProvider(isExpanded ? null : provider.name)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{provider.displayName}</span>
                                        {provider.isPreset && (
                                            <Badge variant="secondary" className="text-xs py-0 h-5">预置</Badge>
                                        )}
                                        {isOllama && (
                                            <Badge variant="secondary" className="text-xs py-0 h-5">Ollama</Badge>
                                        )}
                                        {provider.models.length > 0 && (
                                            <Badge variant="secondary" className="text-xs py-0 h-5">
                                                {provider.models.length} 模型
                                            </Badge>
                                        )}
                                        {!provider.apiKey && provider.apiKeySource === 'own' && !isOllama && (
                                            <Badge variant="destructive" className="text-xs py-0 h-5">未配置</Badge>
                                        )}
                                    </div>
                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>

                                {isExpanded && (
                                    <div className="px-4 pb-4 space-y-4 border-t">
                                        {/* 基本设置 */}
                                        <div className="grid gap-3 pt-3">
                                            {!provider.isPreset && (
                                                <>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">显示名称</Label>
                                                        <Input
                                                            value={provider.displayName}
                                                            onChange={e => updateProvider(provider.name, { displayName: e.target.value })}
                                                            placeholder="提供商名称"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">Base URL</Label>
                                                        <Input
                                                            value={provider.baseUrl}
                                                            onChange={e => updateProvider(provider.name, { baseUrl: e.target.value })}
                                                            placeholder={isOllama ? 'http://localhost:11434' : 'https://api.example.com'}
                                                        />
                                                    </div>
                                                </>
                                            )}

                                            {provider.isPreset && (
                                                <div className="space-y-1 pt-3">
                                                    <Label className="text-xs">Base URL</Label>
                                                    <Input value={provider.baseUrl} disabled className="opacity-60" />
                                                </div>
                                            )}

                                            {/* API Key 来源 - Ollama 不需要 */}
                                            {!isOllama && (
                                                <>
                                                    <div className="space-y-1">
                                                        <Label className="text-xs">API Key 来源</Label>
                                                        <div className="flex gap-2">
                                                            <select
                                                                className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                                                                value={provider.apiKeySource}
                                                                onChange={e => updateProvider(provider.name, {
                                                                    apiKeySource: e.target.value,
                                                                    apiKey: e.target.value === 'own' ? provider.apiKey : '',
                                                                })}
                                                            >
                                                                <option value="own">独立配置</option>
                                                                {Object.entries(VIDEO_PROVIDER_LABELS).map(([key, label]) => (
                                                                    <option key={key} value={`video:${key}`}>
                                                                        复用视频设置 - {label}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        {provider.apiKeySource.startsWith('video:') && (
                                                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                                                <Link2 className="h-3 w-3" />
                                                                将使用视频提供商 {VIDEO_PROVIDER_LABELS[provider.apiKeySource.slice(6)] || provider.apiKeySource.slice(6)} 的 API Key
                                                            </p>
                                                        )}
                                                    </div>

                                                    {provider.apiKeySource === 'own' && (
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">API Key</Label>
                                                            <Input
                                                                type="password"
                                                                value={provider.apiKey}
                                                                onChange={e => updateProvider(provider.name, { apiKey: e.target.value })}
                                                                placeholder="输入 API Key"
                                                            />
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>

                                        {/* 模型管理 */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-medium">已选模型</Label>
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleFetchModels(provider.name)}
                                                        disabled={fetchingModels[provider.name]}
                                                    >
                                                        <RefreshCw className={`h-3 w-3 mr-1 ${fetchingModels[provider.name] ? 'animate-spin' : ''}`} />
                                                        {fetchingModels[provider.name] ? '获取中...' : '拉取模型'}
                                                    </Button>
                                                </div>
                                            </div>

                                            {/* 已选模型列表 */}
                                            {provider.models.length === 0 && (
                                                <p className="text-xs text-muted-foreground py-2">
                                                    暂无模型，请点击「拉取模型」或手动添加
                                                </p>
                                            )}
                                            {provider.models.map(model => (
                                                <div key={model.id} className="flex items-center gap-2 text-xs bg-accent/30 rounded px-2 py-1.5">
                                                    <span className="flex-1 font-mono truncate" title={model.id}>{model.id}</span>
                                                    <Input
                                                        className="h-7 w-32 text-xs"
                                                        value={model.displayName}
                                                        onChange={e => updateModel(provider.name, model.id, { displayName: e.target.value })}
                                                        placeholder="显示名称"
                                                    />
                                                    <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                                                        <input
                                                            type="checkbox"
                                                            checked={model.reasoning}
                                                            onChange={e => updateModel(provider.name, model.id, { reasoning: e.target.checked })}
                                                        />
                                                        推理
                                                    </label>
                                                    <button
                                                        onClick={() => removeModel(provider.name, model.id)}
                                                        className="text-destructive hover:text-destructive/80 cursor-pointer"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}

                                            {/* 手动添加模型 */}
                                            <ManualModelAdd onAdd={(model) => addModel(provider.name, model)} />

                                            {/* 远程模型选择（带搜索） */}
                                            {remoteModels[provider.name] && remoteModels[provider.name].length > 0 && (
                                                <RemoteModelPicker
                                                    models={remoteModels[provider.name]}
                                                    selectedModels={provider.models}
                                                    searchQuery={modelSearchQuery[provider.name] || ''}
                                                    onSearchChange={q => setModelSearchQuery(prev => ({ ...prev, [provider.name]: q }))}
                                                    onAdd={m => addModel(provider.name, m)}
                                                />
                                            )}
                                        </div>

                                        {/* 删除提供商 */}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => removeProvider(provider.name)}
                                        >
                                            <Trash2 className="h-3 w-3 mr-1" />
                                            移除此提供商
                                        </Button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </CardContent>
            </Card>

            {/* ── 全局偏好 ────────────────────── */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Globe className="h-4 w-4 text-primary" />
                        全局偏好
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={streaming}
                                onChange={e => setStreaming(e.target.checked)}
                            />
                            <span className="text-sm">流式输出</span>
                        </label>
                        <span className="text-xs text-muted-foreground">
                            开启后 AI 优化结果将逐字显示
                        </span>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">Prompt 输出语言（全局默认）</Label>
                        <Input
                            value={promptLanguage}
                            onChange={e => setPromptLanguage(e.target.value)}
                            placeholder="中文"
                            className="max-w-xs"
                        />
                        <p className="text-xs text-muted-foreground">
                            控制 AI 优化后输出的语言（替换模板中的 {'${lang}'} 占位符）。
                            此处设置为全局默认值，如需为某个视频模型单独指定语言，
                            可在「创建任务」页面使用 AI 优化时选择。
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* ── Prompt 模板 ────────────────────── */}
            {templateFullscreen && (
                <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col p-6">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-base font-semibold">优化 Prompt 模板</h3>
                        <Button variant="outline" size="sm" onClick={() => setTemplateFullscreen(false)}>
                            <Minimize2 className="h-4 w-4 mr-1" />
                            退出全屏
                        </Button>
                    </div>
                    <Textarea
                        value={promptTemplate}
                        onChange={e => setPromptTemplate(e.target.value)}
                        className="flex-1 font-mono text-xs resize-none"
                        placeholder="输入 Prompt 模板..."
                    />
                    {templateWarning && (
                        <p className={`text-xs flex items-center gap-1 mt-2 ${
                            !promptTemplate.includes('${input}') ? 'text-destructive' : 'text-amber-500'
                        }`}>
                            <AlertTriangle className="h-3 w-3" />
                            {templateWarning}
                        </p>
                    )}
                </div>
            )}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                        <span>优化 Prompt 模板</span>
                        <Button variant="ghost" size="sm" onClick={() => setTemplateFullscreen(true)}>
                            <Maximize2 className="h-4 w-4" />
                        </Button>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={promptTemplate}
                        onChange={e => setPromptTemplate(e.target.value)}
                        className="min-h-64 font-mono text-xs"
                        placeholder="输入 Prompt 模板..."
                    />

                    {templateWarning && (
                        <p className={`text-xs flex items-center gap-1 ${
                            !promptTemplate.includes('${input}') ? 'text-destructive' : 'text-amber-500'
                        }`}>
                            <AlertTriangle className="h-3 w-3" />
                            {templateWarning}
                        </p>
                    )}

                    <p className="text-xs text-muted-foreground">
                        支持的占位符：<code className="bg-accent px-1 rounded">{'${input}'}</code>（用户输入，必需）、
                        <code className="bg-accent px-1 rounded">{'${lang}'}</code>（输出语言，建议）
                    </p>

                    <Button variant="outline" size="sm" onClick={handleResetTemplate}>
                        <RotateCcw className="h-3 w-3 mr-1" />
                        恢复默认模板
                    </Button>
                </CardContent>
            </Card>

            {/* ── 固定保存按钮 ────────────────────── */}
            <div className="fixed bottom-4 right-4 z-40 flex items-center gap-3 bg-card border rounded-lg shadow-lg px-4 py-2">
                {message && (
                    <p className={`text-sm ${messageType === 'error' ? 'text-destructive' : 'text-primary'}`}>
                        {message}
                    </p>
                )}
                <Button
                    onClick={handleSave}
                    disabled={saving || (!!templateWarning && !promptTemplate.includes('${input}'))}
                >
                    {saving ? (
                        <Save className="h-4 w-4 animate-pulse mr-1.5" />
                    ) : message === '已保存' ? (
                        <Check className="h-4 w-4 mr-1.5" />
                    ) : (
                        <Save className="h-4 w-4 mr-1.5" />
                    )}
                    {saving ? '保存中...' : '保存'}
                </Button>
            </div>
        </div>
    );
}

/** 远程模型选择器（带筛选） */
function RemoteModelPicker({ models, selectedModels, searchQuery, onSearchChange, onAdd }: {
    models: { id: string; owned_by?: string }[];
    selectedModels: TextModel[];
    searchQuery: string;
    onSearchChange: (q: string) => void;
    onAdd: (model: TextModel) => void;
}) {
    const filtered = searchQuery
        ? models.filter(m =>
            m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (m.owned_by && m.owned_by.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        : models;

    return (
        <div className="border rounded p-2 space-y-1">
            <div className="flex items-center gap-2 mb-1">
                <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                <Input
                    className="h-7 text-xs"
                    value={searchQuery}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder={`搜索模型（共 ${models.length} 个）...`}
                />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
                {filtered.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2 text-center">无匹配模型</p>
                )}
                {filtered.map(m => {
                    const alreadyAdded = selectedModels.some(pm => pm.id === m.id);
                    return (
                        <button
                            key={m.id}
                            disabled={alreadyAdded}
                            className={`w-full text-left text-xs px-2 py-1 rounded transition-colors cursor-pointer ${alreadyAdded ? 'opacity-40' : 'hover:bg-accent'}`}
                            onClick={() => onAdd({
                                id: m.id,
                                displayName: m.id,
                                reasoning: false,
                            })}
                        >
                            <span className="font-mono">{m.id}</span>
                            {m.owned_by && (
                                <span className="text-muted-foreground ml-2">({m.owned_by})</span>
                            )}
                            {alreadyAdded && <span className="ml-2 text-muted-foreground">✓</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** 手动添加模型的小组件 */
function ManualModelAdd({ onAdd }: { onAdd: (model: TextModel) => void }) {
    const [open, setOpen] = useState(false);
    const [modelId, setModelId] = useState('');
    const [displayName, setDisplayName] = useState('');

    const handleAdd = () => {
        if (!modelId.trim()) return;
        onAdd({
            id: modelId.trim(),
            displayName: displayName.trim() || modelId.trim(),
            reasoning: false,
        });
        setModelId('');
        setDisplayName('');
        setOpen(false);
    };

    if (!open) {
        return (
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setOpen(true)}>
                <Plus className="h-3 w-3 mr-1" />
                手动添加模型
            </Button>
        );
    }

    return (
        <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
                <Label className="text-xs">模型 ID</Label>
                <Input
                    className="h-7 text-xs"
                    value={modelId}
                    onChange={e => setModelId(e.target.value)}
                    placeholder="model-id"
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
            </div>
            <div className="flex-1 space-y-1">
                <Label className="text-xs">显示名称</Label>
                <Input
                    className="h-7 text-xs"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder="可选"
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
            </div>
            <Button size="sm" className="h-7" onClick={handleAdd} disabled={!modelId.trim()}>
                添加
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(false)}>
                取消
            </Button>
        </div>
    );
}
