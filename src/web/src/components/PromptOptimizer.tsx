import { useState, useEffect, useRef, useCallback } from 'react';
import {
    fetchTextSettings,
    optimizePrompt,
    optimizePromptStream,
    abortPromptOptimize,
} from '../api';
import type { TextProviderConfig, TextModel } from '../api';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ConfirmDialog } from './ui/dialog';
import {
    X,
    Sparkles,
    ChevronDown,
    Square,
    RotateCcw,
    Check,
    Loader2,
    AlertTriangle,
} from 'lucide-react';

interface PromptOptimizerProps {
    open: boolean;
    onClose: (adoptedInput?: string) => void;
    initialPrompt: string;
    onAdoptResult: (result: string) => void;
}

type GenerateState = 'idle' | 'generating' | 'done' | 'error';

export function PromptOptimizer({ open, onClose, initialPrompt, onAdoptResult }: PromptOptimizerProps) {
    const [input, setInput] = useState(initialPrompt);
    const [result, setResult] = useState('');
    const [generateState, setGenerateState] = useState<GenerateState>('idle');
    const [error, setError] = useState('');
    const [providers, setProviders] = useState<TextProviderConfig[]>([]);
    const [selectedProvider, setSelectedProvider] = useState('');
    const [selectedModel, setSelectedModel] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [promptLanguage, setPromptLanguage] = useState('中文');
    const [confirmClose, setConfirmClose] = useState(false);
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const abortRef = useRef<{ abort: () => void } | null>(null);
    const inputChangedRef = useRef(false);
    const initialInputRef = useRef(initialPrompt);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // 加载文本设置
    useEffect(() => {
        if (!open) return;
        setInput(initialPrompt);
        setResult('');
        setGenerateState('idle');
        setError('');
        inputChangedRef.current = false;
        initialInputRef.current = initialPrompt;

        fetchTextSettings().then(settings => {
            setProviders(settings.providers);
            setStreaming(settings.streaming);
            setPromptLanguage(settings.promptLanguage || '中文');
            // 自动选中第一个有模型的提供商
            const firstWithModels = settings.providers.find(p => p.models.length > 0);
            if (firstWithModels) {
                setSelectedProvider(firstWithModels.name);
                setSelectedModel(firstWithModels.models[0].id);
            }
        }).catch(() => {
            setError('加载文本设置失败，请先在设置中配置文本提供商');
        });
    }, [open, initialPrompt]);

    // 关闭下拉菜单
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setProviderDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const currentProvider = providers.find(p => p.name === selectedProvider);
    const currentModels = currentProvider?.models || [];

    // 获取扁平化的模型选择列表
    const allModelOptions = providers.flatMap(p =>
        p.models.map(m => ({
            providerName: p.name,
            providerDisplayName: p.displayName,
            model: m,
        }))
    );

    const handleGenerate = useCallback(async () => {
        if (!selectedProvider || !selectedModel || !input.trim()) return;

        setGenerateState('generating');
        setError('');
        setResult('');

        try {
            if (streaming) {
                const handle = await optimizePromptStream(
                    { input: input.trim(), providerName: selectedProvider, modelId: selectedModel, streaming: true, language: promptLanguage },
                    (chunk) => setResult(prev => prev + chunk),
                    () => setGenerateState('done'),
                    (err) => {
                        setError(err.message);
                        setGenerateState('error');
                    },
                );
                abortRef.current = handle;
            } else {
                const resp = await optimizePrompt({
                    input: input.trim(),
                    providerName: selectedProvider,
                    modelId: selectedModel,
                    language: promptLanguage,
                });
                setResult(resp.content);
                setGenerateState('done');
            }
        } catch (err) {
            setError((err as Error).message);
            setGenerateState('error');
        }
    }, [selectedProvider, selectedModel, input, streaming]);

    const handleAbort = () => {
        abortRef.current?.abort();
        abortPromptOptimize().catch(() => {});
        setGenerateState('done');
    };

    const handleAdoptResult = () => {
        onAdoptResult(result);
        onClose();
    };

    const handleClose = () => {
        // 检测输入区是否被手动修改
        if (input !== initialInputRef.current && input.trim() !== initialInputRef.current.trim()) {
            setConfirmClose(true);
        } else {
            onClose();
        }
    };

    const handleConfirmCloseWithInput = () => {
        setConfirmClose(false);
        onClose(input); // 将修改后的 input 回传
    };

    const handleConfirmCloseDiscard = () => {
        setConfirmClose(false);
        onClose();
    };

    if (!open) return null;

    return (
        <>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
                onClick={handleClose}
            >
                <div
                    className="relative w-full max-w-3xl mx-4 max-h-dvh flex flex-col rounded-xl border border-border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95"
                    onClick={e => e.stopPropagation()}
                >
                    {/* ── 头部 ────────────────────── */}
                    <div className="flex items-center justify-between px-5 py-3 border-b">
                        <div className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-primary" />
                            <h3 className="text-base font-semibold">AI 提示词优化</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* 模型快速切换下拉 */}
                            <div className="relative" ref={dropdownRef}>
                                <button
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors cursor-pointer"
                                    onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                >
                                    <span className="max-w-50 truncate">
                                        {currentProvider?.displayName || '选择提供商'} / {currentModels.find(m => m.id === selectedModel)?.displayName || selectedModel || '选择模型'}
                                    </span>
                                    <ChevronDown className="h-3 w-3" />
                                </button>

                                {providerDropdownOpen && allModelOptions.length > 0 && (
                                    <div className="absolute right-0 top-full mt-1 w-72 max-h-64 overflow-y-auto bg-popover border rounded-md shadow-lg z-10">
                                        {allModelOptions.map(opt => (
                                            <button
                                                key={`${opt.providerName}:${opt.model.id}`}
                                                className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors cursor-pointer ${
                                                    opt.providerName === selectedProvider && opt.model.id === selectedModel
                                                        ? 'bg-accent/60'
                                                        : ''
                                                }`}
                                                onClick={() => {
                                                    setSelectedProvider(opt.providerName);
                                                    setSelectedModel(opt.model.id);
                                                    setProviderDropdownOpen(false);
                                                }}
                                            >
                                                <span className="font-medium">{opt.providerDisplayName}</span>
                                                <span className="text-muted-foreground"> / </span>
                                                <span>{opt.model.displayName || opt.model.id}</span>
                                                {opt.model.reasoning && (
                                                    <span className="ml-1 text-amber-500">(推理)</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={handleClose}
                                className="p-1 hover:bg-accent rounded-md transition-colors cursor-pointer"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* ── 内容区 ────────────────────── */}
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                        {/* 无提供商提示 */}
                        {providers.length === 0 && (
                            <div className="flex items-center gap-2 text-sm text-amber-500 bg-amber-500/10 rounded-lg p-3">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                请先在「设置 → 文本设置」中配置至少一个文本提供商和模型
                            </div>
                        )}

                        {/* 无模型提示 */}
                        {providers.length > 0 && allModelOptions.length === 0 && (
                            <div className="flex items-center gap-2 text-sm text-amber-500 bg-amber-500/10 rounded-lg p-3">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                已配置的提供商暂无模型，请在「设置 → 文本设置」中添加模型
                            </div>
                        )}

                        {/* 输入区 */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">原始提示词（输入）</label>
                            <Textarea
                                value={input}
                                onChange={e => {
                                    setInput(e.target.value);
                                    inputChangedRef.current = true;
                                }}
                                className="min-h-25 text-sm"
                                placeholder="输入要优化的提示词..."
                            />
                        </div>

                        {/* 输出语言 */}
                        <div className="flex items-center gap-3">
                            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">输出语言</label>
                            <input
                                className="h-8 w-32 rounded-md border border-input bg-background px-3 text-sm"
                                value={promptLanguage}
                                onChange={e => setPromptLanguage(e.target.value)}
                                placeholder="中文"
                            />
                            <span className="text-xs text-muted-foreground">替换模板中的 {'${lang}'} 占位符</span>
                        </div>

                        {/* 结果区 */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                优化结果
                                {generateState === 'generating' && (
                                    <Loader2 className="inline h-3 w-3 ml-1 animate-spin" />
                                )}
                            </label>
                            <Textarea
                                value={result}
                                onChange={e => setResult(e.target.value)}
                                className="min-h-40 text-sm"
                                placeholder={generateState === 'idle' ? '点击下方按钮开始优化...' : ''}
                                readOnly={generateState === 'generating'}
                            />
                        </div>

                        {/* 错误信息 */}
                        {error && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {error}
                            </p>
                        )}
                    </div>

                    {/* ── 底部操作栏 ────────────────────── */}
                    <div className="flex items-center justify-between px-5 py-3 border-t">
                        <div className="flex gap-2">
                            {generateState === 'generating' ? (
                                <Button variant="outline" size="sm" onClick={handleAbort}>
                                    <Square className="h-3 w-3 mr-1" />
                                    中断
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleGenerate}
                                    disabled={!selectedProvider || !selectedModel || !input.trim() || allModelOptions.length === 0}
                                >
                                    {generateState === 'done' || generateState === 'error' ? (
                                        <RotateCcw className="h-3 w-3 mr-1" />
                                    ) : (
                                        <Sparkles className="h-3 w-3 mr-1" />
                                    )}
                                    {generateState === 'done' || generateState === 'error' ? '重新生成' : '开始优化'}
                                </Button>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleClose}>
                                取消
                            </Button>
                            <Button
                                size="sm"
                                disabled={!result.trim() || generateState === 'generating'}
                                onClick={handleAdoptResult}
                            >
                                <Check className="h-3 w-3 mr-1" />
                                采用结果
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* 关闭确认弹窗 */}
            <ConfirmDialog
                open={confirmClose}
                title="输入内容已修改"
                description="你修改了输入区域的内容，是否用修改后的内容覆盖原输入框？"
                confirmText="覆盖原输入"
                cancelText="放弃修改"
                onConfirm={handleConfirmCloseWithInput}
                onCancel={handleConfirmCloseDiscard}
            />
        </>
    );
}
