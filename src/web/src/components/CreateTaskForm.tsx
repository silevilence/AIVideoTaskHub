import { useState, useEffect, useMemo } from 'react';
import { fetchProviderModels, fetchProviders, createTask, uploadImage } from '../api';
import type { ProviderInfo } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Card, CardContent } from './ui/card';
import { cn } from '../lib/utils';
import { Sparkles, Upload, X } from 'lucide-react';

// ── 模型显示名称 ────────────────────────────────────
const MODEL_DISPLAY_NAMES: Record<string, string> = {
    // 火山引擎
    'doubao-seedance-1-5-pro-251215': 'Seedance 1.5 Pro',
    'doubao-seedance-1-0-pro-250528': 'Seedance 1.0 Pro',
    'doubao-seedance-1-0-pro-fast-251015': 'Seedance 1.0 Pro Fast',
    'doubao-seedance-1-0-lite-t2v-250428': 'Seedance 1.0 Lite (文生视频)',
    'doubao-seedance-1-0-lite-i2v-250428': 'Seedance 1.0 Lite (图生视频)',
    // SiliconFlow
    'Wan-AI/Wan2.2-T2V-A14B': 'Wan2.2 文生视频',
    'Wan-AI/Wan2.2-I2V-A14B': 'Wan2.2 图生视频',
};

function getModelDisplayName(modelId: string): string {
    return MODEL_DISPLAY_NAMES[modelId] ?? modelId;
}

// ── 火山引擎模型能力矩阵 ────────────────────────────
interface VolcModelCapabilities {
    /** 支持图生视频（首帧） */
    i2v: boolean;
    /** 支持首尾帧 */
    firstLastFrame: boolean;
    /** 支持参考图 */
    referenceImage: boolean;
    /** 支持生成音频 */
    audio: boolean;
    /** 支持固定镜头 */
    cameraFixed: boolean;
    /** 支持样片模式 */
    draft: boolean;
    /** 支持的分辨率 */
    resolutions: string[];
    /** 支持的时长范围 [min, max]，-1 表示支持自动 */
    durationRange: [number, number];
    /** 支持自动时长 (-1) */
    autoDuration: boolean;
    /** 默认分辨率 */
    defaultResolution: string;
}

const VOLC_MODEL_CAPS: Record<string, VolcModelCapabilities> = {
    'doubao-seedance-1-5-pro-251215': {
        i2v: true,
        firstLastFrame: true,
        referenceImage: false,
        audio: true,
        cameraFixed: true,
        draft: true,
        resolutions: ['480p', '720p', '1080p'],
        durationRange: [4, 12],
        autoDuration: true,
        defaultResolution: '720p',
    },
    'doubao-seedance-1-0-pro-250528': {
        i2v: true,
        firstLastFrame: true,
        referenceImage: false,
        audio: false,
        cameraFixed: true,
        draft: false,
        resolutions: ['480p', '720p', '1080p'],
        durationRange: [2, 12],
        autoDuration: false,
        defaultResolution: '1080p',
    },
    'doubao-seedance-1-0-pro-fast-251015': {
        i2v: true,
        firstLastFrame: false,
        referenceImage: false,
        audio: false,
        cameraFixed: true,
        draft: false,
        resolutions: ['480p', '720p', '1080p'],
        durationRange: [2, 12],
        autoDuration: false,
        defaultResolution: '1080p',
    },
    'doubao-seedance-1-0-lite-t2v-250428': {
        i2v: false,
        firstLastFrame: false,
        referenceImage: false,
        audio: false,
        cameraFixed: true,
        draft: false,
        resolutions: ['480p', '720p'],
        durationRange: [2, 12],
        autoDuration: false,
        defaultResolution: '720p',
    },
    'doubao-seedance-1-0-lite-i2v-250428': {
        i2v: true,
        firstLastFrame: true,
        referenceImage: true,
        audio: false,
        cameraFixed: false,
        draft: false,
        resolutions: ['480p', '720p'],
        durationRange: [2, 12],
        autoDuration: false,
        defaultResolution: '720p',
    },
};

const VOLC_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];

// 非火山引擎的图生视频模型判断
function isSiliconFlowI2V(model: string): boolean {
    return /I2V/i.test(model);
}

