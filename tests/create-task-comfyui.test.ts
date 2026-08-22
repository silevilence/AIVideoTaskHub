// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
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

    it('原模板删除后仍能从历史快照恢复字段并创建等价任务', async () => {
        const sourceSnapshot = {
            snapshotVersion: 1,
            templateId: 'deleted-workflow',
            templateName: '已删除模板',
            templateDocument: 'historical-document',
            comfyuiBaseUrl: 'http://history-comfy:8188',
            workflowInputs: { prompt: '历史云海', steps: 36 },
            workflow: {},
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
        };
        const comfyuiSnapshot = {
            templateId: 'deleted-workflow',
            templateName: '已删除模板',
            baseUrl: 'http://history-comfy:8188',
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            parameterSchema: {
                kind: 'comfyui-workflow' as const,
                variables: [
                    { key: 'prompt', label: '画面描述', type: 'string' as const, multiline: true },
                    { key: 'steps', label: '步数', type: 'integer' as const, default: 24 },
                ],
                primaryDescription: 'prompt',
                primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            },
            variables: [
                { key: 'prompt', label: '画面描述', type: 'string', value: '历史云海' },
                { key: 'steps', label: '步数', type: 'integer', value: 36 },
            ],
            images: [],
        };
        let submitted: Record<string, unknown> | undefined;
        vi.mocked(fetch).mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/api/providers/models')) return jsonResponse({ comfyui: [] });
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'comfyui', displayName: 'ComfyUI' }]);
            if (url.endsWith('/api/settings')) return jsonResponse(settings);
            if (url.endsWith('/api/tasks')) {
                submitted = JSON.parse(String(init?.body));
                return jsonResponse({ id: 2 }, 201);
            }
            throw new Error(`未模拟请求：${url}`);
        });
        const onCreated = vi.fn();

        await renderTaskForm({
            onCreated,
            onApplyParamsConsumed: vi.fn(),
            applyParams: {
                sourceTaskId: 42,
                provider: 'comfyui',
                model: 'deleted-workflow',
                prompt: '历史云海',
                imageUrl: null,
                extraParams: sourceSnapshot,
                comfyuiSnapshot,
            },
        });

        expect((await screen.findByLabelText('画面描述') as HTMLTextAreaElement).value).toBe('历史云海');
        expect((screen.getByLabelText('步数') as HTMLInputElement).value).toBe('36');
        expect((screen.getByLabelText('本次 ComfyUI 地址') as HTMLInputElement).value).toBe(
            'http://history-comfy:8188'
        );
        await userEvent.setup().click(screen.getByRole('button', { name: '创建任务' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
        expect(submitted).toMatchObject({
            provider: 'comfyui',
            model: 'deleted-workflow',
            extra: {
                workflowInputs: { prompt: '历史云海', steps: 36 },
                comfyuiBaseUrl: 'http://history-comfy:8188',
                sourceTaskId: 42,
            },
        });
    });

    it('同 ID 模板已编辑时仍优先使用历史 schema', async () => {
        const comfyuiSnapshot = {
            templateId: 'workflow-1',
            templateName: '历史模板',
            baseUrl: 'http://history-comfy:8188',
            primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            parameterSchema: {
                kind: 'comfyui-workflow' as const,
                variables: [{ key: 'old_prompt', label: '历史画面描述', type: 'string' as const }],
                primaryDescription: 'old_prompt',
                primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
            },
            variables: [{ key: 'old_prompt', label: '历史画面描述', type: 'string', value: '旧值' }],
            images: [],
        };
        let submitted: Record<string, unknown> | undefined;
        vi.mocked(fetch).mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.endsWith('/api/providers/models')) {
                return jsonResponse({
                    comfyui: [{
                        id: 'workflow-1',
                        displayName: '当前模板',
                        parameterSchema: {
                            kind: 'comfyui-workflow',
                            variables: [{ key: 'new_prompt', label: '新版画面描述', type: 'string' }],
                            primaryDescription: 'new_prompt',
                            primaryOutput: { nodeId: '9', field: 'videos', index: 0 },
                        },
                    }],
                });
            }
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'comfyui', displayName: 'ComfyUI' }]);
            if (url.endsWith('/api/settings')) return jsonResponse(settings);
            if (url.endsWith('/api/tasks')) {
                submitted = JSON.parse(String(init?.body));
                return jsonResponse({ id: 3 }, 201);
            }
            throw new Error(`未模拟请求：${url}`);
        });

        await renderTaskForm({
            onCreated: vi.fn(),
            onApplyParamsConsumed: vi.fn(),
            applyParams: {
                sourceTaskId: 77,
                provider: 'comfyui',
                model: 'workflow-1',
                prompt: '旧值',
                imageUrl: null,
                extraParams: {},
                comfyuiSnapshot,
            },
        });

        expect((await screen.findByLabelText('历史画面描述') as HTMLInputElement).value).toBe('旧值');
        expect(screen.queryByLabelText('新版画面描述')).toBeNull();
        expect(screen.getByRole('button', { name: '模型' }).textContent).toContain('历史模板（历史快照）');
        await userEvent.setup().click(screen.getByRole('button', { name: '创建任务' }));
        await waitFor(() => expect(submitted).toBeDefined());
        expect(submitted).toMatchObject({
            model: 'workflow-1',
            extra: {
                workflowInputs: { old_prompt: '旧值' },
                sourceTaskId: 77,
            },
        });
    });

    it('从轻量任务列表套用时按 id 懒加载完整历史快照', async () => {
        const task = {
            id: 9,
            provider: 'comfyui',
            provider_task_id: 'remote-9',
            status: 'failed',
            prompt: '轻量历史',
            model: 'deleted-workflow',
            image_url: null,
            result_url: null,
            error_message: 'failed',
            extra_params: null,
            retry_count: 0,
            created_at: '2026-08-22 00:00:00',
            updated_at: '2026-08-22 00:00:00',
            deleted_at: null,
            purged_at: null,
        };
        const detail = {
            ...task,
            extra_params: JSON.stringify({ snapshotVersion: 1 }),
            comfyui_snapshot: {
                templateId: 'deleted-workflow',
                templateName: '历史模板',
                baseUrl: 'http://history-comfy:8188',
                primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
                parameterSchema: {
                    kind: 'comfyui-workflow',
                    variables: [{ key: 'prompt', label: '历史提示词', type: 'string' }],
                    primaryDescription: 'prompt',
                    primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
                },
                variables: [{ key: 'prompt', label: '历史提示词', type: 'string', value: '完整值' }],
                images: [],
            },
        };
        vi.mocked(fetch).mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/api/providers/models')) return jsonResponse({ comfyui: [] });
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'comfyui', displayName: 'ComfyUI' }]);
            if (url.endsWith('/api/settings')) return jsonResponse(settings);
            if (url.endsWith('/api/tasks')) return jsonResponse([task]);
            if (url.endsWith('/api/trash')) return jsonResponse([]);
            if (url.endsWith('/api/tasks/9')) return jsonResponse(detail);
            throw new Error(`未模拟请求：${url}`);
        });
        const user = userEvent.setup();
        await renderTaskForm({ onCreated: vi.fn() });

        await user.click(await screen.findByRole('button', { name: '套用参数' }));
        expect(await screen.findByText('轻量历史')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: '套用' }));

        expect((await screen.findByLabelText('历史提示词') as HTMLInputElement).value).toBe('完整值');
        expect(fetch).toHaveBeenCalledWith('/api/tasks/9');
    });

    it('连续套用两个轻量任务时忽略较晚返回的旧请求', async () => {
        const makeTask = (id: number, prompt: string) => ({
            id,
            provider: 'comfyui',
            provider_task_id: `remote-${id}`,
            status: 'failed',
            prompt,
            model: `deleted-${id}`,
            image_url: null,
            result_url: null,
            error_message: 'failed',
            extra_params: null,
            retry_count: 0,
            created_at: '2026-08-22 00:00:00',
            updated_at: '2026-08-22 00:00:00',
            deleted_at: null,
            purged_at: null,
        });
        const tasks = [makeTask(1, '先请求'), makeTask(2, '后请求')];
        const makeDetail = (task: typeof tasks[number], value: string) => ({
            ...task,
            extra_params: JSON.stringify({ snapshotVersion: 1 }),
            comfyui_snapshot: {
                templateId: task.model,
                templateName: `模板${task.id}`,
                baseUrl: 'http://history-comfy:8188',
                primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
                parameterSchema: {
                    kind: 'comfyui-workflow',
                    variables: [{ key: 'prompt', label: '历史提示词', type: 'string' }],
                    primaryDescription: 'prompt',
                    primaryOutput: { nodeId: '2', field: 'videos', index: 0 },
                },
                variables: [{ key: 'prompt', label: '历史提示词', type: 'string', value }],
                images: [],
            },
        });
        const first = deferred<Response>();
        const second = deferred<Response>();
        vi.mocked(fetch).mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/api/providers/models')) return jsonResponse({ comfyui: [] });
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'comfyui', displayName: 'ComfyUI' }]);
            if (url.endsWith('/api/settings')) return jsonResponse(settings);
            if (url.endsWith('/api/tasks')) return jsonResponse(tasks);
            if (url.endsWith('/api/trash')) return jsonResponse([]);
            if (url.endsWith('/api/tasks/1')) return first.promise;
            if (url.endsWith('/api/tasks/2')) return second.promise;
            throw new Error(`未模拟请求：${url}`);
        });
        const user = userEvent.setup();
        await renderTaskForm({ onCreated: vi.fn() });

        await user.click(await screen.findByRole('button', { name: '套用参数' }));
        await screen.findByText('先请求');
        await user.click(screen.getAllByRole('button', { name: '套用' })[0]);
        await user.click(screen.getByRole('button', { name: '套用' }));
        await act(async () => second.resolve(jsonResponse(makeDetail(tasks[1], '后值'))));
        expect((await screen.findByLabelText('历史提示词') as HTMLInputElement).value).toBe('后值');

        await act(async () => first.resolve(jsonResponse(makeDetail(tasks[0], '先值'))));
        await waitFor(() => {
            expect((screen.getByLabelText('历史提示词') as HTMLInputElement).value).toBe('后值');
        });
    });
});
