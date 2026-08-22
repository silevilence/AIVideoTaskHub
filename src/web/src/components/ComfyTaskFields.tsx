import type { ModelParameterDefinition, ModelParameterSchema } from '../api';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

export type ComfyInputValues = Record<string, unknown>;
export type ComfyInputErrors = Record<string, string>;

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
                            ) : (
                                <Input
                                    {...common}
                                    type={variable.type === 'integer' || variable.type === 'number' ? 'number' : 'text'}
                                    inputMode={variable.type === 'integer' ? 'numeric' : variable.type === 'number' ? 'decimal' : undefined}
                                    min={variable.min}
                                    max={variable.max}
                                    step={variable.step}
                                    value={String(values[variable.key] ?? '')}
                                    placeholder={variable.type === 'image' ? 'https://…、data:image/… 或 /uploads/…' : undefined}
                                    onChange={(event) => onChange(
                                        variable.key,
                                        variable.type === 'integer' || variable.type === 'number'
                                            ? numericValue(variable, event.target.value)
                                            : event.target.value
                                    )}
                                />
                            )}
                            {variable.description && <p className="text-xs text-muted-foreground">{variable.description}</p>}
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
