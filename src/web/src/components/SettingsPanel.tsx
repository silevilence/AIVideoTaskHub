import { useState, useEffect } from 'react';
import { fetchSettings, updateSettings } from '../api';

export function SettingsPanel() {
    const [apiKey, setApiKey] = useState('');
    const [maskedKey, setMaskedKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (open) {
            fetchSettings()
                .then((s) => setMaskedKey(s.siliconflowApiKey))
                .catch(() => setMessage('获取设置失败'));
        }
    }, [open]);

    const handleSave = async () => {
        if (!apiKey.trim()) return;
        setSaving(true);
        setMessage('');
        try {
            await updateSettings({ siliconflowApiKey: apiKey.trim() });
            setMaskedKey(apiKey.slice(0, 4) + '****' + apiKey.slice(-4));
            setApiKey('');
            setMessage('已保存');
            setTimeout(() => setMessage(''), 2000);
        } catch {
            setMessage('保存失败');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mb-4">
            <button
                onClick={() => setOpen(!open)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
                <span>{open ? '▼' : '▶'}</span> 设置
            </button>

            {open && (
                <div className="mt-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">
                            SiliconFlow API Key
                            {maskedKey && (
                                <span className="ml-2 text-gray-300">
                                    当前: {maskedKey}
                                </span>
                            )}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="输入新的 API Key"
                                className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving || !apiKey.trim()}
                                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {saving ? '保存中...' : '保存'}
                            </button>
                        </div>
                        {message && (
                            <p className="mt-1 text-xs text-green-600">{message}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
