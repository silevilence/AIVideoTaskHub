// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

const componentModulePath = '../src/web/src/components/ComfyTaskSnapshotDetails';

describe('ComfyUI 历史快照详情', () => {
    afterEach(cleanup);

    it('展示模板、实际地址、主输出、变量值和图片预览', async () => {
        const { ComfyTaskSnapshotDetails } = await import(/* @vite-ignore */ componentModulePath);
        render(React.createElement(ComfyTaskSnapshotDetails, {
            snapshot: {
                templateId: 'workflow-1',
                templateName: '电影模板',
                baseUrl: 'http://comfy.internal:8188',
                primaryOutput: { nodeId: '9', field: 'videos', index: 1 },
                parameterSchema: {
                    kind: 'comfyui-workflow',
                    variables: [],
                    primaryOutput: { nodeId: '9', field: 'videos', index: 1 },
                },
                variables: [
                    { key: 'prompt', label: '画面描述', type: 'string', value: '云海' },
                    { key: 'steps', label: '步数', type: 'integer', value: 30 },
                ],
                images: [{
                    variableKey: 'image',
                    source: '/uploads/123e4567-e89b-12d3-a456-426614174000.png',
                }],
            },
        }));

        expect(screen.getByRole('region', { name: 'ComfyUI 任务快照' }).textContent).toContain(
            '电影模板'
        );
        expect(screen.getByText('http://comfy.internal:8188')).toBeTruthy();
        expect(screen.getByText('9 · videos[1]')).toBeTruthy();
        expect(screen.getByText('云海')).toBeTruthy();
        expect(screen.getByRole('img', { name: 'image 图片预览' }).getAttribute('src')).toBe(
            '/uploads/123e4567-e89b-12d3-a456-426614174000.png'
        );
    });
});
