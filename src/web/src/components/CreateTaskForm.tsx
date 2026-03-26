import { useState, useEffect } from 'react';
import { fetchProviderModels, createTask, uploadImage } from '../api';

function isI2VModel(model: string): boolean {
    return /I2V/i.test(model);
}

export function CreateTaskForm({ onCreated }: { onCreated: () => void }) {
    const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
    const [provider, setProvider] = useState('');
    const [prompt, setPrompt] = useState('');
    const [model, setModel] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const providers = Object.keys(providerModels);
    const models = provider ? (providerModels[provider] ?? []) : [];
    const showImageInput = isI2VModel(model);

    useEffect(() => {
        fetchProviderModels()
            .then((data) => {
                setProviderModels(data);
                const names = Object.keys(data);
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
            onCreated();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3"
        >
            <div className="flex gap-3">
                <div className="w-40">
                    <label className="block text-xs text-gray-500 mb-1">
                        平台
                    </label>
                    <select
                        value={provider}
                        onChange={(e) => handleProviderChange(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                        {providers.map((p) => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                        模型
                    </label>
                    <select
                        value={model}
                        onChange={(e) => handleModelChange(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
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
                <div>
                    <label className="block text-xs text-gray-500 mb-1">
                        参考图片 <span className="text-gray-300">(I2V 模式必填)</span>
                    </label>
                    <div className="flex gap-2 items-center">
                        <input
                            type="text"
                            value={imageUrl.startsWith('data:') ? '(已上传本地图片)' : imageUrl}
                            onChange={(e) => {
                                setImageUrl(e.target.value);
                                setPreviewUrl('');
                            }}
                            readOnly={imageUrl.startsWith('data:')}
                            placeholder="输入图片 URL 或上传本地图片"
                            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <label className="shrink-0 px-3 py-1.5 text-xs bg-gray-100 text-gray-600 border border-gray-300 rounded cursor-pointer hover:bg-gray-200">
                            {uploading ? '上传中...' : '上传图片'}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                onChange={handleFileUpload}
                                disabled={uploading}
                                className="hidden"
                            />
                        </label>
                    </div>
                    {(previewUrl || (imageUrl && !imageUrl.startsWith('data:'))) && (
                        <div className="mt-2 flex items-center gap-2">
                            <img
                                src={previewUrl || imageUrl}
                                alt="预览"
                                className="h-16 rounded border border-gray-200 object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => { setImageUrl(''); setPreviewUrl(''); }}
                                className="text-xs text-red-400 hover:text-red-600"
                            >
                                移除
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div>
                <label className="block text-xs text-gray-500 mb-1">Prompt</label>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="描述你想生成的视频内容..."
                    rows={3}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
                type="submit"
                disabled={submitting || !prompt.trim()}
                className="w-full bg-blue-600 text-white text-sm py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {submitting ? '提交中...' : '创建任务'}
            </button>
        </form>
    );
}
