import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, initDb } from '../src/server/database.js';
import {
    createWorkflowTemplate,
    deleteWorkflowTemplate,
    duplicateWorkflowTemplate,
    getAllWorkflowTemplates,
    getWorkflowTemplateById,
    searchWorkflowTemplates,
    setWorkflowTemplateEnabled,
    updateWorkflowTemplate,
} from '../src/server/comfy-workflow-model.js';
import { comfyWorkflowTemplateDocument as templateDocument } from './fixtures/comfy-workflow.js';

describe('ComfyUI 工作流模板数据层', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    it('使用稳定 UUID 创建模板并原样保存组合文档', () => {
        const document = templateDocument('基础模板');

        const created = createWorkflowTemplate({ document, enabled: true });

        expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(created.name).toBe('基础模板');
        expect(created.document).toBe(document);
        expect(created.enabled).toBe(true);
        expect(getAllWorkflowTemplates()).toEqual([created]);
    });

    it('支持查询、搜索、更新、复制、启停和删除完整生命周期', () => {
        const created = createWorkflowTemplate({ document: templateDocument('基础模板') });

        expect(getWorkflowTemplateById(created.id)?.name).toBe('基础模板');
        expect(searchWorkflowTemplates('基础').map((item) => item.id)).toEqual([created.id]);

        const updatedDocument = templateDocument('更新模板');
        const updated = updateWorkflowTemplate(created.id, { document: updatedDocument });
        expect(updated?.name).toBe('更新模板');
        expect(updated?.document).toBe(updatedDocument);

        const disabled = setWorkflowTemplateEnabled(created.id, false);
        expect(disabled?.enabled).toBe(false);

        const duplicate = duplicateWorkflowTemplate(created.id, '更新模板副本');
        expect(duplicate?.id).not.toBe(created.id);
        expect(duplicate?.name).toBe('更新模板副本');
        expect(duplicate?.enabled).toBe(false);

        expect(deleteWorkflowTemplate(created.id)).toBe(true);
        expect(getWorkflowTemplateById(created.id)).toBeUndefined();
    });

    it('数据层创建和更新模板时也要求显式确认警告', () => {
        const warningDocument = templateDocument('警告模板', { includeUnused: true });

        expect(() => createWorkflowTemplate({ document: warningDocument })).toThrow(
            '工作流模板包含需要确认的警告'
        );
        const created = createWorkflowTemplate({
            document: warningDocument,
            confirmWarnings: true,
        });

        const updatedDocument = templateDocument('更新警告模板', { includeUnused: true });
        expect(() => updateWorkflowTemplate(created.id, { document: updatedDocument })).toThrow(
            '工作流模板包含需要确认的警告'
        );
        expect(updateWorkflowTemplate(created.id, {
            document: updatedDocument,
            confirmWarnings: true,
        })?.name).toBe('更新警告模板');

        expect(() => duplicateWorkflowTemplate(created.id, '警告副本')).toThrow(
            '工作流模板包含需要确认的警告'
        );
        expect(duplicateWorkflowTemplate(created.id, '警告副本', true)?.name).toBe('警告副本');
    });
});
