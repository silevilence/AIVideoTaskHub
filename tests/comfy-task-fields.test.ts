// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
const componentModulePath = '../src/web/src/components/ComfyTaskFields';

async function loadFields() {
    return import(/* @vite-ignore */ componentModulePath);
}

const schema = {
    kind: 'comfyui-workflow',
    primaryDescription: 'prompt',
    primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
    variables: [
        { key: 'steps', label: '步数', description: '采样步数', type: 'integer', default: 20, min: 1, max: 40 },
        { key: 'cfg', label: '引导系数', type: 'number', step: 0.5 },
        { key: 'prompt', label: '提示词', type: 'string', multiline: true, minLength: 2, maxLength: 200 },
        { key: 'enhance', label: '启用增强', type: 'boolean', default: true },
        { key: 'safety', label: '安全检查', type: 'boolean' },
        {
            key: 'sampler',
            label: '采样器',
            type: 'option',
            default: 'euler',
            options: [{ label: 'Euler', value: 'euler' }, { label: 'DPM++', value: 'dpmpp' }],
        },
        { key: 'image', label: '输入图片', type: 'image' },
    ],
};

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('ComfyUI 动态任务字段', () => {
    it('按定义顺序生成所有控件并写入默认值', async () => {
        const { ComfyTaskFields, createComfyInputDefaults } = await loadFields();
        expect(createComfyInputDefaults(schema)).toEqual({
            steps: 20,
            cfg: '',
            prompt: '',
            enhance: true,
            safety: '',
            sampler: 'euler',
            image: '',
        });

        render(React.createElement(ComfyTaskFields, {
            schema,
            values: createComfyInputDefaults(schema),
            onChange: () => undefined,
            baseUrl: 'http://127.0.0.1:8188',
            onBaseUrlChange: () => undefined,
            errors: {},
        }));

        const labels = screen.getAllByTestId('comfy-variable-label').map((node) => node.textContent);
        expect(labels).toEqual(['步数', '引导系数', '提示词', '启用增强', '安全检查', '采样器', '输入图片']);
        expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('20');
        expect(screen.getByRole('radio', { name: '启用增强：启用' }).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByRole('radio', { name: '安全检查：启用' }).getAttribute('aria-checked')).toBe('false');
        expect(screen.getByRole('radio', { name: '安全检查：关闭' }).getAttribute('aria-checked')).toBe('false');
        expect((screen.getByLabelText('采样器') as HTMLSelectElement).value).toBe('euler');
        expect(screen.getByLabelText('提示词').tagName).toBe('TEXTAREA');
        expect(screen.getByLabelText('提示词').getAttribute('minlength')).toBe('2');
        expect(screen.getByLabelText('提示词').getAttribute('maxlength')).toBe('200');
        expect(screen.getByText('范围：1–40')).toBeTruthy();
        expect(screen.getByText('长度：2–200 个字符')).toBeTruthy();
    });

    it('将数字转换为原生类型并显示字段级错误', async () => {
        const { ComfyTaskFields, createComfyInputDefaults } = await loadFields();
        const changes: Array<[string, unknown]> = [];
        render(React.createElement(ComfyTaskFields, {
            schema,
            values: createComfyInputDefaults(schema),
            onChange: (key: string, value: unknown) => changes.push([key, value]),
            baseUrl: '',
            onBaseUrlChange: () => undefined,
            errors: { prompt: '提示词不能为空' },
        }));

        fireEvent.change(screen.getByLabelText('引导系数'), { target: { value: '7.5' } });
        fireEvent.change(screen.getByLabelText('步数'), { target: { value: '' } });

        expect(changes).toContainEqual(['cfg', 7.5]);
        expect(changes).toContainEqual(['steps', '']);
        expect(screen.getByText('提示词不能为空')).toBeTruthy();
        expect(screen.getByLabelText('提示词').getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByLabelText('本次 ComfyUI 地址')).toBeTruthy();
    });

    it('提交前检查数值、字符串、选项和图片约束', async () => {
        const {
            createComfyInputDefaults,
            validateComfyBaseUrl,
            validateComfyInputValues,
        } = await loadFields();
        const values = createComfyInputDefaults(schema);
        Object.assign(values, {
            steps: 41,
            cfg: 1.25,
            prompt: '',
            sampler: 'unknown',
            image: 'javascript:alert(1)',
        });

        expect(validateComfyInputValues(schema, values)).toMatchObject({
            steps: '步数不能大于 40',
            prompt: '提示词不能为空',
            sampler: '采样器必须是有效选项',
            image: '输入图片必须是可识别的图片来源',
        });
        expect(validateComfyBaseUrl('file:///tmp/comfy')).toBe('本次 ComfyUI 地址仅支持 HTTP 或 HTTPS');
        expect(validateComfyBaseUrl('https://render.lan:8188/?token=x')).toBe('本次 ComfyUI 地址不能包含查询参数或片段');
        expect(validateComfyBaseUrl('https://render.lan:8188/#status')).toBe('本次 ComfyUI 地址不能包含查询参数或片段');
        expect(validateComfyBaseUrl('https://render.lan:8188/')).toBeUndefined();
    });

    it('图片字段支持本地上传和从现有图片库选择', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/api/upload')) {
                return new Response(JSON.stringify({
                    url: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
                    base64: 'data:image/png;base64,aGVsbG8=',
                }), { status: 200 });
            }
            if (url.endsWith('/api/uploads')) {
                return new Response(JSON.stringify([{
                    url: '/uploads/123e4567-e89b-12d3-a456-426614174001.png',
                    filename: 'existing.png',
                    size: 5,
                    createdAt: '2026-08-22T00:00:00.000Z',
                }]), { status: 200 });
            }
            throw new Error(`未模拟请求：${url}`);
        }));
        const { ComfyTaskFields, createComfyInputDefaults } = await loadFields();
        const changes: Array<[string, unknown]> = [];
        render(React.createElement(ComfyTaskFields, {
            schema,
            values: createComfyInputDefaults(schema),
            onChange: (key: string, value: unknown) => changes.push([key, value]),
            baseUrl: 'http://127.0.0.1:8188',
            onBaseUrlChange: () => undefined,
            errors: {},
        }));

        const fileInput = screen.getByTestId('comfy-image-file-comfy-input-image');
        expect(fileInput.getAttribute('tabindex')).toBe('-1');
        expect(screen.getByRole('button', { name: '上传 输入图片' })).toBeTruthy();
        const file = new File([new Uint8Array([1, 2, 3])], 'new.png', { type: 'image/png' });
        fireEvent.change(fileInput, { target: { files: [file] } });
        await waitFor(() => expect(changes).toContainEqual([
            'image',
            '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
        ]));

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: '打开 输入图片 图片库' }));
        await user.click(await screen.findByRole('button', { name: '选择图片 existing.png' }));
        expect(changes).toContainEqual([
            'image',
            '/uploads/123e4567-e89b-12d3-a456-426614174001.png',
        ]);
    });
});
