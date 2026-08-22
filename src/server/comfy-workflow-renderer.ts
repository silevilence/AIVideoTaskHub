import {
    isRecognizableImageSource,
    type ComfyApiWorkflow,
    type ParsedWorkflowTemplate,
    type WorkflowTemplateVariable,
} from './comfy-workflow-template.js';

const FULL_TOKEN_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const TOKEN_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export interface RenderedWorkflowTemplate {
    workflow: ComfyApiWorkflow;
    values: Record<string, unknown>;
    primaryDescription: string;
}

export class WorkflowInputValidationError extends Error {
    constructor(public readonly errors: string[]) {
        super(errors.join('\n'));
        this.name = 'WorkflowInputValidationError';
    }
}

function validateStep(value: number, variable: WorkflowTemplateVariable): boolean {
    if (variable.step === undefined) return true;
    const base = variable.min ?? 0;
    const steps = (value - base) / variable.step;
    return Math.abs(steps - Math.round(steps)) <= 1e-9;
}

function validateValue(variable: WorkflowTemplateVariable, value: unknown): string[] {
    const { key } = variable;
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        return [`${key} 不能为空`];
    }

    if (variable.type === 'integer' || variable.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return [`${key} 必须是数值`];
        if (variable.type === 'integer' && !Number.isInteger(value)) return [`${key} 必须是整数`];
        const errors: string[] = [];
        if (variable.min !== undefined && value < variable.min) errors.push(`${key} 不能小于 ${variable.min}`);
        if (variable.max !== undefined && value > variable.max) errors.push(`${key} 不能大于 ${variable.max}`);
        if (!validateStep(value, variable)) errors.push(`${key} 必须符合步进 ${variable.step}`);
        return errors;
    }
    if (variable.type === 'boolean') {
        return typeof value === 'boolean' ? [] : [`${key} 必须是布尔值`];
    }
    if (variable.type === 'option') {
        const allowed = variable.options?.some((option) => option.value === value);
        return typeof value === 'string' && allowed ? [] : [`${key} 必须是已定义的选项`];
    }
    if (variable.type === 'image') {
        return isRecognizableImageSource(value) ? [] : [`${key} 必须是可识别的图片来源`];
    }
    if (typeof value !== 'string') return [`${key} 必须是字符串`];
    const errors: string[] = [];
    if (variable.minLength !== undefined && value.length < variable.minLength) {
        errors.push(`${key} 长度不能小于 ${variable.minLength}`);
    }
    if (variable.maxLength !== undefined && value.length > variable.maxLength) {
        errors.push(`${key} 长度不能大于 ${variable.maxLength}`);
    }
    return errors;
}

function validateInputs(
    variables: WorkflowTemplateVariable[],
    provided: Record<string, unknown>
): Record<string, unknown> {
    const definitions = new Map(variables.map((variable) => [variable.key, variable]));
    const errors = Object.keys(provided)
        .filter((key) => !definitions.has(key))
        .map((key) => `存在未定义的变量值：${key}`);
    const entries: Array<[string, unknown]> = [];

    for (const variable of variables) {
        const value = Object.hasOwn(provided, variable.key)
            ? provided[variable.key]
            : undefined;
        errors.push(...validateValue(variable, value));
        entries.push([variable.key, value]);
    }
    if (errors.length > 0) throw new WorkflowInputValidationError(errors);
    return Object.fromEntries(entries);
}

function renderInputValue(
    value: unknown,
    values: Record<string, unknown>,
    stringVariables: Set<string>
): unknown {
    if (typeof value === 'string') {
        const fullToken = value.match(FULL_TOKEN_PATTERN);
        if (fullToken) return values[fullToken[1]];
        for (const match of value.matchAll(TOKEN_PATTERN)) {
            if (!stringVariables.has(match[1])) {
                throw new WorkflowInputValidationError([
                    `非 string 变量只能作为完整令牌使用：${match[1]}`,
                ]);
            }
        }
        return value.replace(TOKEN_PATTERN, (_token, key: string) => String(values[key]));
    }
    if (Array.isArray(value)) {
        return value.map((item) => renderInputValue(item, values, stringVariables));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [
                key,
                renderInputValue(nested, values, stringVariables),
            ])
        );
    }
    return value;
}

export function renderWorkflowTemplate(
    template: ParsedWorkflowTemplate,
    provided: Record<string, unknown>
): RenderedWorkflowTemplate {
    const values = validateInputs(template.metadata.variables, provided);
    const stringVariables = new Set(
        template.metadata.variables
            .filter((variable) => variable.type === 'string')
            .map((variable) => variable.key)
    );
    const workflow = Object.fromEntries(
        Object.entries(template.workflow).map(([nodeId, node]) => [nodeId, {
            class_type: node.class_type,
            inputs: renderInputValue(node.inputs, values, stringVariables) as Record<string, unknown>,
        }])
    );
    const primaryKey = template.metadata.primaryDescription;
    return {
        workflow,
        values,
        primaryDescription: primaryKey ? String(values[primaryKey]) : template.metadata.name,
    };
}
