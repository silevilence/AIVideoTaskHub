// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

const componentModulePath = '../src/web/src/components/CreateTaskForm';

async function renderTaskForm(props: Record<string, unknown>) {
    const { CreateTaskForm } = await import(/* @vite-ignore */ componentModulePath);
    const Component = CreateTaskForm as unknown as React.ComponentType<Record<string, unknown>>;
    return render(React.createElement(Component, props));
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const settings = {
    comfyui: {
        displayName: 'ComfyUI',
        schema: [{
            key: 'base_url',
            label: 'ComfyUI 地址',
            required: true,
            defaultValue: 'http://127.0.0.1:8188',
        }],
        values: {},
        sources: { base_url: 'none' },
    },
};

describe('创建 ComfyUI 任务', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('没有启用模板时引导进入工作流管理', async () => {
        const onManage = vi.fn();
        vi.mocked(fetch).mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/api/providers/models')) return jsonResponse({ comfyui: [] });
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'comfyui', displayName: 'ComfyUI' }]);
            if (url.endsWith('/api/settings')) return jsonResponse(settings);
            throw new Error(`未模拟请求：${url}`);
        });

        const user = userEvent.setup();
        await renderTaskForm({ onCreated: () => undefined, onManageComfyWorkflows: onManage });

        await user.click(await screen.findByRole('button', { name: '管理工作流模板' }));
        expect(onManage).toHaveBeenCalledOnce();
        expect((screen.getByRole('button', { name: '创建任务' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('提交模板字段、默认值和本次地址而不发送旧式 Prompt 表单', async () => {
        const onCreated = vi.fn();
        let submitted: Record<string, unknown> | undefined;
        vi.mocked(fetch).mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/api/providers/models')) {
                return jsonResponse({
                    comfyui: [{
                        id: 'workflow-1',
                        displayName: '电影镜头',
                        parameterSchema: {
                            kind: 'comfyui-workflow',
                            primaryDescription: 'prompt',
                            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
                            variables: [
                                { key: 'prompt', label: '画面描述', type: 'string', multiline: true },
                                { key: 'steps', label: '步数', type: 'integer', default: 24 },
                            ],
                        },
                    }],
                });
            }
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'comfyui', displayName: 'ComfyUI' }]);
            if (url.endsWith('/api/settings')) return jsonResponse(settings);
            if (url.endsWith('/api/tasks')) {
                submitted = JSON.parse(String(init?.body));
                return jsonResponse({ id: 1 }, 201);
            }
            throw new Error(`未模拟请求：${url}`);
        });

        const user = userEvent.setup();
        await renderTaskForm({ onCreated });
        await user.type(await screen.findByLabelText('画面描述'), '穿越云海');
        await user.click(screen.getByRole('button', { name: '创建任务' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
        expect(screen.queryByLabelText('Prompt')).toBeNull();
        expect(submitted).toMatchObject({
            provider: 'comfyui',
            model: 'workflow-1',
            prompt: '穿越云海',
            extra: {
                workflowInputs: { prompt: '穿越云海', steps: 24 },
                comfyuiBaseUrl: 'http://127.0.0.1:8188',
            },
        });
    });
});
