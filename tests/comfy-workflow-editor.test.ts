import { describe, expect, it } from 'vitest';
import {
    composeWorkflowTemplateDocument,
    formatWorkflowJson,
    highlightWorkflowJson,
    splitWorkflowTemplateDocument,
    validateWorkflowJson,
} from '../src/web/src/lib/comfy-workflow-editor.js';
import { comfyWorkflowTemplateDocument } from './fixtures/comfy-workflow.js';

describe('ComfyUI 工作流编辑器逻辑', () => {
    it('将组合文档拆成结构化元数据与纯 JSON，并可重新组合', () => {
        const document = comfyWorkflowTemplateDocument('编辑器模板');

        const draft = splitWorkflowTemplateDocument(document);

        expect(draft.metadata.name).toBe('编辑器模板');
        expect(draft.json.trimStart()).toMatch(/^\{/);
        expect(draft.json).not.toContain('schemaVersion:');
        const reparsed = splitWorkflowTemplateDocument(
            composeWorkflowTemplateDocument(draft.metadata, draft.json)
        );
        expect(reparsed.metadata).toEqual(draft.metadata);
        expect(JSON.parse(reparsed.json)).toEqual(JSON.parse(draft.json));
    });

    it('主输出序号省略时与后端一致地默认使用 0', () => {
        const draft = splitWorkflowTemplateDocument(`---
schemaVersion: 1
name: 默认输出序号
primaryOutput:
  nodeId: "1"
  field: videos
variables: []
---
{"1":{"class_type":"SaveVideo","inputs":{}}}`);

        expect(draft.metadata.primaryOutput.index).toBe(0);
    });

    it('导入时拒绝缺少结构化面板字段的 YAML 元数据', () => {
        expect(() => splitWorkflowTemplateDocument(`---
schemaVersion: 1
name: 残缺模板
---
{}`)).toThrow('组合文档缺少有效的 variables 元数据');
    });

    it.each([
        'variables:\n  - null',
        'variables:\n  - key: sampler\n    label: 采样器\n    type: option\n    options: {}',
    ])('导入时拒绝可能导致变量面板崩溃的 schema：%s', (variables) => {
        expect(() => splitWorkflowTemplateDocument(`---
schemaVersion: 1
name: 非法变量
primaryOutput:
  nodeId: "1"
  field: videos
  index: 0
${variables}
---
{}`)).toThrow('组合文档包含无法编辑的变量 schema');
    });

    it('导入时拒绝字段类型非法的选项变量', () => {
        expect(() => splitWorkflowTemplateDocument(`---
schemaVersion: 1
name: 非法选项字段
primaryOutput: { nodeId: "1", field: videos, index: 0 }
variables:
  - key: style
    label: 风格
    type: option
    default: anime
    options:
      - label: { nested: bad }
        value: anime
---
{"1":{"class_type":"SaveVideo","inputs":{}}}`)).toThrow(
            '组合文档包含无法编辑的变量 schema'
        );
    });

    it.each([
        'key: { nested: bad }\n    label: 提示词\n    type: string',
        'key: prompt\n    label: { nested: bad }\n    type: string',
        'key: prompt\n    label: 提示词\n    description: [bad]\n    type: string',
        'key: steps\n    label: 步数\n    type: integer\n    min: bad',
        'key: enabled\n    label: 启用\n    type: boolean\n    default: yes',
    ])('导入时拒绝编辑器无法安全表示的变量字段：%s', (variable) => {
        expect(() => splitWorkflowTemplateDocument(`---
schemaVersion: 1
name: 非法变量字段
primaryOutput: { nodeId: "1", field: videos, index: 0 }
variables:
  - ${variable}
---
{"1":{"class_type":"SaveVideo","inputs":{}}}`)).toThrow(
            '组合文档包含无法编辑的变量 schema'
        );
    });

    it('JSON 语法错误包含准确的行列位置', () => {
        const diagnostics = validateWorkflowJson('{\n  "1": {\n    "class_type": }\n  }\n}');

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({
            severity: 'error',
            code: 'json-syntax',
            line: 3,
        });
        expect(diagnostics[0].column).toBeGreaterThan(1);
    });

    it('识别 UI 画布工作流并给出 API Format 指引', () => {
        const diagnostics = validateWorkflowJson(JSON.stringify({ nodes: [], links: [] }));

        expect(diagnostics).toEqual([expect.objectContaining({
            severity: 'error',
            code: 'ui-workflow',
            message: expect.stringContaining('Save (API Format)'),
        })]);
    });

    it.each([
        ['{}', 'API 格式工作流至少需要一个节点'],
        ['{"1":{"class_type":"","inputs":{}}}', '节点 1 缺少有效的 class_type 或 inputs'],
    ])('拒绝后端同样会拒绝的 API 基础结构：%s', (json, message) => {
        expect(validateWorkflowJson(json)).toEqual([
            expect.objectContaining({ severity: 'error', code: 'api-workflow', message }),
        ]);
    });

    it('格式化合法 JSON，非法 JSON 则保留原文', () => {
        expect(formatWorkflowJson('{"1":{"class_type":"Node","inputs":{}}}')).toBe(
            '{\n  "1": {\n    "class_type": "Node",\n    "inputs": {}\n  }\n}'
        );
        expect(formatWorkflowJson('{oops')).toBe('{oops');
    });

    it('高亮 JSON token 并转义潜在 HTML', () => {
        const highlighted = highlightWorkflowJson('{"text":"<script>","value":12,"ok":true}');

        expect(highlighted).toContain('class="json-key"');
        expect(highlighted).toContain('class="json-number"');
        expect(highlighted).toContain('class="json-literal"');
        expect(highlighted).toContain('&lt;script&gt;');
        expect(highlighted).not.toContain('<script>');
    });
});
