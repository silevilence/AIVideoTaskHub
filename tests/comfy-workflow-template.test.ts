import { describe, expect, it } from 'vitest';
import {
    parseWorkflowTemplateDocument,
    serializeWorkflowTemplateDocument,
} from '../src/server/comfy-workflow-template.js';

const validDocument = `---
schemaVersion: 1
name: 基础文生视频
primaryDescription: prompt
primaryOutput:
  nodeId: "9"
  field: videos
  index: 0
variables:
  - key: prompt
    label: 提示词
    type: string
    multiline: true
    minLength: 1
  - key: steps
    label: 采样步数
    type: integer
    default: 20
    min: 1
    max: 100
    step: 1
---
{
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": { "text": "\${prompt}" }
  },
  "7": {
    "class_type": "KSampler",
    "inputs": { "steps": "\${steps}" }
  },
  "9": {
    "class_type": "VHS_VideoCombine",
    "inputs": { "images": ["7", 0] }
  }
}`;

function imageDocument(defaultValue: string): string {
    return validDocument
        .replace('primaryDescription: prompt\n', '')
        .replace(
            '    type: string\n    multiline: true\n    minLength: 1',
            `    type: image\n    default: ${defaultValue}`
        );
}

describe('ComfyUI 工作流模板文档', () => {
    it('解析合法的 YAML 头元数据与 API 格式 JSON', () => {
        const result = parseWorkflowTemplateDocument(validDocument);

        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.template?.metadata.name).toBe('基础文生视频');
        expect(result.template?.metadata.variables.map((variable) => variable.key)).toEqual([
            'prompt',
            'steps',
        ]);
        expect(result.template?.workflow['6']).toEqual({
            class_type: 'CLIPTextEncode',
            inputs: { text: '${prompt}' },
        });
    });

    it('使用未定义变量时阻止保存', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('${steps}', '${missingSteps}')
        );

        expect(result.errors).toContain('工作流使用了未定义变量：missingSteps');
        expect(result.template).toBeUndefined();
    });

    it('定义但未使用的变量只产生可确认警告', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace(
                'variables:\n',
                'variables:\n  - key: seed\n    label: 随机种子\n    type: integer\n'
            )
        );

        expect(result.errors).toEqual([]);
        expect(result.warnings).toContain('模板变量已定义但未使用：seed');
        expect(result.template).toBeDefined();
    });

    it('拒绝 UI 画布工作流并提示导出 API 格式', () => {
        const uiDocument = validDocument.replace(
            /\{\n  "6":[\s\S]*$/,
            '{ "nodes": [], "links": [], "version": 1 }'
        );

        const result = parseWorkflowTemplateDocument(uiDocument);

        expect(result.errors).toContain('检测到 UI 工作流，请使用 ComfyUI 的 Save (API Format) 导出');
    });

    it('拒绝重复的变量键', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('  - key: steps', '  - key: prompt')
        );

        expect(result.errors).toContain('模板变量键重复：prompt');
    });

    it('拒绝不满足数值约束的默认值', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('    default: 20', '    default: 120')
        );

        expect(result.errors).toContain('变量 steps 的默认值必须小于等于 100');
    });

    it('拒绝不存在的主输出节点', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('  nodeId: "9"', '  nodeId: "99"')
        );

        expect(result.errors).toContain('主输出节点不存在：99');
    });

    it('主描述只能引用 string 类型变量', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('primaryDescription: prompt', 'primaryDescription: steps')
        );

        expect(result.errors).toContain('主描述变量必须引用 string 类型变量：steps');
    });

    it('拒绝 inputs 之外的变量引用', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('"class_type": "KSampler"', '"class_type": "${steps}"')
        );

        expect(result.errors).toContain('模板变量只能出现在节点 inputs 的值中：steps');
    });

    it('只有 string 变量允许内嵌插值', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('"steps": "${steps}"', '"steps": "value-${steps}"')
        );

        expect(result.errors).toContain('非 string 变量只能作为完整令牌使用：steps');
    });

    it('选项默认值必须属于唯一的内部值集合', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace(
                '    type: string\n    multiline: true\n    minLength: 1',
                '    type: option\n    default: missing\n    options:\n      - label: Euler\n        value: euler'
            ).replace('primaryDescription: prompt\n', '')
        );

        expect(result.errors).toContain('变量 prompt 的默认值不在选项中：missing');
    });

    it('字符串默认值必须满足长度约束', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace(
                '    minLength: 1',
                '    minLength: 1\n    maxLength: 3\n    default: abcd'
            )
        );

        expect(result.errors).toContain('变量 prompt 的默认值长度不能大于 3');
    });

    it('布尔变量默认值必须是布尔值', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('    type: integer', '    type: boolean')
        );

        expect(result.errors).toContain('变量 steps 的默认值必须是布尔值');
    });

    it('序列化后的组合文档可再次无损解析语义', () => {
        const parsed = parseWorkflowTemplateDocument(validDocument).template!;
        parsed.metadata.name = '副本模板';

        const serialized = serializeWorkflowTemplateDocument(parsed);
        const reparsed = parseWorkflowTemplateDocument(serialized);

        expect(reparsed.errors).toEqual([]);
        expect(reparsed.template).toEqual(parsed);
    });

    it('主输出序号省略时默认使用 0', () => {
        const result = parseWorkflowTemplateDocument(validDocument.replace('  index: 0\n', ''));

        expect(result.errors).toEqual([]);
        expect(result.template?.metadata.primaryOutput.index).toBe(0);
    });

    it('拒绝不符合变量键规则的占位符语法', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('${steps}', '${bad-key}')
        );

        expect(result.errors).toContain('占位符语法非法：${bad-key}');
    });

    it('数值默认值必须与 min 和 step 对齐', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument.replace('    step: 1', '    step: 2')
        );

        expect(result.errors).toContain('变量 steps 的默认值必须符合 step: 2');
    });

    it('图片默认值必须是可识别的图片来源', () => {
        const result = parseWorkflowTemplateDocument(imageDocument('not-an-image'));

        expect(result.errors).toContain('变量 prompt 的默认值不是可识别的图片来源');
    });

    it.each(['http://?', '/uploads/../app.db'])(
        '拒绝畸形或越界的图片来源：%s',
        (source) => {
            const result = parseWorkflowTemplateDocument(imageDocument(source));

            expect(result.errors).toContain('变量 prompt 的默认值不是可识别的图片来源');
        }
    );

    it.each([
        'https://example.com/image.png',
        '/uploads/550e8400-e29b-41d4-a716-446655440000.webp',
        'data:image/png;base64,aGVsbG8=',
    ])('接受创建页可识别的图片来源：%s', (source) => {
        const result = parseWorkflowTemplateDocument(imageDocument(source));

        expect(result.errors).toEqual([]);
    });

    it('支持满足范围和步长约束的小数变量', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument
                .replace('    type: integer\n    default: 20', '    type: number\n    default: 20.5')
                .replace('    step: 1', '    step: 0.5')
        );

        expect(result.errors).toEqual([]);
        expect(result.template?.metadata.variables[1].default).toBe(20.5);
    });

    it('拒绝倒置的数值范围和非正步长', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument
                .replace('    min: 1', '    min: 100')
                .replace('    max: 100', '    max: 10')
                .replace('    step: 1', '    step: 0')
        );

        expect(result.errors).toContain('变量 steps 的 min 不能大于 max');
        expect(result.errors).toContain('变量 steps 的 step 必须大于 0');
    });

    it('拒绝重复的选项内部值', () => {
        const result = parseWorkflowTemplateDocument(
            validDocument
                .replace('primaryDescription: prompt\n', '')
                .replace(
                    '    type: string\n    multiline: true\n    minLength: 1',
                    '    type: option\n    options:\n      - label: Euler\n        value: euler\n      - label: Euler A\n        value: euler'
                )
        );

        expect(result.errors).toContain('变量 prompt 的选项值重复：euler');
    });
});
