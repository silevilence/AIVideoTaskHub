import { parse, stringify } from 'yaml';
import {
    parse as parseJson,
    printParseErrorCode,
    type ParseError,
} from 'jsonc-parser';

export type WorkflowVariableType =
    | 'integer'
    | 'number'
    | 'string'
    | 'boolean'
    | 'option'
    | 'image';

export interface WorkflowVariableDraft {
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

export interface WorkflowMetadataDraft {
    schemaVersion: 1;
    name: string;
    description?: string;
    primaryDescription?: string;
    primaryOutput: { nodeId: string; field: string; index: number };
    variables: WorkflowVariableDraft[];
}

export interface WorkflowEditorDraft {
    metadata: WorkflowMetadataDraft;
    json: string;
}

export interface WorkflowEditorDiagnostic {
    severity: 'error' | 'warning';
    code: 'json-syntax' | 'ui-workflow' | 'json-root' | 'api-workflow';
    message: string;
    line?: number;
    column?: number;
}

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/;
const EDITABLE_VARIABLE_TYPES = new Set<WorkflowVariableType>([
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

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function hasEditableDefault(variable: Record<string, unknown>): boolean {
    if (variable.default === undefined) return true;
    if (variable.type === 'integer') {
        return typeof variable.default === 'number'
            && Number.isFinite(variable.default)
            && Number.isInteger(variable.default);
    }
    if (variable.type === 'number') {
        return typeof variable.default === 'number' && Number.isFinite(variable.default);
    }
    if (variable.type === 'boolean') return typeof variable.default === 'boolean';
    return typeof variable.default === 'string';
}

function isEditableVariable(value: unknown): value is WorkflowVariableDraft {
    if (!isRecord(value) || !EDITABLE_VARIABLE_TYPES.has(value.type as WorkflowVariableType)) {
        return false;
    }
    if (
        typeof value.key !== 'string'
        || typeof value.label !== 'string'
        || !isOptionalString(value.description)
        || !hasEditableDefault(value)
        || !isOptionalFiniteNumber(value.min)
        || !isOptionalFiniteNumber(value.max)
        || !isOptionalFiniteNumber(value.step)
        || (value.multiline !== undefined && typeof value.multiline !== 'boolean')
        || (value.minLength !== undefined && !Number.isInteger(value.minLength))
        || (value.maxLength !== undefined && !Number.isInteger(value.maxLength))
    ) {
        return false;
    }
    if (value.type !== 'option') return true;
    return Array.isArray(value.options) && value.options.every((option) => (
        isRecord(option)
        && typeof option.label === 'string'
        && typeof option.value === 'string'
    ));
}

export function splitWorkflowTemplateDocument(document: string): WorkflowEditorDraft {
    const match = document.match(FRONT_MATTER_PATTERN);
    if (!match) throw new Error('导入文件不是有效的 ComfyUI 工作流组合文档');
    const metadata = parse(match[1]) as unknown;
    if (!isRecord(metadata)) throw new Error('YAML 头元数据必须是对象');
    if (!Array.isArray(metadata.variables)) {
        throw new Error('组合文档缺少有效的 variables 元数据');
    }
    if (!isRecord(metadata.primaryOutput)) {
        throw new Error('组合文档缺少有效的 primaryOutput 元数据');
    }
    const hasInvalidMetadata = metadata.schemaVersion !== 1
        || typeof metadata.name !== 'string'
        || !isOptionalString(metadata.description)
        || !isOptionalString(metadata.primaryDescription)
        || typeof metadata.primaryOutput.nodeId !== 'string'
        || typeof metadata.primaryOutput.field !== 'string'
        || (
            metadata.primaryOutput.index !== undefined
            && !Number.isInteger(metadata.primaryOutput.index)
        );
    if (hasInvalidMetadata) {
        throw new Error('组合文档包含无法编辑的头元数据');
    }
    const hasUneditableVariable = metadata.variables.some((variable) => !isEditableVariable(variable));
    if (hasUneditableVariable) {
        throw new Error('组合文档包含无法编辑的变量 schema');
    }
    return {
        metadata: {
            ...metadata,
            schemaVersion: metadata.schemaVersion as 1,
            name: typeof metadata.name === 'string' ? metadata.name : '',
            primaryOutput: {
                nodeId: typeof metadata.primaryOutput.nodeId === 'string'
                    ? metadata.primaryOutput.nodeId
                    : '',
                field: typeof metadata.primaryOutput.field === 'string'
                    ? metadata.primaryOutput.field
                    : '',
                index: Number.isInteger(metadata.primaryOutput.index)
                    ? metadata.primaryOutput.index as number
                    : 0,
            },
            variables: metadata.variables as WorkflowVariableDraft[],
        } as WorkflowMetadataDraft,
        json: match[2],
    };
}

export function composeWorkflowTemplateDocument(
    metadata: WorkflowMetadataDraft,
    json: string
): string {
    return `---\n${stringify(metadata).trimEnd()}\n---\n${json.trim()}`;
}

function locationFromPosition(source: string, position: number): { line: number; column: number } {
    const before = source.slice(0, Math.max(0, position));
    const lines = before.split('\n');
    return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

export function validateWorkflowJson(json: string): WorkflowEditorDiagnostic[] {
    const parseErrors: ParseError[] = [];
    const value = parseJson(json, parseErrors, {
        allowTrailingComma: false,
        disallowComments: true,
        allowEmptyContent: false,
    }) as unknown;
    if (parseErrors.length > 0) {
        const failure = parseErrors[0];
        return [{
            severity: 'error',
            code: 'json-syntax',
            message: `JSON 语法错误：${printParseErrorCode(failure.error)}`,
            ...locationFromPosition(json, failure.offset),
        }];
    }
    if (!isRecord(value)) {
        return [{ severity: 'error', code: 'json-root', message: '工作流 JSON 根节点必须是对象' }];
    }
    if (Array.isArray(value.nodes)) {
        return [{
            severity: 'error',
            code: 'ui-workflow',
            message: '检测到 UI 画布工作流，请在 ComfyUI 中使用 Save (API Format) 导出',
        }];
    }
    if (Object.keys(value).length === 0) {
        return [{
            severity: 'error',
            code: 'api-workflow',
            message: 'API 格式工作流至少需要一个节点',
        }];
    }
    for (const [nodeId, node] of Object.entries(value)) {
        if (
            !isRecord(node)
            || typeof node.class_type !== 'string'
            || !node.class_type.trim()
            || !isRecord(node.inputs)
        ) {
            return [{
                severity: 'error',
                code: 'api-workflow',
                message: `节点 ${nodeId} 缺少有效的 class_type 或 inputs`,
            }];
        }
    }
    return [];
}

export function formatWorkflowJson(json: string): string {
    try {
        return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
        return json;
    }
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function highlightWorkflowJson(json: string): string {
    const tokenPattern = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
    let result = '';
    let lastIndex = 0;
    for (const match of json.matchAll(tokenPattern)) {
        const index = match.index;
        result += escapeHtml(json.slice(lastIndex, index));
        const token = match[0];
        let className = 'json-number';
        if (token.startsWith('"')) {
            className = /^\s*:/.test(json.slice(index + token.length)) ? 'json-key' : 'json-string';
        } else if (/^(?:true|false|null)$/.test(token)) {
            className = 'json-literal';
        }
        result += `<span class="${className}">${escapeHtml(token)}</span>`;
        lastIndex = index + token.length;
    }
    return result + escapeHtml(json.slice(lastIndex));
}

export function createEmptyWorkflowDraft(): WorkflowEditorDraft {
    return {
        metadata: {
            schemaVersion: 1,
            name: '新建工作流',
            primaryOutput: { nodeId: '', field: 'videos', index: 0 },
            variables: [],
        },
        json: '{\n  \n}',
    };
}
