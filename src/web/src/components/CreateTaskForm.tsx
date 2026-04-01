import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchProviderModels, fetchProviders, createTask, uploadImage, fetchSettings } from '../api';
import type { ProviderInfo, ProviderSettings, ModelInfo, ModelCapabilities } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Card, CardContent } from './ui/card';
import { cn } from '../lib/utils';
import { Sparkles, Upload, X, ChevronDown, AlertTriangle } from 'lucide-react';
import siliconflowIcon from '../assets/icons/siliconflow.png';
import volcengineIcon from '../assets/icons/volcengine.png';
import aihubmixIcon from '../assets/icons/aihubmix.png';

const PROVIDER_ICONS: Record<string, string> = {
    siliconflow: siliconflowIcon,
    volcengine: volcengineIcon,
    aihubmix: aihubmixIcon,
};

export function CreateTaskForm({ onCreated }: { onCreated: () => void }) {
    const [providerModels, setProviderModels] = useState<Record<string, ModelInfo[]>>({});
    const [providerInfos, setProviderInfos] = useState<ProviderInfo[]>([]);
    const [provider, setProvider] = useState('');
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const providerDropdownRef = useRef<HTMLDivElement>(null);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const [allSettings, setAllSettings] = useState<Record<string, ProviderSettings>>({});
    const [settingsWarning, setSettingsWarning] = useState('');

    // 火山引擎专有参数
    const [volcRatio, setVolcRatio] = useState('16:9');
    const [volcResolution, setVolcResolution] = useState('720p');
    const [volcDuration, setVolcDuration] = useState('5');
    const [volcAutoDuration, setVolcAutoDuration] = useState(false);
    const [volcGenerateAudio, setVolcGenerateAudio] = useState(true);
    const [volcLastFrameUrl, setVolcLastFrameUrl] = useState('');
    const [volcLastFramePreview, setVolcLastFramePreview] = useState('');
    const [uploadingLastFrame, setUploadingLastFrame] = useState(false);
    const [volcImageMode, setVolcImageMode] = useState<'text_to_video' | 'first_frame' | 'first_last_frame' | 'reference'>('text_to_video');
    const [volcSeed, setVolcSeed] = useState('');
    const [volcCameraFixed, setVolcCameraFixed] = useState(false);
    const [volcWatermark, setVolcWatermark] = useState(false);
    const [volcServiceTier, setVolcServiceTier] = useState<'default' | 'flex'>('default');
    const [volcDraft, setVolcDraft] = useState(false);
    const [volcReturnLastFrame, setVolcReturnLastFrame] = useState(false);
    // 参考图模式多图 (1-4张)
    const [volcRefImages, setVolcRefImages] = useState<{ url: string; preview: string }[]>([]);
    const [uploadingRefImage, setUploadingRefImage] = useState(false);

    const providers = Object.keys(providerModels).filter((p) => p !== 'mock');
    const models: ModelInfo[] = provider ? (providerModels[provider] ?? []) : [];
    const currentModelInfo = models.find((m) => m.id === model);
    const caps: ModelCapabilities | undefined = currentModelInfo?.capabilities;

    // 当前模型是否有高级能力（有 capabilities 且有实际功能）
    const hasAdvancedCaps = !!(caps && (caps.resolutions.length > 0 || caps.ratios));

    // 是否显示首帧图片上传（由 capabilities 和 volcImageMode 控制）
    const showImageInput = useMemo(() => {
        if (caps?.i2vOnly) return true;
        if (hasAdvancedCaps) {
            return volcImageMode === 'first_frame' || volcImageMode === 'first_last_frame';
        }
        return caps?.i2v ?? false;
    }, [hasAdvancedCaps, volcImageMode, caps]);

    // 是否显示参考图上传
    const showRefImageInput = hasAdvancedCaps && volcImageMode === 'reference';

    // 可选的生成模式
    const imageModes = useMemo(() => {
        if (!caps) return [];
        const modes: { value: string; label: string }[] = [];
        if (!caps.i2vOnly) modes.push({ value: 'text_to_video', label: '文生视频' });
        if (caps.i2v) modes.push({ value: 'first_frame', label: '首帧图生视频' });
        if (caps.firstLastFrame) modes.push({ value: 'first_last_frame', label: '首尾帧图生视频' });
        if (caps.referenceImage) modes.push({ value: 'reference', label: '参考图生视频 (1-4张)' });
        return modes;
    }, [caps]);

    useEffect(() => {
        Promise.all([fetchProviderModels(), fetchProviders(), fetchSettings()])
            .then(([data, infos, settings]) => {
                setProviderModels(data);
                setProviderInfos(infos);
                setAllSettings(settings);
                const names = Object.keys(data).filter((p) => p !== 'mock');
                if (names.length > 0 && !provider) {
                    setProvider(names[0]);
                    if (data[names[0]].length > 0) {
                        const first = data[names[0]].find((m) => !m.disabled) ?? data[names[0]][0];
                        setModel(first.id);
                    }
                }
            })
            .catch(() => setError('获取 Provider 列表失败'));
    }, []);

    // 关闭下拉菜单（点击外部时）
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (providerDropdownRef.current && !providerDropdownRef.current.contains(e.target as Node)) {
                setProviderDropdownOpen(false);
            }
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
                setModelDropdownOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 检查当前 provider 的必填设置是否已配置
    const missingSettings = useMemo(() => {
        if (!provider || !allSettings[provider]) return [];
        const ps = allSettings[provider];
        return ps.schema
            .filter((s) => s.required && !ps.values[s.key])
            .map((s) => s.label);
    }, [provider, allSettings]);

    // 当 provider 变化时更新警告
    useEffect(() => {
        if (missingSettings.length > 0) {
            setSettingsWarning(`请先在设置中配置：${missingSettings.join('、')}`);
        } else {
            setSettingsWarning('');
        }
    }, [missingSettings]);

    const resetVolcState = () => {
        setImageUrl('');
        setPreviewUrl('');
        setVolcLastFrameUrl('');
        setVolcLastFramePreview('');
        setVolcRatio('16:9');
        setVolcDuration('5');
        setVolcAutoDuration(false);
        setVolcGenerateAudio(true);
        setVolcImageMode('text_to_video');
        setVolcSeed('');
        setVolcCameraFixed(false);
        setVolcWatermark(false);
        setVolcServiceTier('default');
        setVolcDraft(false);
        setVolcReturnLastFrame(false);
        setVolcRefImages([]);
    };

    const handleProviderChange = (name: string) => {
        setProvider(name);
        const m = providerModels[name] ?? [];
        const firstModel = m.length > 0 ? (m.find((mi) => !mi.disabled) ?? m[0]).id : '';
        setModel(firstModel);
        resetVolcState();
        // 设置默认分辨率
        if (firstModel) {
            const info = m.find((mi) => mi.id === firstModel);
            if (info?.capabilities?.defaultResolution) {
                setVolcResolution(info.capabilities.defaultResolution);
            }
            if (info?.capabilities?.i2vOnly) {
                setVolcImageMode('first_frame');
            }
        }
    };

    const handleModelChange = (modelId: string) => {
        setModel(modelId);
        resetVolcState();
        const info = models.find((mi) => mi.id === modelId);
        if (info?.capabilities?.defaultResolution) {
            setVolcResolution(info.capabilities.defaultResolution);
        }
        // i2vOnly 模型自动切换到图生视频模式
        if (info?.capabilities?.i2vOnly) {
            setVolcImageMode('first_frame');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setError('');
        try {
            const result = await uploadImage(file);
            setImageUrl(result.base64);
            setPreviewUrl(result.url);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setUploading(false);
        }
    };

    const handleLastFrameUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingLastFrame(true);
        setError('');
        try {
            const result = await uploadImage(file);
            setVolcLastFrameUrl(result.base64);
            setVolcLastFramePreview(result.url);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setUploadingLastFrame(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!provider || !prompt.trim()) return;

        setSubmitting(true);
        setError('');
        try {
            const extra: Record<string, unknown> = {};
            if (hasAdvancedCaps && caps) {
                if (caps.ratios) extra.ratio = volcRatio;
                extra.resolution = volcResolution;
                if (volcAutoDuration && caps.autoDuration) {
                    extra.duration = -1;
                } else {
                    const dur = parseInt(volcDuration, 10);
                    if (!isNaN(dur)) extra.duration = dur;
                }
                if (caps.audio) extra.generateAudio = volcGenerateAudio;
                // seed
                const seedNum = parseInt(volcSeed, 10);
                if (!isNaN(seedNum)) extra.seed = seedNum;
                // 水印
                extra.watermark = volcWatermark;
                // camera_fixed, service_tier, draft 暂不支持，不发送
                // 返回尾帧
                if (volcReturnLastFrame) extra.returnLastFrame = true;
                if (volcImageMode === 'first_last_frame' && volcLastFrameUrl.trim()) {
                    extra.lastFrameImageUrl = volcLastFrameUrl.trim();
                }
                // 参考图模式：使用多图
                if (volcImageMode === 'reference' && volcRefImages.length > 0) {
                    extra.referenceImageUrls = volcRefImages.map(img => img.url);
                }
            }

            const submitImageUrl = (() => {
                if (!showImageInput || !imageUrl.trim()) return undefined;
                return imageUrl.trim();
            })();

            await createTask({
                provider,
                prompt: prompt.trim(),
                model: model.trim() || undefined,
                imageUrl: submitImageUrl,
                extra: hasAdvancedCaps ? extra : undefined,
            });
            setPrompt('');
            resetVolcState();
            setSubmitting(false);
            onCreated();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    const selectClass = cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer',
    );

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h2 className="text-xl font-heading font-bold tracking-wide">
                    创建任务
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                    选择平台和模型，描述你想生成的视频
                </p>
            </div>

            <Card>
                <CardContent className="pt-6">
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* 平台 & 模型 */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="provider">平台</Label>
                                <div className="relative" ref={providerDropdownRef}>
                                    <button
                                        id="provider"
                                        type="button"
                                        onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                        className={cn(selectClass, 'flex items-center justify-between')}
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            {PROVIDER_ICONS[provider] && (
                                                <img src={PROVIDER_ICONS[provider]} alt="" className="h-4 w-4 shrink-0" />
                                            )}
                                            {providerInfos.find((i) => i.name === provider)?.displayName ?? provider}
                                        </span>
                                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </button>
                                    {providerDropdownOpen && (
                                        <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-card shadow-lg overflow-hidden">
                                            {providers.map((p) => {
                                                const info = providerInfos.find((i) => i.name === p);
                                                return (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        onClick={() => {
                                                            handleProviderChange(p);
                                                            setProviderDropdownOpen(false);
                                                        }}
                                                        className={cn(
                                                            'flex items-center gap-2 w-full px-3 py-2.5 text-sm hover:bg-accent cursor-pointer',
                                                            provider === p && 'bg-accent',
                                                        )}
                                                    >
                                                        {PROVIDER_ICONS[p] && (
                                                            <img src={PROVIDER_ICONS[p]} alt="" className="h-4 w-4 shrink-0" />
                                                        )}
                                                        {info?.displayName ?? p}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="model">模型</Label>
                                <div className="relative" ref={modelDropdownRef}>
                                    <button
                                        id="model"
                                        type="button"
                                        onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                                        className={cn(selectClass, 'flex items-center justify-between')}
                                    >
                                        <span className="truncate">
                                            {currentModelInfo?.displayName ?? model}
                                        </span>
                                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </button>
                                    {modelDropdownOpen && (
                                        <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-card shadow-lg overflow-hidden">
                                            <div className="max-h-60 overflow-y-auto">
                                                {models.map((m) => (
                                                    <button
                                                        key={m.id}
                                                        type="button"
                                                        disabled={m.disabled}
                                                        title={m.disabled ? m.disabledReason : undefined}
                                                        onClick={() => {
                                                            if (m.disabled) return;
                                                            handleModelChange(m.id);
                                                            setModelDropdownOpen(false);
                                                        }}
                                                        className={cn(
                                                            'flex items-center justify-between w-full px-3 py-2.5 text-sm',
                                                            m.disabled
                                                                ? 'opacity-50 cursor-not-allowed text-muted-foreground'
                                                                : 'hover:bg-accent cursor-pointer',
                                                            model === m.id && !m.disabled && 'bg-accent',
                                                        )}
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            {m.displayName}
                                                            {m.disabled && (
                                                                <span className="text-[10px] text-orange-500">(不可用)</span>
                                                            )}
                                                        </span>
                                                        {m.displayName !== m.id && (
                                                            <span className="text-[11px] text-muted-foreground ml-2 shrink-0">{m.id}</span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 生成模式选择 */}
                        {hasAdvancedCaps && imageModes.length > 1 && (
                            <div className="space-y-2">
                                <Label>生成模式</Label>
                                <div className="flex flex-wrap gap-2">
                                    {imageModes.map((mode) => (
                                        <button
                                            key={mode.value}
                                            type="button"
                                            onClick={() => {
                                                setVolcImageMode(mode.value as typeof volcImageMode);
                                                setImageUrl('');
                                                setPreviewUrl('');
                                                setVolcLastFrameUrl('');
                                                setVolcLastFramePreview('');
                                                setVolcRefImages([]);
                                                // 切换到图生视频模式时，若有 i2vDurationOptions，自动设置时长
                                                const isI2v = mode.value === 'first_frame' || mode.value === 'first_last_frame';
                                                if (isI2v && caps?.i2vDurationOptions?.length) {
                                                    setVolcDuration(String(caps.i2vDurationOptions[0]));
                                                } else if (caps?.durationOptions?.length) {
                                                    setVolcDuration(String(caps.durationOptions[0]));
                                                }
                                            }}
                                            className={cn(
                                                'inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                                                volcImageMode === mode.value
                                                    ? 'bg-primary/15 text-primary border-primary/30'
                                                    : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80',
                                            )}
                                        >
                                            {mode.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 首帧图片上传 */}
                        {showImageInput && (
                            <div className="space-y-2">
                                <Label>
                                    首帧图片{' '}
                                    <span className="text-muted-foreground">(图生视频)</span>
                                </Label>
                                <div className="flex gap-2 items-center">
                                    <Input
                                        value={
                                            imageUrl.startsWith('data:')
                                                ? '(已上传本地图片)'
                                                : imageUrl
                                        }
                                        onChange={(e) => {
                                            setImageUrl(e.target.value);
                                            setPreviewUrl('');
                                        }}
                                        readOnly={imageUrl.startsWith('data:')}
                                        placeholder="输入图片 URL 或上传本地图片"
                                    />
                                    <label
                                        className={cn(
                                            'inline-flex items-center justify-center h-10 px-3 text-sm rounded-md border border-input shrink-0 whitespace-nowrap',
                                            'bg-transparent cursor-pointer transition-colors duration-200',
                                            'hover:bg-accent hover:text-accent-foreground',
                                            uploading &&
                                                'opacity-50 pointer-events-none',
                                        )}
                                    >
                                        <Upload className="h-4 w-4 mr-1.5" />
                                        {uploading ? '上传中...' : '上传'}
                                        <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/webp"
                                            onChange={handleFileUpload}
                                            disabled={uploading}
                                            className="hidden"
                                        />
                                    </label>
                                </div>
                                {(previewUrl ||
                                    (imageUrl &&
                                        !imageUrl.startsWith('data:'))) && (
                                    <div className="flex items-center gap-3 mt-2">
                                        <img
                                            src={previewUrl || imageUrl}
                                            alt="预览"
                                            className="h-20 rounded-lg border border-border object-cover"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setImageUrl('');
                                                setPreviewUrl('');
                                            }}
                                        >
                                            <X className="h-4 w-4 mr-1" /> 移除
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 尾帧图片 (首尾帧模式) */}
                        {volcImageMode === 'first_last_frame' && caps?.firstLastFrame && (
                            <div className="space-y-2">
                                <Label>
                                    尾帧图片{' '}
                                    <span className="text-muted-foreground">(首尾帧模式)</span>
                                </Label>
                                <div className="flex gap-2 items-center">
                                    <Input
                                        value={
                                            volcLastFrameUrl.startsWith('data:')
                                                ? '(已上传本地图片)'
                                                : volcLastFrameUrl
                                        }
                                        onChange={(e) => {
                                            setVolcLastFrameUrl(e.target.value);
                                            setVolcLastFramePreview('');
                                        }}
                                        readOnly={volcLastFrameUrl.startsWith('data:')}
                                        placeholder="输入尾帧图片 URL 或上传本地图片"
                                    />
                                    <label
                                        className={cn(
                                            'inline-flex items-center justify-center h-10 px-3 text-sm rounded-md border border-input shrink-0 whitespace-nowrap',
                                            'bg-transparent cursor-pointer transition-colors duration-200',
                                            'hover:bg-accent hover:text-accent-foreground',
                                            uploadingLastFrame && 'opacity-50 pointer-events-none',
                                        )}
                                    >
                                        <Upload className="h-4 w-4 mr-1.5" />
                                        {uploadingLastFrame ? '上传中...' : '上传'}
                                        <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/webp"
                                            onChange={handleLastFrameUpload}
                                            disabled={uploadingLastFrame}
                                            className="hidden"
                                        />
                                    </label>
                                </div>
                                {(volcLastFramePreview || (volcLastFrameUrl && !volcLastFrameUrl.startsWith('data:'))) && (
                                    <div className="flex items-center gap-3 mt-2">
                                        <img
                                            src={volcLastFramePreview || volcLastFrameUrl}
                                            alt="尾帧预览"
                                            className="h-20 rounded-lg border border-border object-cover"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setVolcLastFrameUrl('');
                                                setVolcLastFramePreview('');
                                            }}
                                        >
                                            <X className="h-4 w-4 mr-1" /> 移除
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 火山引擎：参考图上传 (1-4张) */}
                        {showRefImageInput && (
                            <div className="space-y-2">
                                <Label>
                                    参考图片{' '}
                                    <span className="text-muted-foreground">
                                        ({volcRefImages.length}/4 张)
                                    </span>
                                </Label>
                                {/* 已上传的图片网格 */}
                                {volcRefImages.length > 0 && (
                                    <div className="flex flex-wrap gap-3">
                                        {volcRefImages.map((img, idx) => (
                                            <div key={idx} className="relative group">
                                                <img
                                                    src={img.preview || img.url}
                                                    alt={`参考图 ${idx + 1}`}
                                                    className="h-20 w-20 rounded-lg border border-border object-cover"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setVolcRefImages(prev => prev.filter((_, i) => i !== idx))}
                                                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                                <span className="absolute bottom-0.5 left-0.5 text-[10px] bg-background/80 rounded px-1">
                                                    [图{idx + 1}]
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {/* 添加按钮 */}
                                {volcRefImages.length < 4 && (
                                    <label
                                        className={cn(
                                            'inline-flex items-center justify-center h-10 px-4 text-sm rounded-md border border-dashed border-input',
                                            'bg-transparent cursor-pointer transition-colors duration-200',
                                            'hover:bg-accent hover:text-accent-foreground',
                                            uploadingRefImage && 'opacity-50 pointer-events-none',
                                        )}
                                    >
                                        <Upload className="h-4 w-4 mr-1.5" />
                                        {uploadingRefImage ? '上传中...' : '添加参考图'}
                                        <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/gif,image/webp"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingRefImage(true);
                                                setError('');
                                                try {
                                                    const result = await uploadImage(file);
                                                    setVolcRefImages(prev => [...prev, { url: result.base64, preview: result.url }]);
                                                } catch (err) {
                                                    setError((err as Error).message);
                                                } finally {
                                                    setUploadingRefImage(false);
                                                    e.target.value = '';
                                                }
                                            }}
                                            disabled={uploadingRefImage}
                                            className="hidden"
                                        />
                                    </label>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    提示词中可用 [图1]、[图2] 等指定图片，如："[图1]的人物走在[图2]的街道上"
                                </p>
                            </div>
                        )}

                        {/* 视频参数 */}
                        {hasAdvancedCaps && caps && (
                            <div className="space-y-3">
                                <Label className="text-muted-foreground text-xs">视频参数</Label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {/* 宽高比 */}
                                    {caps.ratios && caps.ratios.length > 0 && (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="volc-ratio">宽高比</Label>
                                        <select
                                            id="volc-ratio"
                                            value={volcRatio}
                                            onChange={(e) => setVolcRatio(e.target.value)}
                                            className={selectClass}
                                        >
                                            {caps.ratios.map((r) => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    </div>
                                    )}
                                    {/* 分辨率 */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="volc-resolution">分辨率</Label>
                                        <select
                                            id="volc-resolution"
                                            value={volcResolution}
                                            onChange={(e) => setVolcResolution(e.target.value)}
                                            className={selectClass}
                                        >
                                            {caps.resolutions.map((r) => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* 时长 */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="volc-duration">
                                            时长(秒)
                                            {!caps.durationOptions && (
                                                <span className="text-muted-foreground text-[10px] ml-1">
                                                    {caps.durationRange[0]}-{caps.durationRange[1]}
                                                </span>
                                            )}
                                        </Label>
                                        {volcAutoDuration ? (
                                            <div className="flex h-10 items-center text-sm text-muted-foreground px-1">自动</div>
                                        ) : (() => {
                                            // 图生视频模式下优先使用 i2vDurationOptions
                                            const isI2vMode = showImageInput || volcImageMode === 'first_frame' || volcImageMode === 'first_last_frame';
                                            const activeOptions = (isI2vMode && caps.i2vDurationOptions) ? caps.i2vDurationOptions : caps.durationOptions;
                                            if (activeOptions) {
                                                return (
                                                    <select
                                                        id="volc-duration"
                                                        value={volcDuration}
                                                        onChange={(e) => setVolcDuration(e.target.value)}
                                                        className={selectClass}
                                                    >
                                                        {activeOptions.map((d) => (
                                                            <option key={d} value={String(d)}>{d}秒</option>
                                                        ))}
                                                    </select>
                                                );
                                            }
                                            return (
                                                <Input
                                                    id="volc-duration"
                                                    type="number"
                                                    min={caps.durationRange[0]}
                                                    max={caps.durationRange[1]}
                                                    value={volcDuration}
                                                    onChange={(e) => setVolcDuration(e.target.value)}
                                                />
                                            );
                                        })()}
                                        {caps.autoDuration && (
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={volcAutoDuration}
                                                    onChange={(e) => setVolcAutoDuration(e.target.checked)}
                                                    className="h-3.5 w-3.5 rounded border-input accent-primary"
                                                />
                                                <span className="text-xs text-muted-foreground">自动时长</span>
                                            </label>
                                        )}
                                    </div>
                                    {/* Seed */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="volc-seed">
                                            Seed
                                            <span className="text-muted-foreground text-[10px] ml-1">可选</span>
                                        </Label>
                                        <Input
                                            id="volc-seed"
                                            type="number"
                                            min={-1}
                                            placeholder="随机"
                                            value={volcSeed}
                                            onChange={(e) => setVolcSeed(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {/* 第二行：开关类参数 */}
                                <div className="flex flex-wrap gap-x-5 gap-y-2">
                                    {/* 生成音频 */}
                                    {caps.audio && (
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={volcGenerateAudio}
                                                onChange={(e) => setVolcGenerateAudio(e.target.checked)}
                                                className="h-4 w-4 rounded border-input accent-primary"
                                            />
                                            <span className="text-sm">生成音频</span>
                                        </label>
                                    )}
                                    {/* 固定镜头 (暂不支持) */}
                                    {caps.cameraFixed && (
                                        <label className="flex items-center gap-2 cursor-not-allowed opacity-50" title="暂不支持">
                                            <input
                                                type="checkbox"
                                                checked={false}
                                                disabled
                                                className="h-4 w-4 rounded border-input accent-primary"
                                            />
                                            <span className="text-sm">固定镜头</span>
                                            <span className="text-[10px] text-muted-foreground">(暂不支持)</span>
                                        </label>
                                    )}
                                    {/* 以下选项仅火山引擎可用 */}
                                    {provider === 'volcengine' && (
                                        <>
                                            {/* 水印 */}
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={volcWatermark}
                                                    onChange={(e) => setVolcWatermark(e.target.checked)}
                                                    className="h-4 w-4 rounded border-input accent-primary"
                                                />
                                                <span className="text-sm">水印</span>
                                            </label>
                                            {/* 返回尾帧 */}
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={volcReturnLastFrame}
                                                    onChange={(e) => setVolcReturnLastFrame(e.target.checked)}
                                                    className="h-4 w-4 rounded border-input accent-primary"
                                                />
                                                <span className="text-sm">返回尾帧</span>
                                            </label>
                                        </>
                                    )}
                                    {/* 样片模式 (暂不支持) */}
                                    {caps.draft && (
                                        <label className="flex items-center gap-2 cursor-not-allowed opacity-50" title="暂不支持">
                                            <input
                                                type="checkbox"
                                                checked={false}
                                                disabled
                                                className="h-4 w-4 rounded border-input accent-primary"
                                            />
                                            <span className="text-sm">样片模式</span>
                                            <span className="text-[10px] text-muted-foreground">(暂不支持)</span>
                                        </label>
                                    )}
                                </div>

                                {/* 服务等级 (仅火山引擎，暂不支持切换) */}
                                {provider === 'volcengine' && (
                                <div className="flex items-center gap-3 opacity-50" title="暂不支持">
                                    <Label className="shrink-0">服务等级</Label>
                                    <div className="flex gap-2">
                                        <span
                                            className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium bg-primary/15 text-primary border-primary/30"
                                        >
                                            在线推理
                                        </span>
                                        <span
                                            className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium bg-muted text-muted-foreground border-transparent"
                                        >
                                            离线推理 (半价)
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">(暂不支持)</span>
                                </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="prompt">Prompt</Label>
                            <Textarea
                                id="prompt"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="描述你想生成的视频内容..."
                                rows={4}
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}

                        {settingsWarning && (
                            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                <p className="text-sm text-amber-500">{settingsWarning}</p>
                            </div>
                        )}

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={submitting || !prompt.trim() || missingSettings.length > 0}
                        >
                            <Sparkles className="h-4 w-4 mr-2" />
                            {submitting ? '提交中...' : '创建任务'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
