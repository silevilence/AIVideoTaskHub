import { describe, expect, it } from 'vitest';
import {
    WorkflowInputValidationError,
    renderWorkflowTemplate,
} from '../src/server/comfy-workflow-renderer.js';
import type { ParsedWorkflowTemplate } from '../src/server/comfy-workflow-template.js';

function template(): ParsedWorkflowTemplate {
    return {
        metadata: {
            schemaVersion: 1,
            name: '动态视频',
            primaryDescription: 'prompt',
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            variables: [
                { key: 'prompt', label: '提示词', type: 'string', minLength: 2, maxLength: 20 },
                { key: 'steps', label: '步数', type: 'integer', default: 20, min: 1, max: 40, step: 1 },
                { key: 'cfg', label: '引导系数', type: 'number', min: 0, max: 10, step: 0.5 },
                { key: 'enabled', label: '启用增强', type: 'boolean', default: false },
                {
                    key: 'sampler',
                    label: '采样器',
                    type: 'option',
                    options: [
                        { label: 'Euler', value: 'euler' },
                        { label: 'DPM++', value: 'dpmpp' },
                    ],
                    default: 'euler',
                },
                { key: 'image', label: '输入图', type: 'image' },
            ],
        },
        workflow: {
            '1': {
                class_type: 'Sampler',
                inputs: {
                    text: 'cinematic ${prompt}',
                    steps: '${steps}',
                    cfg: '${cfg}',
                    enabled: '${enabled}',
                    sampler: '${sampler}',
                    image: '${image}',
                    link: ['0', 0],
                },
            },
            '2': { class_type: 'SaveVideo', inputs: { source: ['1', 0] } },
        },
    };
}

describe('ComfyUI 工作流模板渲染', () => {
    it('按变量类型替换 inputs 中显式提交的合法令牌', () => {
        const result = renderWorkflowTemplate(template(), {
            prompt: '海边日落',
            steps: 20,
            cfg: 7.5,
            enabled: true,
            sampler: 'dpmpp',
            image: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
        });

        expect(result.values).toEqual({
            prompt: '海边日落',
            steps: 20,
            cfg: 7.5,
            enabled: true,
            sampler: 'dpmpp',
            image: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
        });
        expect(result.primaryDescription).toBe('海边日落');
        expect(result.workflow['1']).toEqual({
            class_type: 'Sampler',
            inputs: {
                text: 'cinematic 海边日落',
                steps: 20,
                cfg: 7.5,
                enabled: true,
                sampler: 'dpmpp',
                image: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
                link: ['0', 0],
            },
        });
        expect(template().workflow['1'].inputs.steps).toBe('${steps}');
    });

    it.each([
        [{ cfg: 1.25 }, 'cfg 必须符合步进 0.5'],
        [{ steps: 2.5 }, 'steps 必须是整数'],
        [{ prompt: 'a' }, 'prompt 长度不能小于 2'],
        [{ sampler: 'unknown' }, 'sampler 必须是已定义的选项'],
        [{ image: 'javascript:alert(1)' }, 'image 必须是可识别的图片来源'],
        [{ enabled: 'true' }, 'enabled 必须是布尔值'],
    ])('拒绝非法变量 %#', (override, message) => {
        expect(() => renderWorkflowTemplate(template(), {
            prompt: '海边日落',
            steps: 20,
            cfg: 7.5,
            enabled: true,
            sampler: 'euler',
            image: 'https://example.com/input.png',
            ...override,
        })).toThrow(message);
    });

    it('一次报告缺失、未知和非法字段且不渲染部分结果', () => {
        try {
            renderWorkflowTemplate(template(), {
                prompt: '',
                steps: 20,
                cfg: 99,
                enabled: false,
                sampler: 'euler',
                image: 'https://example.com/input.png',
                injected: 'evil',
            });
            throw new Error('expected validation failure');
        } catch (error) {
            expect(error).toBeInstanceOf(WorkflowInputValidationError);
            expect((error as WorkflowInputValidationError).errors).toEqual(expect.arrayContaining([
                'prompt 不能为空',
                'cfg 不能大于 10',
                '存在未定义的变量值：injected',
            ]));
        }
    });

    it('带默认值的变量仍必须由调用方显式提交', () => {
        expect(() => renderWorkflowTemplate(template(), {
            prompt: '海边日落',
            cfg: 7.5,
            enabled: true,
            sampler: 'euler',
            image: 'https://example.com/input.png',
        })).toThrow('steps 不能为空');

        expect(() => renderWorkflowTemplate(template(), {
            prompt: '海边日落',
            steps: null,
            cfg: 7.5,
            enabled: true,
            sampler: 'euler',
            image: 'https://example.com/input.png',
        })).toThrow('steps 不能为空');
    });

    it('安全保存并替换 __proto__ 等合法变量键', () => {
        const source = template();
        source.metadata.variables = [{ key: '__proto__', label: '特殊键', type: 'string' }];
        source.metadata.primaryDescription = '__proto__';
        source.workflow['1'].inputs = { text: '${__proto__}' };
        const provided = JSON.parse('{"__proto__":"safe text"}') as Record<string, unknown>;

        const result = renderWorkflowTemplate(source, provided);

        expect(Object.hasOwn(result.values, '__proto__')).toBe(true);
        expect(result.values.__proto__).toBe('safe text');
        expect(result.workflow['1'].inputs.text).toBe('safe text');
        expect(result.primaryDescription).toBe('safe text');
        expect(Object.getPrototypeOf(result.workflow)).toBe(Object.prototype);
    });

    it('即使传入恶意字段也不会替换键名、节点 ID 或 class_type', () => {
        const source = template();
        source.workflow['${prompt}'] = source.workflow['1'];
        delete source.workflow['1'];

        const result = renderWorkflowTemplate(source, {
            prompt: '__proto__',
            steps: 20,
            cfg: 7.5,
            enabled: false,
            sampler: 'euler',
            image: 'https://example.com/input.png',
        });

        expect(Object.keys(result.workflow)).toContain('${prompt}');
        expect(result.workflow['${prompt}'].class_type).toBe('Sampler');
        expect(Object.getPrototypeOf(result.workflow)).toBe(Object.prototype);
    });

    it('渲染器独立拒绝非字符串变量的内嵌插值', () => {
        const source = template();
        source.workflow['1'].inputs.steps = 'steps=${steps}';

        expect(() => renderWorkflowTemplate(source, {
            prompt: '海边日落',
            steps: 20,
            cfg: 7.5,
            enabled: false,
            sampler: 'euler',
            image: 'https://example.com/input.png',
        })).toThrow('非 string 变量只能作为完整令牌使用：steps');
    });
});
