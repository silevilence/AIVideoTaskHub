import { parseWorkflowTemplateDocument } from './comfy-workflow-template.js';
import type { ModelParameterSchema } from './provider.js';
import type { Task } from './task-model.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ComfyTaskSnapshotView {
    templateId: string;
    templateName: string;
    baseUrl: string;
    primaryOutput: { nodeId: string; field: string; index: number };
    parameterSchema: ModelParameterSchema;
    variables: Array<{
        key: string;
        label: string;
        type: string;
        value: unknown;
    }>;
    images: Array<Record<string, unknown> & { variableKey: string; source: string }>;
}

export function getComfyTaskSnapshotView(task: Task): ComfyTaskSnapshotView | undefined {
    if (task.provider !== 'comfyui' || !task.extra_params) return undefined;
    let extra: unknown;
    try {
        extra = JSON.parse(task.extra_params);
    } catch {
        return undefined;
    }
    if (
        !isRecord(extra)
        || extra.snapshotVersion !== 1
        || typeof extra.templateId !== 'string'
        || typeof extra.templateName !== 'string'
        || typeof extra.templateDocument !== 'string'
        || typeof extra.comfyuiBaseUrl !== 'string'
        || !isRecord(extra.primaryOutput)
    ) {
        return undefined;
    }
    const parsed = parseWorkflowTemplateDocument(extra.templateDocument);
    if (!parsed.template) return undefined;
    const values = isRecord(extra.workflowInputs) ? extra.workflowInputs : {};
    const primaryOutput = parsed.template.metadata.primaryOutput;
    const parameterSchema: ModelParameterSchema = {
        kind: 'comfyui-workflow',
        variables: parsed.template.metadata.variables,
        primaryDescription: parsed.template.metadata.primaryDescription,
        primaryOutput,
    };
    const images = Array.isArray(extra.imageResolutions)
        ? extra.imageResolutions.filter((item): item is Record<string, unknown> & {
            variableKey: string;
            source: string;
        } => isRecord(item) && typeof item.variableKey === 'string' && typeof item.source === 'string')
        : [];
    return {
        templateId: extra.templateId,
        templateName: extra.templateName,
        baseUrl: extra.comfyuiBaseUrl,
        primaryOutput,
        parameterSchema,
        variables: parsed.template.metadata.variables.map((variable) => ({
            key: variable.key,
            label: variable.label,
            type: variable.type,
            value: Object.hasOwn(values, variable.key) ? values[variable.key] : undefined,
        })),
        images,
    };
}

export function withComfyTaskSnapshot<T extends Task>(task: T): T & {
    comfyui_snapshot?: ComfyTaskSnapshotView;
} {
    const snapshot = getComfyTaskSnapshotView(task);
    return snapshot ? { ...task, comfyui_snapshot: snapshot } : task;
}
