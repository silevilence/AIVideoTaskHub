import { useRef, useState } from 'react';
import {
    fetchUploadedImages,
    uploadImage,
    type ModelParameterDefinition,
    type ModelParameterSchema,
    type UploadedImage,
} from '../api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

export type ComfyInputValues = Record<string, unknown>;
export type ComfyInputErrors = Record<string, string>;

function constraintSummary(variable: ModelParameterDefinition): string | undefined {
    if (variable.type === 'integer' || variable.type === 'number') {
        const range = variable.min !== undefined && variable.max !== undefined
            ? `范围：${variable.min}–${variable.max}`
            : variable.min !== undefined
                ? `最小值：${variable.min}`
                : variable.max !== undefined ? `最大值：${variable.max}` : '';
        const step = variable.step !== undefined ? `步进：${variable.step}` : '';
        return [range, step].filter(Boolean).join('；') || undefined;
    }
    if (variable.type === 'string') {
        if (variable.minLength !== undefined && variable.maxLength !== undefined) {
            return `长度：${variable.minLength}–${variable.maxLength} 个字符`;
        }
        if (variable.minLength !== undefined) return `至少 ${variable.minLength} 个字符`;
        if (variable.maxLength !== undefined) return `最多 ${variable.maxLength} 个字符`;
    }
    return undefined;
}

function isRecognizableImageSource(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const source = value.trim();
    if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(source)) return true;
    if (
        /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp)$/i
            .test(source)
    ) {
        return true;
    }
    try {
        const url = new URL(source);
        return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
        return false;
    }
}

export function createComfyInputDefaults(schema: ModelParameterSchema): ComfyInputValues {
    return Object.fromEntries(schema.variables.map((variable) => [
        variable.key,
        variable.default ?? '',
    ]));
}

export function validateComfyInputValues(
    schema: ModelParameterSchema,
    values: ComfyInputValues
): ComfyInputErrors {
    const errors: ComfyInputErrors = {};
    for (const variable of schema.variables) {
        const value = values[variable.key];
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
            errors[variable.key] = `${variable.label}不能为空`;
            continue;
        }
        if (variable.type === 'integer' || variable.type === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                errors[variable.key] = `${variable.label}必须是数值`;
            } else if (variable.type === 'integer' && !Number.isInteger(value)) {
                errors[variable.key] = `${variable.label}必须是整数`;
            } else if (variable.min !== undefined && value < variable.min) {
                errors[variable.key] = `${variable.label}不能小于 ${variable.min}`;
            } else if (variable.max !== undefined && value > variable.max) {
                errors[variable.key] = `${variable.label}不能大于 ${variable.max}`;
            } else if (variable.step !== undefined) {
                const steps = (value - (variable.min ?? 0)) / variable.step;
                if (Math.abs(steps - Math.round(steps)) > 1e-9) {
                    errors[variable.key] = `${variable.label}必须符合步进 ${variable.step}`;
                }
            }
        } else if (variable.type === 'string') {
            if (typeof value !== 'string') errors[variable.key] = `${variable.label}必须是字符串`;
            else if (variable.minLength !== undefined && value.length < variable.minLength) {
                errors[variable.key] = `${variable.label}长度不能小于 ${variable.minLength}`;
            } else if (variable.maxLength !== undefined && value.length > variable.maxLength) {
                errors[variable.key] = `${variable.label}长度不能大于 ${variable.maxLength}`;
            }
        } else if (variable.type === 'option') {
            if (!variable.options?.some((option) => option.value === value)) {
                errors[variable.key] = `${variable.label}必须是有效选项`;
            }
        } else if (variable.type === 'boolean' && typeof value !== 'boolean') {
            errors[variable.key] = `${variable.label}必须是布尔值`;
        } else if (variable.type === 'image' && !isRecognizableImageSource(value)) {
            errors[variable.key] = `${variable.label}必须是可识别的图片来源`;
        }
    }
    return errors;
}

