import { useState, useEffect, useRef, useCallback } from 'react';
import {
    fetchTextSettings,
    optimizePrompt,
    optimizePromptStream,
    abortPromptOptimize,
    fetchPrompts,
    fetchDefaultPromptId,
    analyzeImages,
    fetchDefaultVisionModel,
} from '../api';
import type { TextProviderConfig, TextModel, Prompt, ImageInfo } from '../api';
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
    BookOpen,
    Image as ImageIcon,
    RefreshCw,
} from 'lucide-react';

interface PromptOptimizerProps {
    open: boolean;
    onClose: (adoptedInput?: string) => void;
    initialPrompt: string;
    onAdoptResult: (result: string) => void;
    initialImages?: ImageInfo[];
}

type GenerateState = 'idle' | 'generating' | 'done' | 'error';

export function PromptOptimizer({ open, onClose, initialPrompt, onAdoptResult, initialImages: propsInitialImages }: PromptOptimizerProps) {
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
    const [promptLibrary, setPromptLibrary] = useState<Prompt[]>([]);
    const [selectedPromptId, setSelectedPromptId] = useState<number | undefined>(undefined);
    const [promptDropdownOpen, setPromptDropdownOpen] = useState(false);
    const abortRef = useRef<{ abort: () => void } | null>(null);
    const inputChangedRef = useRef(false);
    const initialInputRef = useRef(initialPrompt);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const promptDropdownRef = useRef<HTMLDivElement>(null);

    // 图像支持状态
    const initialImages = propsInitialImages || [];
    const [captions, setCaptions] = useState<string[]>([]);
    const [analysisProvider, setAnalysisProvider] = useState('');
    const [analysisModel, setAnalysisModel] = useState('');
    const [analysisPhase, setAnalysisPhase] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
    const [analysisError, setAnalysisError] = useState('');
    const [forceTextOnlyDialog, setForceTextOnlyDialog] = useState(false);

    // 加载文本设置
    useEffect(() => {
        if (!open) return;
        setInput(initialPrompt);
        setResult('');
        setGenerateState('idle');
        setError('');
        inputChangedRef.current = false;
        initialInputRef.current = initialPrompt;
        // 重置分析状态
        setCaptions([]);
        setAnalysisPhase('idle');
        setAnalysisError('');

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

        // 加载 Prompt 库和默认 Prompt
        Promise.all([fetchPrompts(), fetchDefaultPromptId()]).then(([prompts, defaultId]) => {
            setPromptLibrary(prompts);
            if (defaultId !== null) {
                setSelectedPromptId(defaultId);
            }
        }).catch(() => { /* 非致命 */ });

        // 加载默认图像解析模型
        fetchDefaultVisionModel().then(dvm => {
            if (dvm) {
                setAnalysisProvider(dvm.providerName);
                setAnalysisModel(dvm.modelId);
            }
        }).catch(() => {});
    }, [open, initialPrompt]);

    // 关闭下拉菜单
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setProviderDropdownOpen(false);
            }
            if (promptDropdownRef.current && !promptDropdownRef.current.contains(e.target as Node)) {
                setPromptDropdownOpen(false);
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

    // 分析图片（策略 B 前置步骤）
    const handleAnalyzeImages = useCallback(async () => {
        if (!analysisProvider || !analysisModel || initialImages.length === 0) return;

        setAnalysisPhase('analyzing');
        setAnalysisError('');
        setCaptions([]);

        try {
            const result = await analyzeImages({
                images: initialImages.map(img => img.url),
                providerName: analysisProvider,
                modelId: analysisModel,
            });
            setCaptions(result.captions);
            setAnalysisPhase('done');
        } catch (err) {
            setAnalysisError((err as Error).message);
            setAnalysisPhase('error');
        }
    }, [analysisProvider, analysisModel, initialImages]);

    // 核心优化逻辑（可复用）
    const doOptimize = useCallback(async (forceTextOnly: boolean) => {
        setGenerateState('generating');
        setError('');
        setResult('');

        const targetModel = currentModels.find(m => m.id === selectedModel);
        const targetHasVision = targetModel?.vision === true;

        // 策略 B：合并 Captions 到 input
        let finalInput = input.trim();
        if (initialImages.length > 0 && !targetHasVision && captions.length > 0 && !forceTextOnly) {
            const captionLines = initialImages
                .map((img, i) => `${img.label}：${captions[i] || ''}`)
                .filter(line => {
                    const parts = line.split('：');
                    return parts.length >= 2 && parts[1].length > 0;
                });
            if (captionLines.length > 0) {
                finalInput = finalInput + '\n\n---\n' + captionLines.join('\n');
            }
        }

        const useImages = initialImages.length > 0 && targetHasVision && !forceTextOnly;

        const optimizeParams = {
            input: finalInput,
            providerName: selectedProvider,
            modelId: selectedModel,
            language: promptLanguage,
            promptId: selectedPromptId,
            ...(useImages ? { images: initialImages.map(img => img.url) } : {}),
            ...(forceTextOnly && initialImages.length > 0 ? { forceTextOnly: true, images: initialImages.map(img => img.url) } : {}),
        };

        try {
            if (streaming) {
                const handle = await optimizePromptStream(
                    { ...optimizeParams, streaming: true },
                    (chunk) => setResult(prev => prev + chunk),
                    () => setGenerateState('done'),
                    (err) => {
                        setError(err.message);
                        setGenerateState('error');
                    },
                );
                abortRef.current = handle;
            } else {
                const resp = await optimizePrompt(optimizeParams);
                setResult(resp.content);
                setGenerateState('done');
            }
        } catch (err) {
            // 检查是否需要解析图片
            const errMsg = (err as Error).message;
            if (errMsg.includes('ANALYSIS_REQUIRED') || errMsg.includes('请先调用')) {
                // 触发图片解析
                await handleAnalyzeImages();
                return;
            }
            setError(errMsg);
            setGenerateState('error');
        }
    }, [selectedProvider, selectedModel, input, streaming, selectedPromptId, promptLanguage,
        initialImages, captions, currentModels, handleAnalyzeImages]);

    const handleGenerate = useCallback(async () => {
        if (!selectedProvider || !selectedModel || !input.trim()) return;

        const targetModel = currentModels.find(m => m.id === selectedModel);
        const targetHasVision = targetModel?.vision === true;

        // 策略 B：需要先解析图片
        if (initialImages.length > 0 && !targetHasVision && analysisPhase !== 'done') {
            // 检查是否有解析模型
            if (!analysisProvider || !analysisModel) {
                setForceTextOnlyDialog(true);
                return;
            }
            // 先解析
            await handleAnalyzeImages();
            return;
        }

        await doOptimize(false);
    }, [selectedProvider, selectedModel, input, currentModels,
        initialImages, analysisPhase, analysisProvider, analysisModel,
        handleAnalyzeImages, doOptimize]);

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
                            {/* Prompt 模板选择 */}
                            {promptLibrary.length > 0 && (
                                <div className="relative" ref={promptDropdownRef}>
                                    <button
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors cursor-pointer"
                                        onClick={() => setPromptDropdownOpen(!promptDropdownOpen)}
                                    >
                                        <BookOpen className="h-3 w-3" />
                                        <span className="max-w-36 truncate">
                                            {selectedPromptId
                                                ? promptLibrary.find(p => p.id === selectedPromptId)?.name || '选择模板'
                                                : '默认模板'}
                                        </span>
                                        <ChevronDown className="h-3 w-3" />
                                    </button>

                                    {promptDropdownOpen && (
                                        <div className="absolute right-0 top-full mt-1 w-64 max-h-64 overflow-y-auto bg-popover border rounded-md shadow-lg z-10">
                                            <button
                                                className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors cursor-pointer ${
                                                    !selectedPromptId ? 'bg-accent/60' : ''
                                                }`}
                                                onClick={() => {
                                                    setSelectedPromptId(undefined);
                                                    setPromptDropdownOpen(false);
                                                }}
                                            >
                                                <span className="font-medium">默认模板</span>
                                                <span className="text-muted-foreground ml-1">(文本设置中的模板)</span>
                                            </button>
                                            {promptLibrary.map(p => (
                                                <button
                                                    key={p.id}
                                                    className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors cursor-pointer ${
                                                        selectedPromptId === p.id ? 'bg-accent/60' : ''
                                                    }`}
                                                    onClick={() => {
                                                        setSelectedPromptId(p.id);
                                                        setPromptDropdownOpen(false);
                                                    }}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span className="font-medium truncate">{p.name}</span>
                                                        {p.is_system && (
                                                            <span className="text-muted-foreground text-[10px]">(系统)</span>
                                                        )}
                                                    </div>
                                                    {p.tags.length > 0 && (
                                                        <div className="text-muted-foreground mt-0.5">
                                                            {p.tags.join(', ')}
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

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

                        {/* 参考图预览 */}
                        {initialImages.length > 0 && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                    <ImageIcon className="h-3 w-3" />
                                    参考图像（{initialImages.length} 张）
                                </label>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {initialImages.map((img, i) => (
                                        <div key={i} className="relative shrink-0">
                                            <img
                                                src={img.url}
                                                alt={img.label}
                                                className="h-20 w-20 object-cover rounded-md border"
                                            />
                                            <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/60 text-white rounded-b-md py-0.5 truncate">
                                                {img.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 图像解析模型选择器（策略 B） */}
                        {initialImages.length > 0 && currentModels.find(m => m.id === selectedModel)?.vision === false && (
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-muted-foreground">
                                    图像解析模型
                                </label>
                                <div className="flex items-center gap-2">
                                    <select
                                        className={`h-8 flex-1 rounded-md border text-xs px-2 bg-background ${!analysisProvider || !analysisModel ? 'border-destructive' : 'border-input'}`}
                                        value={`${analysisProvider}:${analysisModel}`}
                                        onChange={e => {
                                            const val = e.target.value;
                                            const colonIdx = val.indexOf(':');
                                            const prov = colonIdx >= 0 ? val.slice(0, colonIdx) : '';
                                            const mod = colonIdx >= 0 ? val.slice(colonIdx + 1) : '';
                                            setAnalysisProvider(prov);
                                            setAnalysisModel(mod);
                                            setCaptions([]);
                                            setAnalysisPhase('idle');
                                        }}
                                    >
                                        <option value=":">未选择</option>
                                        {providers.flatMap(p =>
                                            p.models.filter(m => m.vision).map(m => (
                                                <option key={`${p.name}:${m.id}`} value={`${p.name}:${m.id}`}>
                                                    {p.displayName} / {m.displayName || m.id}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                </div>
                                {(!analysisProvider || !analysisModel) ? (
                                    <p className="text-[10px] text-destructive">目标模型不支持视觉，请选择图像解析模型</p>
                                ) : (
                                    <p className="text-[10px] text-muted-foreground">
                                        将先用此模型解析图片，生成描述后再优化
                                    </p>
                                )}
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

                        {/* Caption 编辑区 */}
                        {analysisPhase === 'done' && captions.length > 0 && (
                            <div className="space-y-2 p-3 border rounded-md bg-accent/20">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium">图像解析结果（可编辑）</label>
                                    <button
                                        onClick={handleAnalyzeImages}
                                        className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                        重新解析
                                    </button>
                                </div>
                                {initialImages.map((img, i) => (
                                    <div key={i} className="space-y-1">
                                        <span className="text-[10px] text-muted-foreground">{img.label}</span>
                                        <Textarea
                                            value={captions[i] || ''}
                                            onChange={e => {
                                                const next = [...captions];
                                                next[i] = e.target.value;
                                                setCaptions(next);
                                            }}
                                            className="min-h-12 text-xs"
                                            placeholder="编辑描述..."
                                        />
                                    </div>
                                ))}
                                <div className="text-[10px] text-muted-foreground">
                                    合并预览：{initialImages.map((img, i) => `${img.label}：${captions[i] || '(空)'}`).join('；')}
                                </div>
                            </div>
                        )}
                        {analysisPhase === 'analyzing' && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground p-3">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                正在解析图片...
                            </div>
                        )}
                        {analysisError && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {analysisError}
                            </p>
                        )}

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
                                    disabled={!selectedProvider || !selectedModel || !input.trim() || allModelOptions.length === 0 ||
                                        (initialImages.length > 0 &&
                                         currentModels.find(m => m.id === selectedModel)?.vision === false &&
                                         analysisPhase === 'analyzing')}
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

            {/* 强制纯文本确认弹窗 */}
            <ConfirmDialog
                open={forceTextOnlyDialog}
                title="缺少图像解析模型"
                description="目标模型不支持直接分析图片，且未配置图像解析模型。「强制继续」将以纯文本模式优化（图片信息将被忽略）。"
                confirmText="强制继续"
                cancelText="取消"
                onConfirm={() => {
                    setForceTextOnlyDialog(false);
                    doOptimize(true);
                }}
                onCancel={() => setForceTextOnlyDialog(false)}
            />
        </>
    );
}
