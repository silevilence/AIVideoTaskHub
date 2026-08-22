// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const taskListModulePath = '../src/web/src/components/TaskList';
const recycleBinModulePath = '../src/web/src/components/RecycleBin';

async function renderTaskList() {
    const { TaskList } = await import(/* @vite-ignore */ taskListModulePath);
    return render(React.createElement(TaskList, {
        refreshKey: 0,
        onApplyParams: () => undefined,
    }));
}

async function renderRecycleBin() {
    const { RecycleBin } = await import(/* @vite-ignore */ recycleBinModulePath);
    return render(React.createElement(RecycleBin, {
        onApplyParams: () => undefined,
    }));
}

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function task(id: number, deleted = false) {
    return {
        id,
        provider: 'mock',
        provider_task_id: `remote-${id}`,
        status: 'failed',
        prompt: `任务${id}`,
        model: 'model',
        image_url: null,
        result_url: null,
        error_message: 'failed',
        extra_params: null,
        retry_count: 0,
        created_at: '2026-08-22 00:00:00',
        updated_at: '2026-08-22 00:00:00',
        deleted_at: deleted ? '2026-07-01 00:00:00' : null,
        purged_at: null,
        ...(deleted ? { file_size: 0 } : {}),
    };
}

describe('任务详情懒加载竞态', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it.each([
        {
            name: '任务列表',
            listUrl: '/api/tasks',
            detailPrefix: '/api/tasks/',
            renderComponent: renderTaskList,
            deleted: false,
        },
        {
            name: '回收站',
            listUrl: '/api/trash',
            detailPrefix: '/api/trash/',
            renderComponent: renderRecycleBin,
            deleted: true,
        },
    ])('$name 只展示最后一次点击返回的详情', async ({ listUrl, detailPrefix, renderComponent, deleted }) => {
        const first = deferred<Response>();
        const second = deferred<Response>();
        const items = [task(1, deleted), task(2, deleted)];
        vi.mocked(fetch).mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith(listUrl)) return jsonResponse(items);
            if (url.endsWith('/api/providers')) return jsonResponse([{ name: 'mock', displayName: 'Mock' }]);
            if (url.endsWith('/api/providers/models')) return jsonResponse({ mock: [] });
            if (url.endsWith(`${detailPrefix}1`)) return first.promise;
            if (url.endsWith(`${detailPrefix}2`)) return second.promise;
            throw new Error(`未模拟请求：${url}`);
        });
        const user = userEvent.setup();
        await renderComponent();

        const buttons = await screen.findAllByTitle('查看任务参数');
        await user.click(buttons[0]);
        await user.click(buttons[1]);
        await act(async () => second.resolve(jsonResponse({ ...items[1], extra_params: '{}' })));
        expect(await screen.findByText(/^#2 · Mock/)).toBeTruthy();

        await act(async () => first.resolve(jsonResponse({ ...items[0], extra_params: '{}' })));
        await waitFor(() => {
            expect(screen.getByText(/^#2 · Mock/)).toBeTruthy();
            expect(screen.queryByText(/^#1 · Mock/)).toBeNull();
        });
    });
});
