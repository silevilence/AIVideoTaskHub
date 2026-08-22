// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

const componentModulePath = '../src/web/src/components/ComfyWorkflowManager';

async function renderManager() {
    const { ComfyWorkflowManager } = await import(/* @vite-ignore */ componentModulePath);
    return render(React.createElement(ComfyWorkflowManager));
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function template(id: string, name: string) {
    return {
        id,
        name,
        document: '',
        enabled: true,
        created_at: '2026-08-22 00:00:00',
        updated_at: '2026-08-22 00:00:00',
    };
}

const validDocument = `---
schemaVersion: 1
name: 原模板
primaryOutput:
  nodeId: "1"
  field: videos
  index: 0
variables: []
---
{"1":{"class_type":"SaveVideo","inputs":{}}}`;

describe('ComfyUI 工作流管理器交互', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/api/comfyui/settings')) return jsonResponse({ baseUrl: '' });
            if (url.includes('/api/comfyui/workflows')) return jsonResponse([]);
            throw new Error(`未模拟请求：${url}`);
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('连续编辑变量键时保持输入焦点和完整内容', async () => {
        const user = userEvent.setup();
        await renderManager();
        await user.click(await screen.findByRole('button', { name: '新建模板' }));
        await user.click(screen.getByRole('button', { name: '添加' }));

        const keyInput = screen.getByPlaceholderText('steps');
        await user.clear(keyInput);
        await user.type(screen.getByPlaceholderText('steps'), 'frame_count');

        const currentInput = screen.getByPlaceholderText('steps');
        expect((currentInput as HTMLInputElement).value).toBe('frame_count');
        expect(document.activeElement).toBe(currentInput);
        expect(screen.getByLabelText('变量键')).toBe(currentInput);

        const jsonEditor = screen.getByLabelText('ComfyUI API 工作流 JSON');
        await user.clear(jsonEditor);
        await user.type(jsonEditor, '{{');
        expect(jsonEditor.getAttribute('aria-invalid')).toBe('true');
        expect(jsonEditor.getAttribute('aria-describedby')).toBe('comfy-workflow-json-diagnostics');
    });

    it('较慢的旧搜索响应不会覆盖最新结果', async () => {
        let resolveOld!: (response: Response) => void;
        let resolveNew!: (response: Response) => void;
        const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
        const newResponse = new Promise<Response>((resolve) => { resolveNew = resolve; });
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/api/comfyui/settings')) return jsonResponse({ baseUrl: '' });
            if (url.endsWith('/api/comfyui/workflows')) return jsonResponse([]);
            if (url.endsWith('/api/comfyui/workflows?q=old')) return oldResponse;
            if (url.endsWith('/api/comfyui/workflows?q=new')) return newResponse;
            throw new Error(`未模拟请求：${url}`);
        }));
        await renderManager();
        const search = await screen.findByPlaceholderText('搜索工作流模板…');

        fireEvent.change(search, { target: { value: 'old' } });
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/comfyui/workflows?q=old', undefined));
        fireEvent.change(search, { target: { value: 'new' } });
        await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/comfyui/workflows?q=new', undefined));
        resolveNew(jsonResponse([template('new-id', '最新模板')]));
        expect(await screen.findByText('最新模板')).toBeTruthy();
        resolveOld(jsonResponse([template('old-id', '旧模板')]));

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(screen.queryByText('旧模板')).toBeNull();
        expect(screen.getByText('最新模板')).toBeTruthy();
    });

    it('离线校验失败不显示可继续保存的网络错误提示', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/api/comfyui/settings')) {
                return jsonResponse({ baseUrl: 'http://127.0.0.1:8188' });
            }
            if (url.endsWith('/api/comfyui/workflows')) return jsonResponse([]);
            if (url.endsWith('/api/comfyui/workflows/check')) {
                return jsonResponse({
                    error: '工作流模板校验失败',
                    errors: ['API 格式工作流至少需要一个节点'],
                }, 400);
            }
            throw new Error(`未模拟请求：${url}`);
        }));
        const user = userEvent.setup();
        await renderManager();
        await user.click(await screen.findByRole('button', { name: '新建模板' }));
        const checkButton = screen.getByRole('button', { name: '检查默认实例' });
        await waitFor(() => expect((checkButton as HTMLButtonElement).disabled).toBe(false));
        await user.click(checkButton);

        const alertText = await screen.findByText(
            '模板无法检查：API 格式工作流至少需要一个节点'
        );
        const alert = alertText.closest('[role="alert"]')!;
        expect(alert.textContent).toContain('模板无法检查：API 格式工作流至少需要一个节点');
        expect(alert.textContent).not.toContain('仍可离线保存');
    });

    it('在线兼容性结果展示具体输入不兼容原因', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/api/comfyui/settings')) {
                return jsonResponse({ baseUrl: 'http://127.0.0.1:8188' });
            }
            if (url.endsWith('/api/comfyui/workflows')) return jsonResponse([]);
            if (url.endsWith('/api/comfyui/workflows/check')) {
                return jsonResponse({
                    ok: false,
                    baseUrl: 'http://127.0.0.1:8188',
                    nodeTypeCount: 1,
                    missingNodeTypes: [],
                    missingRequiredInputs: [],
                    incompatibleInputs: [{
                        nodeId: '3',
                        classType: 'KSampler',
                        input: 'steps',
                        reason: '必须是整数',
                    }],
                });
            }
            throw new Error(`未模拟请求：${url}`);
        }));
        const user = userEvent.setup();
        await renderManager();
        await user.click(await screen.findByRole('button', { name: '新建模板' }));
        await user.click(screen.getByRole('button', { name: '检查默认实例' }));

        expect(await screen.findByText(/输入 steps：必须是整数/)).toBeTruthy();
    });

    it('模板图标操作具有包含模板名的可访问名称', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.endsWith('/api/comfyui/settings')) return jsonResponse({ baseUrl: '' });
            if (url.endsWith('/api/comfyui/workflows')) {
                return jsonResponse([template('template-id', '辅助技术模板')]);
            }
            throw new Error(`未模拟请求：${url}`);
        }));
        await renderManager();

        expect(await screen.findByRole('button', { name: '编辑 辅助技术模板' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '复制 辅助技术模板' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '导出 辅助技术模板' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '停用 辅助技术模板' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '删除 辅助技术模板' })).toBeTruthy();
        expect(screen.getByRole('textbox', { name: '搜索工作流模板' })).toBeTruthy();
    });

    it('通过界面完成编辑、复制、启停、导出和删除', async () => {
        let templates = [{ ...template('template-id', '原模板'), document: validDocument }];
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            if (url.endsWith('/api/comfyui/settings')) return jsonResponse({ baseUrl: '' });
            if (url.endsWith('/api/comfyui/workflows') && method === 'GET') return jsonResponse(templates);
            if (url.endsWith('/api/comfyui/workflows/template-id') && method === 'PUT') {
                const body = JSON.parse(String(init?.body));
                templates[0] = { ...templates[0], name: '已编辑模板', document: body.document };
                return jsonResponse({ template: templates[0], warnings: [] });
            }
            if (url.endsWith('/api/comfyui/workflows/template-id/duplicate')) {
                const copy = { ...templates[0], id: 'copy-id', name: '已编辑模板 副本' };
                templates = [...templates, copy];
                return jsonResponse({ template: copy, warnings: [] }, 201);
            }
            if (url.endsWith('/api/comfyui/workflows/template-id/enabled')) {
                templates[0] = { ...templates[0], enabled: false };
                return jsonResponse(templates[0]);
            }
            if (url.endsWith('/api/comfyui/workflows/template-id/export')) {
                return new Response(validDocument, { status: 200 });
            }
            if (url.endsWith('/api/comfyui/workflows/template-id') && method === 'DELETE') {
                templates = templates.filter((item) => item.id !== 'template-id');
                return jsonResponse({ ok: true });
            }
            throw new Error(`未模拟请求：${method} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('URL', Object.assign(URL, {
            createObjectURL: vi.fn(() => 'blob:workflow'),
            revokeObjectURL: vi.fn(),
        }));
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const user = userEvent.setup();
        await renderManager();

        await user.click(await screen.findByRole('button', { name: '编辑 原模板' }));
        const nameInput = screen.getByLabelText('模板名称');
        await user.clear(nameInput);
        await user.type(nameInput, '已编辑模板');
        await user.click(screen.getByRole('button', { name: '保存模板' }));
        expect(await screen.findByText('工作流模板已更新')).toBeTruthy();

        await user.click(await screen.findByRole('button', { name: '复制 已编辑模板' }));
        expect(await screen.findByText('已编辑模板 副本')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: '停用 已编辑模板' }));
        expect(await screen.findByText('已停用')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: '导出 已编辑模板' }));
        await waitFor(() => expect(clickSpy).toHaveBeenCalled());
        await user.click(screen.getByRole('button', { name: '删除 已编辑模板' }));
        await user.click(screen.getByRole('button', { name: '删除' }));
        expect(await screen.findByText('工作流模板已删除')).toBeTruthy();
        expect(screen.queryByRole('button', { name: '编辑 已编辑模板' })).toBeNull();
    });

    it('从组合文档文件导入并可保存为新模板', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            if (url.endsWith('/api/comfyui/settings')) return jsonResponse({ baseUrl: '' });
            if (url.endsWith('/api/comfyui/workflows') && method === 'GET') return jsonResponse([]);
            if (url.endsWith('/api/comfyui/workflows') && method === 'POST') {
                const body = JSON.parse(String(init?.body));
                return jsonResponse({
                    template: { ...template('imported-id', '原模板'), document: body.document },
                    warnings: [],
                }, 201);
            }
            throw new Error(`未模拟请求：${method} ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { container } = await renderManager();
        const file = new File([validDocument], 'workflow.comfy-workflow', { type: 'text/plain' });
        Object.defineProperty(file, 'text', { value: async () => validDocument });

        fireEvent.change(container.querySelector('input[type="file"]')!, {
            target: { files: [file] },
        });
        expect(await screen.findByDisplayValue('原模板')).toBeTruthy();
        await userEvent.setup().click(screen.getByRole('button', { name: '保存模板' }));
        expect(await screen.findByText('工作流模板已创建')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledWith('/api/comfyui/workflows', expect.objectContaining({
            method: 'POST',
        }));
    });
});