export function CreateTaskForm({ onCreated }: { onCreated: () => void }) {
    const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
    const [providerInfos, setProviderInfos] = useState<ProviderInfo[]>([]);
    const [provider, setProvider] = useState('');
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

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
    const models = provider ? (providerModels[provider] ?? []) : [];
    const isVolc = provider === 'volcengine';
    const caps = isVolc ? VOLC_MODEL_CAPS[model] : undefined;

    // 是否显示首帧图片上传（火山引擎由 volcImageMode 控制）
    const showImageInput = useMemo(() => {
        if (isVolc) {
            return volcImageMode === 'first_frame' || volcImageMode === 'first_last_frame';
        }
        return isSiliconFlowI2V(model);
    }, [isVolc, volcImageMode, model]);

    // 是否显示参考图上传
    const showRefImageInput = isVolc && volcImageMode === 'reference';

    // 火山引擎可选的生成模式
    const volcImageModes = useMemo(() => {
        if (!caps) return [];
        const modes: { value: string; label: string }[] = [];
        modes.push({ value: 'text_to_video', label: '文生视频' });
        if (caps.i2v) modes.push({ value: 'first_frame', label: '首帧图生视频' });
        if (caps.firstLastFrame) modes.push({ value: 'first_last_frame', label: '首尾帧图生视频' });
        if (caps.referenceImage) modes.push({ value: 'reference', label: '参考图生视频 (1-4张)' });
        return modes;
    }, [caps]);

    useEffect(() => {
        Promise.all([fetchProviderModels(), fetchProviders()])
            .then(([data, infos]) => {
                setProviderModels(data);
                setProviderInfos(infos);
                const names = Object.keys(data).filter((p) => p !== 'mock');
                if (names.length > 0 && !provider) {
                    setProvider(names[0]);
                    if (data[names[0]].length > 0) setModel(data[names[0]][0]);
                }
            })
            .catch(() => setError('获取 Provider 列表失败'));
    }, []);

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
        const firstModel = m.length > 0 ? m[0] : '';
        setModel(firstModel);
        resetVolcState();
        // 设置默认分辨率
        if (name === 'volcengine' && firstModel) {
            const c = VOLC_MODEL_CAPS[firstModel];
            if (c) setVolcResolution(c.defaultResolution);
        }
    };

    const handleModelChange = (m: string) => {
        setModel(m);
        resetVolcState();
        if (isVolc) {
            const c = VOLC_MODEL_CAPS[m];
            if (c) setVolcResolution(c.defaultResolution);
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
            if (isVolc && caps) {
                extra.ratio = volcRatio;
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
                extra: isVolc ? extra : undefined,
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
                                <select
                                    id="provider"
                                    value={provider}
                                    onChange={(e) =>
                                        handleProviderChange(e.target.value)
                                    }
                                    className={selectClass}
                                >
                                    {providers.map((p) => {
                                        const info = providerInfos.find((i) => i.name === p);
                                        return (
                                            <option key={p} value={p}>
                                                {info?.displayName ?? p}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="model">模型</Label>
                                <select
                                    id="model"
                                    value={model}
                                    onChange={(e) =>
                                        handleModelChange(e.target.value)
                                    }
                                    className={selectClass}
                                >
                                    {models.map((m) => (
                                        <option key={m} value={m}>
                                            {getModelDisplayName(m)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* 火山引擎：生成模式选择 */}
                        {isVolc && volcImageModes.length > 1 && (
                            <div className="space-y-2">
                                <Label>生成模式</Label>
                                <div className="flex flex-wrap gap-2">
                                    {volcImageModes.map((mode) => (
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

                        {/* 火山引擎：尾帧图片 (首尾帧模式) */}
                        {isVolc && volcImageMode === 'first_last_frame' && caps?.firstLastFrame && (
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

                        {/* 火山引擎：视频参数 */}
                        {isVolc && caps && (
                            <div className="space-y-3">
                                <Label className="text-muted-foreground text-xs">视频参数</Label>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {/* 宽高比 */}
                                    <div className="space-y-1.5">
                                        <Label htmlFor="volc-ratio">宽高比</Label>
                                        <select
                                            id="volc-ratio"
                                            value={volcRatio}
                                            onChange={(e) => setVolcRatio(e.target.value)}
                                            className={selectClass}
                                        >
                                            {VOLC_RATIOS.map((r) => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    </div>
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
                                            <span className="text-muted-foreground text-[10px] ml-1">
                                                {caps.durationRange[0]}-{caps.durationRange[1]}
                                            </span>
                                        </Label>
                                        {volcAutoDuration ? (
                                            <div className="flex h-10 items-center text-sm text-muted-foreground px-1">自动</div>
                                        ) : (
                                            <Input
                                                id="volc-duration"
                                                type="number"
                                                min={caps.durationRange[0]}
                                                max={caps.durationRange[1]}
                                                value={volcDuration}
                                                onChange={(e) => setVolcDuration(e.target.value)}
                                            />
                                        )}
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

                                {/* 服务等级 (暂不支持切换) */}
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

                        <Button
                            type="submit"
                            className="w-full"
                            disabled={submitting || !prompt.trim()}
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