export function validateComfyBaseUrl(value: string): string | undefined {
    if (!value.trim()) return '本次 ComfyUI 地址不能为空';
    try {
        const url = new URL(value);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
            return '本次 ComfyUI 地址仅支持 HTTP 或 HTTPS';
        }
        if (url.username || url.password) return '本次 ComfyUI 地址不能包含认证信息';
        if (url.search || url.hash) return '本次 ComfyUI 地址不能包含查询参数或片段';
        return undefined;
    } catch {
        return '本次 ComfyUI 地址格式无效';
    }
}

function numericValue(variable: ModelParameterDefinition, value: string): unknown {
    if (value === '') return '';
    return Number(value);
}

function ComfyImageInput({
    id,
    label,
    value,
    onChange,
    error,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
}) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [library, setLibrary] = useState<UploadedImage[]>([]);
    const [actionError, setActionError] = useState('');

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        setUploading(true);
        setActionError('');
        try {
            const uploaded = await uploadImage(file);
            onChange(uploaded.url);
        } catch (uploadError) {
            setActionError((uploadError as Error).message);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const toggleLibrary = async () => {
        if (libraryOpen) {
            setLibraryOpen(false);
            return;
        }
        setActionError('');
        try {
            setLibrary(await fetchUploadedImages());
            setLibraryOpen(true);
        } catch (libraryError) {
            setActionError((libraryError as Error).message);
        }
    };

    return (
        <div className="space-y-2">
            <Input
                id={id}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                type="text"
                value={value}
                placeholder="https://…、data:image/… 或 /uploads/…"
                onChange={(event) => onChange(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    aria-hidden="true"
                    tabIndex={-1}
                    data-testid={`comfy-image-file-${id}`}
                    className="sr-only"
                    onChange={(event) => void handleFile(event.target.files?.[0])}
                />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`上传 ${label}`}
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                >
                    {uploading ? '上传中…' : '上传图片'}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`打开 ${label} 图片库`}
                    onClick={() => void toggleLibrary()}
                >
                    {libraryOpen ? '收起图片库' : '从图片库选择'}
                </Button>
            </div>
            {libraryOpen && (
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-background p-2 sm:grid-cols-5">
                    {library.length === 0 ? (
                        <p className="col-span-full py-3 text-center text-xs text-muted-foreground">图片库为空</p>
                    ) : library.map((image) => (
                        <button
                            key={image.url}
                            type="button"
                            aria-label={`选择图片 ${image.filename}`}
                            title={image.filename}
                            className="aspect-square overflow-hidden rounded-md border border-border hover:border-primary"
                            onClick={() => {
                                onChange(image.url);
                                setLibraryOpen(false);
                            }}
                        >
                            <img src={image.url} alt="" className="h-full w-full object-cover" />
                        </button>
                    ))}
                </div>
            )}
            {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
        </div>
    );
}

export function ComfyTaskFields({
    schema,
    values,
    onChange,
    baseUrl,
    onBaseUrlChange,
    errors,
}: {
    schema: ModelParameterSchema;
    values: ComfyInputValues;
    onChange: (key: string, value: unknown) => void;
    baseUrl: string;
    onBaseUrlChange: (value: string) => void;
    errors: ComfyInputErrors;
}) {
    return (
        <section className="space-y-5 rounded-xl border border-primary/20 bg-primary/[0.03] p-4">
            <div>
                <h3 className="text-sm font-semibold">工作流参数</h3>
                <p className="mt-1 text-xs text-muted-foreground">按模板定义填写；所有字段均为必填。</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {schema.variables.map((variable) => {
                    const error = errors[variable.key];
                    const constraints = constraintSummary(variable);
                    const id = `comfy-input-${variable.key}`;
                    const common = {
                        id,
                        'aria-invalid': error ? true : undefined,
                        'aria-describedby': error ? `${id}-error` : undefined,
                    };
                    return (
                        <div
                            key={variable.key}
                            className={variable.multiline || variable.type === 'image' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}
                        >
                            <Label
                                id={`${id}-label`}
                                htmlFor={variable.type === 'boolean' ? undefined : id}
                                data-testid="comfy-variable-label"
                            >
                                {variable.label}
                            </Label>
                            {variable.type === 'string' && variable.multiline ? (
                                <Textarea
                                    {...common}
                                    rows={4}
                                    minLength={variable.minLength}
                                    maxLength={variable.maxLength}
                                    value={String(values[variable.key] ?? '')}
                                    onChange={(event) => onChange(variable.key, event.target.value)}
                                />
                            ) : variable.type === 'option' ? (
                                <select
                                    {...common}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={String(values[variable.key] ?? '')}
                                    onChange={(event) => onChange(variable.key, event.target.value)}
                                >
                                    <option value="">请选择</option>
                                    {variable.options?.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            ) : variable.type === 'boolean' ? (
                                <div
                                    id={id}
                                    role="radiogroup"
                                    aria-labelledby={`${id}-label`}
                                    aria-invalid={error ? true : undefined}
                                    aria-describedby={error ? `${id}-error` : undefined}
                                    className="grid h-10 grid-cols-2 rounded-md border border-input bg-background p-1"
                                >
                                    {([
                                        { label: '启用', value: true },
                                        { label: '关闭', value: false },
                                    ] as const).map((choice) => {
                                        const selected = values[variable.key] === choice.value;
                                        return (
                                            <button
                                                key={choice.label}
                                                type="button"
                                                role="radio"
                                                aria-label={`${variable.label}：${choice.label}`}
                                                aria-checked={selected}
                                                onClick={() => onChange(variable.key, choice.value)}
                                                className={selected
                                                    ? 'rounded-sm bg-primary/15 text-xs font-medium text-primary'
                                                    : 'rounded-sm text-xs text-muted-foreground hover:text-foreground'}
                                            >
                                                {choice.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : variable.type === 'image' ? (
                                <ComfyImageInput
                                    id={id}
                                    label={variable.label}
                                    value={String(values[variable.key] ?? '')}
                                    onChange={(value) => onChange(variable.key, value)}
                                    error={error}
                                />
                            ) : (
                                <Input
                                    {...common}
                                    type={variable.type === 'integer' || variable.type === 'number' ? 'number' : 'text'}
                                    inputMode={variable.type === 'integer' ? 'numeric' : variable.type === 'number' ? 'decimal' : undefined}
                                    min={variable.min}
                                    max={variable.max}
                                    step={variable.step}
                                    minLength={variable.type === 'string' ? variable.minLength : undefined}
                                    maxLength={variable.type === 'string' ? variable.maxLength : undefined}
                                    value={String(values[variable.key] ?? '')}
                                    onChange={(event) => onChange(
                                        variable.key,
                                        variable.type === 'integer' || variable.type === 'number'
                                            ? numericValue(variable, event.target.value)
                                            : event.target.value
                                    )}
                                />
                            )}
                            {variable.description && <p className="text-xs text-muted-foreground">{variable.description}</p>}
                            {constraints && <p className="text-xs text-muted-foreground">{constraints}</p>}
                            {error && <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>}
                        </div>
                    );
                })}
            </div>
            <div className="space-y-2 border-t border-border/70 pt-4">
                <Label htmlFor="comfy-temporary-base-url">本次 ComfyUI 地址</Label>
                <Input
                    id="comfy-temporary-base-url"
                    value={baseUrl}
                    onChange={(event) => onBaseUrlChange(event.target.value)}
                    placeholder="http://127.0.0.1:8188"
                />
                <p className="text-xs text-muted-foreground">仅用于本次任务，不会改写设置中的默认地址。</p>
            </div>
        </section>
    );
}
