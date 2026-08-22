import { randomUUID } from 'crypto';
import { getDb } from './database.js';
import {
    parseWorkflowTemplateDocument,
    serializeWorkflowTemplateDocument,
} from './comfy-workflow-template.js';

export interface WorkflowTemplateRecord {
    id: string;
    name: string;
    document: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

interface WorkflowTemplateRow extends Omit<WorkflowTemplateRecord, 'enabled'> {
    enabled: number;
}

export interface CreateWorkflowTemplateParams {
    document: string;
    enabled?: boolean;
    confirmWarnings?: boolean;
}

export class WorkflowTemplateWarningConfirmationError extends Error {
    constructor(public readonly warnings: string[]) {
        super('工作流模板包含需要确认的警告');
        this.name = 'WorkflowTemplateWarningConfirmationError';
    }
}

function mapRow(row: WorkflowTemplateRow): WorkflowTemplateRecord {
    return { ...row, enabled: row.enabled === 1 };
}

function requireValidDocument(document: string, confirmWarnings = false): string {
    const validation = parseWorkflowTemplateDocument(document);
    if (!validation.template || validation.errors.length > 0) {
        throw new Error(validation.errors.join('\n') || '工作流模板文档无效');
    }
    if (validation.warnings.length > 0 && !confirmWarnings) {
        throw new WorkflowTemplateWarningConfirmationError(validation.warnings);
    }
    return validation.template.metadata.name.trim();
}

export function createWorkflowTemplate(
    params: CreateWorkflowTemplateParams
): WorkflowTemplateRecord {
    const db = getDb();
    const id = randomUUID();
    const name = requireValidDocument(params.document, params.confirmWarnings);
    db.prepare(`
        INSERT INTO comfy_workflow_templates (id, name, document, enabled)
        VALUES (@id, @name, @document, @enabled)
    `).run({
        id,
        name,
        document: params.document,
        enabled: params.enabled === false ? 0 : 1,
    });
    return mapRow(
        db.prepare('SELECT * FROM comfy_workflow_templates WHERE id = ?').get(id) as WorkflowTemplateRow
    );
}

export function getAllWorkflowTemplates(): WorkflowTemplateRecord[] {
    const rows = getDb()
        .prepare('SELECT * FROM comfy_workflow_templates ORDER BY created_at DESC, name COLLATE NOCASE')
        .all() as WorkflowTemplateRow[];
    return rows.map(mapRow);
}

export function getWorkflowTemplateById(id: string): WorkflowTemplateRecord | undefined {
    const row = getDb()
        .prepare('SELECT * FROM comfy_workflow_templates WHERE id = ?')
        .get(id) as WorkflowTemplateRow | undefined;
    return row ? mapRow(row) : undefined;
}

export function searchWorkflowTemplates(query: string): WorkflowTemplateRecord[] {
    const rows = getDb()
        .prepare(`
            SELECT * FROM comfy_workflow_templates
            WHERE name LIKE @query COLLATE NOCASE
            ORDER BY created_at DESC, name COLLATE NOCASE
        `)
        .all({ query: `%${query}%` }) as WorkflowTemplateRow[];
    return rows.map(mapRow);
}

export function updateWorkflowTemplate(
    id: string,
    params: CreateWorkflowTemplateParams
): WorkflowTemplateRecord | undefined {
    if (!getWorkflowTemplateById(id)) return undefined;
    const name = requireValidDocument(params.document, params.confirmWarnings);
    getDb().prepare(`
        UPDATE comfy_workflow_templates
        SET name = @name,
            document = @document,
            enabled = COALESCE(@enabled, enabled),
            updated_at = datetime('now')
        WHERE id = @id
    `).run({
        id,
        name,
        document: params.document,
        enabled: params.enabled === undefined ? null : params.enabled ? 1 : 0,
    });
    return getWorkflowTemplateById(id);
}

export function setWorkflowTemplateEnabled(
    id: string,
    enabled: boolean
): WorkflowTemplateRecord | undefined {
    const result = getDb().prepare(`
        UPDATE comfy_workflow_templates
        SET enabled = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(enabled ? 1 : 0, id);
    return result.changes > 0 ? getWorkflowTemplateById(id) : undefined;
}

export function duplicateWorkflowTemplate(
    id: string,
    name: string,
    confirmWarnings = false
): WorkflowTemplateRecord | undefined {
    const source = getWorkflowTemplateById(id);
    if (!source) return undefined;
    const parsed = parseWorkflowTemplateDocument(source.document);
    if (!parsed.template) throw new Error(parsed.errors.join('\n'));
    parsed.template.metadata.name = name.trim();
    return createWorkflowTemplate({
        document: serializeWorkflowTemplateDocument(parsed.template),
        enabled: false,
        confirmWarnings,
    });
}

export function deleteWorkflowTemplate(id: string): boolean {
    return getDb().prepare('DELETE FROM comfy_workflow_templates WHERE id = ?').run(id).changes > 0;
}
