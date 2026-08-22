import { parseDocument, stringify } from 'yaml';

export type WorkflowVariableType =
    | 'integer'
    | 'number'
    | 'string'
    | 'boolean'
    | 'option'
    | 'image';

export interface WorkflowTemplateVariable {
    key: string;
    label: string;
    description?: string;
    type: WorkflowVariableType;
    default?: unknown;
    min?: number;
    max?: number;
    step?: number;
    multiline?: boolean;
    minLength?: number;
    maxLength?: number;
    options?: { label: string; value: string }[];
}

export interface WorkflowPrimaryOutput {
    nodeId: string;
    field: string;
    index: number;
}

export interface WorkflowTemplateMetadata {
    schemaVersion: number;
    name: string;
    description?: string;
    primaryDescription?: string;
    primaryOutput: WorkflowPrimaryOutput;
    variables: WorkflowTemplateVariable[];
}

export interface ComfyWorkflowNode {
    class_type: string;
    inputs: Record<string, unknown>;
}

export type ComfyApiWorkflow = Record<string, ComfyWorkflowNode>;

export interface ParsedWorkflowTemplate {
    metadata: WorkflowTemplateMetadata;
    workflow: ComfyApiWorkflow;
}

export interface WorkflowTemplateValidationResult {
    template?: ParsedWorkflowTemplate;
    errors: string[];
    warnings: string[];
}

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/;
const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const ANY_PLACEHOLDER_PATTERN = /\$\{([^}]*)\}/g;
const VARIABLE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VARIABLE_TYPES = new Set<WorkflowVariableType>([
    'integer',
    'number',
    'string',
    'boolean',
    'option',
    'image',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRecognizableImageSource(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const source = value.trim();
    if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(source)) return true;
    if (
        /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp)$/i
            .test(source)
    ) {
        return true;
    }
    if (!/^https?:\/\/[^/?#]/i.test(source)) return false;
    try {
        const url = new URL(source);
        return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function validateWorkflowStructure(value: unknown): string[] {
    if (!isRecord(value)) return ['工作流 JSON 根节点必须是对象'];
    if (Array.isArray(value.nodes)) {
        return ['检测到 UI 工作流，请使用 ComfyUI 的 Save (API Format) 导出'];
    }
    if (Object.keys(value).length === 0) return ['API 格式工作流至少需要一个节点'];

    const errors: string[] = [];
    for (const [nodeId, node] of Object.entries(value)) {
        if (!isRecord(node)) {
            errors.push(`节点 ${nodeId} 必须是对象`);
            continue;
        }
        if (typeof node.class_type !== 'string' || !node.class_type.trim()) {
            errors.push(`节点 ${nodeId} 缺少有效的 class_type`);
        }
        if (!isRecord(node.inputs)) {
            errors.push(`节点 ${nodeId} 缺少有效的 inputs`);
        }
    }
    return errors;
}

function validateMetadata(value: unknown): string[] {
    if (!isRecord(value)) return ['YAML 头元数据必须是对象'];

    const errors: string[] = [];
    if (value.schemaVersion !== 1) errors.push('仅支持 schemaVersion: 1');
    if (typeof value.name !== 'string' || !value.name.trim()) errors.push('模板名称不能为空');
    if (!Array.isArray(value.variables)) {
        errors.push('variables 必须是数组');
        return errors;
    }

    const keys = new Set<string>();
    for (const variable of value.variables) {
        if (!isRecord(variable)) {
            errors.push('每个模板变量都必须是对象');
            continue;
        }
        if (typeof variable.key !== 'string' || !VARIABLE_KEY_PATTERN.test(variable.key)) {
            errors.push(`模板变量键非法：${String(variable.key ?? '')}`);
            continue;
        }
        if (keys.has(variable.key)) errors.push(`模板变量键重复：${variable.key}`);
        keys.add(variable.key);
        if (typeof variable.label !== 'string' || !variable.label.trim()) {
            errors.push(`变量 ${variable.key} 的显示名不能为空`);
        }
        if (variable.description !== undefined && typeof variable.description !== 'string') {
            errors.push(`变量 ${variable.key} 的说明必须是字符串`);
        }
        if (typeof variable.type !== 'string' || !VARIABLE_TYPES.has(variable.type as WorkflowVariableType)) {
            errors.push(`变量 ${variable.key} 的类型不受支持`);
            continue;
        }
        if (variable.type === 'integer' || variable.type === 'number') {
            const numericFields = ['min', 'max', 'step'] as const;
            for (const field of numericFields) {
                const fieldValue = variable[field];
                if (fieldValue !== undefined && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) {
                    errors.push(`变量 ${variable.key} 的 ${field} 必须是有限数值`);
                }
            }
            if (typeof variable.step === 'number' && variable.step <= 0) {
                errors.push(`变量 ${variable.key} 的 step 必须大于 0`);
            }
            if (typeof variable.min === 'number' && typeof variable.max === 'number' && variable.min > variable.max) {
                errors.push(`变量 ${variable.key} 的 min 不能大于 max`);
            }
            if (variable.default !== undefined) {
                if (typeof variable.default !== 'number' || !Number.isFinite(variable.default)) {
                    errors.push(`变量 ${variable.key} 的默认值必须是有限数值`);
                } else {
                    if (variable.type === 'integer' && !Number.isInteger(variable.default)) {
                        errors.push(`变量 ${variable.key} 的默认值必须是整数`);
                    }
                    if (typeof variable.min === 'number' && variable.default < variable.min) {
                        errors.push(`变量 ${variable.key} 的默认值必须大于等于 ${variable.min}`);
                    }
                    if (typeof variable.max === 'number' && variable.default > variable.max) {
                        errors.push(`变量 ${variable.key} 的默认值必须小于等于 ${variable.max}`);
                    }
                    if (typeof variable.step === 'number' && variable.step > 0) {
                        const base = typeof variable.min === 'number' ? variable.min : 0;
                        const steps = (variable.default - base) / variable.step;
                        if (Math.abs(steps - Math.round(steps)) > 1e-9) {
                            errors.push(`变量 ${variable.key} 的默认值必须符合 step: ${variable.step}`);
                        }
                    }
                }
            }
        }
        if (variable.type === 'option') {
            if (!Array.isArray(variable.options) || variable.options.length === 0) {
                errors.push(`变量 ${variable.key} 至少需要一个选项`);
                continue;
            }
            const optionValues = new Set<string>();
            for (const option of variable.options) {
                if (
                    !isRecord(option)
                    || typeof option.label !== 'string'
                    || !option.label.trim()
                    || typeof option.value !== 'string'
                    || !option.value
                ) {
                    errors.push(`变量 ${variable.key} 包含无效选项`);
                    continue;
                }
                if (optionValues.has(option.value)) {
                    errors.push(`变量 ${variable.key} 的选项值重复：${option.value}`);
                }
                optionValues.add(option.value);
            }
            if (variable.default !== undefined) {
                if (typeof variable.default !== 'string' || !optionValues.has(variable.default)) {
                    errors.push(`变量 ${variable.key} 的默认值不在选项中：${String(variable.default)}`);
                }
            }
        }
        if (variable.type === 'string') {
            if (variable.multiline !== undefined && typeof variable.multiline !== 'boolean') {
                errors.push(`变量 ${variable.key} 的 multiline 必须是布尔值`);
            }
            for (const field of ['minLength', 'maxLength'] as const) {
                const fieldValue = variable[field];
                if (
                    fieldValue !== undefined
                    && (typeof fieldValue !== 'number' || !Number.isInteger(fieldValue) || fieldValue < 0)
                ) {
                    errors.push(`变量 ${variable.key} 的 ${field} 必须是非负整数`);
                }
            }
            if (
                typeof variable.minLength === 'number'
                && typeof variable.maxLength === 'number'
                && variable.minLength > variable.maxLength
            ) {
                errors.push(`变量 ${variable.key} 的 minLength 不能大于 maxLength`);
            }
            if (variable.default !== undefined) {
                if (typeof variable.default !== 'string') {
                    errors.push(`变量 ${variable.key} 的默认值必须是字符串`);
                } else {
                    if (
                        typeof variable.minLength === 'number'
                        && variable.default.length < variable.minLength
                    ) {
                        errors.push(`变量 ${variable.key} 的默认值长度不能小于 ${variable.minLength}`);
                    }
                    if (
                        typeof variable.maxLength === 'number'
                        && variable.default.length > variable.maxLength
                    ) {
                        errors.push(`变量 ${variable.key} 的默认值长度不能大于 ${variable.maxLength}`);
                    }
                }
            }
        }
        if (
            variable.type === 'boolean'
            && variable.default !== undefined
            && typeof variable.default !== 'boolean'
        ) {
            errors.push(`变量 ${variable.key} 的默认值必须是布尔值`);
        }
        if (
            variable.type === 'image'
            && variable.default !== undefined
            && !isRecognizableImageSource(variable.default)
        ) {
            errors.push(`变量 ${variable.key} 的默认值不是可识别的图片来源`);
        }
    }
    return errors;
}

function collectVariableReferences(value: unknown, references: Set<string>): void {
    if (typeof value === 'string') {
        for (const match of value.matchAll(VARIABLE_PATTERN)) {
            references.add(match[1]);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectVariableReferences(item, references);
        return;
    }
    if (value && typeof value === 'object') {
        for (const nested of Object.values(value)) collectVariableReferences(nested, references);
    }
}

function collectInvalidPlaceholderSyntax(value: unknown, errors: Set<string>): void {
    if (typeof value === 'string') {
        for (const match of value.matchAll(ANY_PLACEHOLDER_PATTERN)) {
            if (!VARIABLE_KEY_PATTERN.test(match[1])) {
                errors.add(`占位符语法非法：${match[0]}`);
            }
        }
        const unmatched = value.match(/\$\{[^}]*$/);
        if (unmatched) errors.add(`占位符语法非法：${unmatched[0]}`);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectInvalidPlaceholderSyntax(item, errors);
        return;
    }
    if (isRecord(value)) {
        for (const [key, nested] of Object.entries(value)) {
            collectInvalidPlaceholderSyntax(key, errors);
            collectInvalidPlaceholderSyntax(nested, errors);
        }
    }
}

function collectVariableReferencesInKeys(value: unknown, references: Set<string>): void {
    if (Array.isArray(value)) {
        for (const item of value) collectVariableReferencesInKeys(item, references);
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
        collectVariableReferences(key, references);
        collectVariableReferencesInKeys(nested, references);
    }
}

function findReferencesOutsideInputValues(workflow: ComfyApiWorkflow): Set<string> {
    const references = new Set<string>();
    for (const [nodeId, node] of Object.entries(workflow)) {
        collectVariableReferences(nodeId, references);
        collectVariableReferencesInKeys(node.inputs, references);
        for (const [key, value] of Object.entries(node)) {
            if (key === 'inputs') continue;
            collectVariableReferences(key, references);
            collectVariableReferences(value, references);
        }
    }
    return references;
}

function validateEmbeddedInterpolations(
    value: unknown,
    variables: Map<string, WorkflowTemplateVariable>,
    errors: Set<string>
): void {
    if (typeof value === 'string') {
        const references = [...value.matchAll(VARIABLE_PATTERN)].map((match) => match[1]);
        for (const reference of references) {
            if (value === `\${${reference}}`) continue;
            const variable = variables.get(reference);
            if (variable && variable.type !== 'string') {
                errors.add(`非 string 变量只能作为完整令牌使用：${reference}`);
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) validateEmbeddedInterpolations(item, variables, errors);
        return;
    }
    if (isRecord(value)) {
        for (const nested of Object.values(value)) {
            validateEmbeddedInterpolations(nested, variables, errors);
        }
    }
}

function validatePrimaryOutput(
    metadata: WorkflowTemplateMetadata,
    workflow: ComfyApiWorkflow
): string[] {
    const output = metadata.primaryOutput;
    if (!isRecord(output)) return ['必须定义主输出选择器'];
    const errors: string[] = [];
    if (typeof output.nodeId !== 'string' || !output.nodeId.trim()) {
        errors.push('主输出节点 ID 不能为空');
    } else if (!Object.hasOwn(workflow, output.nodeId)) {
        errors.push(`主输出节点不存在：${output.nodeId}`);
    }
    if (typeof output.field !== 'string' || !output.field.trim()) {
        errors.push('主输出字段不能为空');
    }
    if (!Number.isInteger(output.index) || output.index < 0) {
        errors.push('主输出序号必须是非负整数');
    }
    return errors;
}

function validatePrimaryDescription(metadata: WorkflowTemplateMetadata): string[] {
    if (metadata.primaryDescription === undefined) return [];
    if (typeof metadata.primaryDescription !== 'string' || !metadata.primaryDescription.trim()) {
        return ['主描述变量不能为空'];
    }
    const variable = metadata.variables.find((candidate) => candidate.key === metadata.primaryDescription);
    if (!variable || variable.type !== 'string') {
        return [`主描述变量必须引用 string 类型变量：${metadata.primaryDescription}`];
    }
    return [];
}

/** Parse a portable YAML-front-matter + ComfyUI API JSON template document. */
export function parseWorkflowTemplateDocument(document: string): WorkflowTemplateValidationResult {
    const match = document.match(FRONT_MATTER_PATTERN);
    if (!match) {
        return { errors: ['模板必须以 YAML 头元数据开头，并包含 JSON 正文'], warnings: [] };
    }

    const yamlDocument = parseDocument(match[1]);
    if (yamlDocument.errors.length > 0) {
        return {
            errors: yamlDocument.errors.map((error) => `YAML 解析失败：${error.message}`),
            warnings: [],
        };
    }

    let workflowValue: unknown;
    try {
        workflowValue = JSON.parse(match[2]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { errors: [`JSON 解析失败：${message}`], warnings: [] };
    }

    const structureErrors = validateWorkflowStructure(workflowValue);
    if (structureErrors.length > 0) {
        return { errors: structureErrors, warnings: [] };
    }
    const workflow = workflowValue as ComfyApiWorkflow;

    const metadataValue = yamlDocument.toJS();
    const metadataErrors = validateMetadata(metadataValue);
    if (metadataErrors.length > 0) {
        return { errors: metadataErrors, warnings: [] };
    }
    const metadata = metadataValue as WorkflowTemplateMetadata;
    if (isRecord(metadata.primaryOutput) && metadata.primaryOutput.index === undefined) {
        metadata.primaryOutput.index = 0;
    }
    const syntaxErrors = new Set<string>();
    collectInvalidPlaceholderSyntax(workflow, syntaxErrors);
    if (syntaxErrors.size > 0) {
        return { errors: [...syntaxErrors], warnings: [] };
    }
    const relationshipErrors = [
        ...validatePrimaryDescription(metadata),
        ...validatePrimaryOutput(metadata, workflow),
    ];
    if (relationshipErrors.length > 0) {
        return { errors: relationshipErrors, warnings: [] };
    }
    const outsideReferences = findReferencesOutsideInputValues(workflow);
    if (outsideReferences.size > 0) {
        return {
            errors: [...outsideReferences].map(
                (reference) => `模板变量只能出现在节点 inputs 的值中：${reference}`
            ),
            warnings: [],
        };
    }
    const references = new Set<string>();
    for (const node of Object.values(workflow)) {
        collectVariableReferences(node.inputs, references);
    }
    const definedVariables = new Set((metadata.variables ?? []).map((variable) => variable.key));
    const errors = [...references]
        .filter((reference) => !definedVariables.has(reference))
        .map((reference) => `工作流使用了未定义变量：${reference}`);
    const variablesByKey = new Map(metadata.variables.map((variable) => [variable.key, variable]));
    const interpolationErrors = new Set<string>();
    for (const node of Object.values(workflow)) {
        validateEmbeddedInterpolations(node.inputs, variablesByKey, interpolationErrors);
    }
    errors.push(...interpolationErrors);
    const warnings = [...definedVariables]
        .filter((variable) => !references.has(variable))
        .map((variable) => `模板变量已定义但未使用：${variable}`);

    if (errors.length > 0) {
        return { errors, warnings };
    }

    return {
        template: { metadata, workflow },
        errors,
        warnings,
    };
}

/** Serialize a parsed template into its portable YAML-front-matter + JSON representation. */
export function serializeWorkflowTemplateDocument(template: ParsedWorkflowTemplate): string {
    const metadata = stringify(template.metadata).trimEnd();
    const workflow = JSON.stringify(template.workflow, null, 2);
    return `---\n${metadata}\n---\n${workflow}`;
}
