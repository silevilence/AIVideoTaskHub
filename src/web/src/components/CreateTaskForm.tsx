import { useState, useEffect } from 'react';
import { fetchProviderModels, fetchProviders, createTask, uploadImage } from '../api';
import type { ProviderInfo } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Card, CardContent } from './ui/card';
import { cn } from '../lib/utils';
import { Sparkles, Upload, X } from 'lucide-react';

function isI2VModel(model: string): boolean {
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

    const providers = Object.keys(providerModels).filter((p) => p !== 'mock');
    const models = provider ? (providerModels[provider] ?? []) : [];
    const showImageInput = isI2VModel(model);

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

    const handleProviderChange = (name: string) => {
        setProvider(name);
        const m = providerModels[name] ?? [];
        setModel(m.length > 0 ? m[0] : '');
        setImageUrl('');
        setPreviewUrl('');
    };

    const handleModelChange = (m: string) => {
        setModel(m);
        if (!isI2VModel(m)) {
            setImageUrl('');
            setPreviewUrl('');
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!provider || !prompt.trim()) return;

        setSubmitting(true);
        setError('');
        try {
            await createTask({
                provider,
                prompt: prompt.trim(),
                model: model.trim() || undefined,
                imageUrl: (showImageInput && imageUrl.trim()) || undefined,
            });
            setPrompt('');
            setImageUrl('');
            setPreviewUrl('');
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
                                            {m}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {showImageInput && (
                            <div className="space-y-2">
                                <Label>
                                    参考图片{' '}
                                    <span className="text-muted-foreground">
                                        (I2V 模式必填)
                                    </span>
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
