import { useState, useEffect, useMemo } from 'react';
import { fetchSettings, updateProviderSettings, refreshProviderModels } from '../api';
import type { ProviderSettings } from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Settings, Save, Check, Search, RefreshCw } from 'lucide-react';

export function SettingsPanel() {
    const [allSettings, setAllSettings] = useState<Record<string, ProviderSettings>>({});
    const [editValues, setEditValues] = useState<Record<string, Record<string, string>>>({});
    const [saving, setSaving] = useState<Record<string, boolean>>({});
    const [messages, setMessages] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');
    const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

    useEffect(() => {
        fetchSettings()
            .then((data) => {
                setAllSettings(data);
                // 初始化编辑值为空
                const initial: Record<string, Record<string, string>> = {};
                for (const prov of Object.keys(data)) {
                    initial[prov] = {};
                }
                setEditValues(initial);
            })
            .catch(() => setMessages({ _global: '获取设置失败' }));
    }, []);

    const filteredProviders = useMemo(() => {
        const q = search.toLowerCase();
        return Object.entries(allSettings).filter(([provName, ps]) => {
            if (!q) return true;
            if (provName.toLowerCase().includes(q)) return true;
            if (ps.displayName && ps.displayName.toLowerCase().includes(q)) return true;
            return ps.schema.some(
                (s) =>
                    s.key.toLowerCase().includes(q) ||
                    s.label.toLowerCase().includes(q) ||
                    (s.description && s.description.toLowerCase().includes(q)),
            );
        });
    }, [allSettings, search]);

    const handleSave = async (providerName: string) => {
        const vals = editValues[providerName];
        if (!vals) return;
        const toSave: Record<string, string> = {};
        for (const [k, v] of Object.entries(vals)) {
            if (v.trim()) toSave[k] = v.trim();
        }
        if (Object.keys(toSave).length === 0) return;

        setSaving((s) => ({ ...s, [providerName]: true }));
        setMessages((m) => ({ ...m, [providerName]: '' }));
        try {
            await updateProviderSettings(providerName, toSave);
            // 刷新设置
            const freshData = await fetchSettings();
            setAllSettings(freshData);
            setEditValues((ev) => ({ ...ev, [providerName]: {} }));
            setMessages((m) => ({ ...m, [providerName]: '已保存' }));
            setTimeout(() => setMessages((m) => ({ ...m, [providerName]: '' })), 2000);
        } catch {
            setMessages((m) => ({ ...m, [providerName]: '保存失败' }));
        } finally {
            setSaving((s) => ({ ...s, [providerName]: false }));
        }
    };

    const handleRefreshModels = async (providerName: string) => {
        setRefreshing((r) => ({ ...r, [providerName]: true }));
        setMessages((m) => ({ ...m, [providerName]: '' }));
        try {
            const result = await refreshProviderModels(providerName);
            // 刷新设置（更新 modelsUpdatedAt）
            const freshData = await fetchSettings();
            setAllSettings(freshData);
            setMessages((m) => ({
                ...m,
                [providerName]: `已刷新，共 ${result.models.length} 个模型`,
            }));
            setTimeout(() => setMessages((m) => ({ ...m, [providerName]: '' })), 3000);
        } catch (err) {
            setMessages((m) => ({
                ...m,
                [providerName]: `刷新失败: ${(err as Error).message}`,
            }));
        } finally {
            setRefreshing((r) => ({ ...r, [providerName]: false }));
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h2 className="text-xl font-heading font-bold tracking-wide">设置</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    管理各平台 API 密钥和配置
                </p>
            </div>

            {/* 搜索栏 */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索平台名称或设置项..."
                    className="pl-9"
                />
            </div>

            {messages._global && (
                <p className="text-sm text-destructive">{messages._global}</p>
            )}

            {filteredProviders.length === 0 && (
                <p className="text-center text-muted-foreground py-8">
                    {search ? '没有匹配的设置项' : '没有需要配置的平台'}
                </p>
            )}

            {filteredProviders.map(([provName, ps]) => (
                <Card key={provName}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5 text-primary" />
                            {ps.displayName ?? provName}
                        </CardTitle>
                        <CardDescription>
                            {ps.schema.length} 项配置
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {ps.schema.map((field) => (
                            <div key={field.key} className="space-y-1.5">
                                <Label htmlFor={`${provName}-${field.key}`}>
                                    {field.label}
                                    {field.required && (
                                        <span className="text-destructive ml-1">*</span>
                                    )}
                                </Label>
                                {field.description && (
                                    <p className="text-xs text-muted-foreground">
                                        {field.description}
                                    </p>
                                )}
                                <div className="flex gap-2 items-center">
                                    <Input
                                        id={`${provName}-${field.key}`}
                                        type={field.secret ? 'password' : 'text'}
                                        value={editValues[provName]?.[field.key] ?? ''}
                                        onChange={(e) =>
                                            setEditValues((ev) => ({
                                                ...ev,
                                                [provName]: {
                                                    ...ev[provName],
                                                    [field.key]: e.target.value,
                                                },
                                            }))
                                        }
                                        placeholder={
                                            ps.values[field.key]
                                                ? `当前: ${ps.values[field.key]}`
                                                : `输入 ${field.label}`
                                        }
                                    />
                                </div>
                            </div>
                        ))}

                        <div className="flex items-center gap-3 pt-2">
                            <Button
                                onClick={() => handleSave(provName)}
                                disabled={
                                    saving[provName] ||
                                    !Object.values(editValues[provName] || {}).some((v) => v.trim())
                                }
                                size="sm"
                            >
                                {saving[provName] ? (
                                    <Save className="h-4 w-4 animate-pulse mr-1.5" />
                                ) : messages[provName] === '已保存' ? (
                                    <Check className="h-4 w-4 mr-1.5" />
                                ) : (
                                    <Save className="h-4 w-4 mr-1.5" />
                                )}
                                {saving[provName] ? '保存中...' : '保存'}
                            </Button>
                            {messages[provName] && messages[provName] !== '已保存' && !messages[provName].startsWith('已刷新') && (
                                <p className="text-sm text-destructive">{messages[provName]}</p>
                            )}
                            {(messages[provName] === '已保存' || messages[provName]?.startsWith('已刷新')) && (
                                <p className="text-sm text-primary">{messages[provName]}</p>
                            )}
                        </div>

                        {/* 模型列表刷新按钮 */}
                        {ps.supportsModelRefresh && (
                            <div className="flex items-center gap-3 pt-2 border-t mt-3">
                                <div className="flex-1">
                                    <p className="text-xs text-muted-foreground">
                                        模型列表{ps.modelsUpdatedAt
                                            ? `（上次更新: ${new Date(ps.modelsUpdatedAt).toLocaleString()}）`
                                            : '（尚未获取）'}
                                    </p>
                                </div>
                                <Button
                                    onClick={() => handleRefreshModels(provName)}
                                    disabled={refreshing[provName]}
                                    size="sm"
                                    variant="outline"
                                >
                                    <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing[provName] ? 'animate-spin' : ''}`} />
                                    {refreshing[provName] ? '刷新中...' : '刷新模型列表'}
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
