import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, initDb } from '../src/server/database.js';
import { ProviderRegistry } from '../src/server/provider-registry.js';
import { createTaskRouter } from '../src/server/task-router.js';
import { comfyWorkflowTemplateDocument } from './fixtures/comfy-workflow.js';

function templateDocument(name: string, includeUnused = false): string {
    return comfyWorkflowTemplateDocument(name, { includeUnused });
}

function setupApp() {
    const app = express();
    app.use(express.json());
    app.use('/api', createTaskRouter(new ProviderRegistry()));
    return app;
}

describe('ComfyUI 工作流模板 API', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    it('创建模板后可按稳定 ID 查询并原样导出', async () => {
        const app = setupApp();
        const document = templateDocument('API 模板');

        const created = await request(app)
            .post('/api/comfyui/workflows')
            .send({ document, enabled: true });

        expect(created.status).toBe(201);
        expect(created.body.template.name).toBe('API 模板');
        expect(created.body.template.id).toMatch(/^[0-9a-f-]{36}$/);

        const detail = await request(app).get(`/api/comfyui/workflows/${created.body.template.id}`);
        expect(detail.status).toBe(200);
        expect(detail.body.document).toBe(document);

        const exported = await request(app).get(
            `/api/comfyui/workflows/${created.body.template.id}/export`
        );
        expect(exported.status).toBe(200);
        expect(exported.type).toBe('text/plain');
        expect(exported.text).toBe(document);
    });

    it('未使用变量必须显式确认后才能保存', async () => {
        const app = setupApp();
        const document = templateDocument('带警告模板', true);

        const warned = await request(app)
            .post('/api/comfyui/workflows')
            .send({ document });

        expect(warned.status).toBe(409);
        expect(warned.body.warnings).toContain('模板变量已定义但未使用：seed');

        const confirmed = await request(app)
            .post('/api/comfyui/workflows')
            .send({ document, confirmWarnings: true });
        expect(confirmed.status).toBe(201);
        expect(confirmed.body.warnings).toContain('模板变量已定义但未使用：seed');
    });

    it('通过 API 搜索、更新、复制、启停和删除模板', async () => {
        const app = setupApp();
        const created = await request(app)
            .post('/api/comfyui/workflows')
            .send({ document: templateDocument('生命周期模板') });
        const id = created.body.template.id as string;

        const listed = await request(app).get('/api/comfyui/workflows?q=生命');
        expect(listed.status).toBe(200);
        expect(listed.body.map((item: { id: string }) => item.id)).toEqual([id]);

        const updated = await request(app)
            .put(`/api/comfyui/workflows/${id}`)
            .send({ document: templateDocument('已更新模板') });
        expect(updated.status).toBe(200);
        expect(updated.body.template.name).toBe('已更新模板');

        const duplicated = await request(app)
            .post(`/api/comfyui/workflows/${id}/duplicate`)
            .send({ name: '已更新模板副本' });
        expect(duplicated.status).toBe(201);
        expect(duplicated.body.template.enabled).toBe(false);

        const disabled = await request(app)
            .put(`/api/comfyui/workflows/${id}/enabled`)
            .send({ enabled: false });
        expect(disabled.status).toBe(200);
        expect(disabled.body.enabled).toBe(false);

        expect((await request(app).delete(`/api/comfyui/workflows/${id}`)).status).toBe(200);
        expect((await request(app).get(`/api/comfyui/workflows/${id}`)).status).toBe(404);
    });

    it('通过组合文档导入模板', async () => {
        const app = setupApp();
        const document = templateDocument('导入模板');

        const imported = await request(app)
            .post('/api/comfyui/workflows/import')
            .send({ document });

        expect(imported.status).toBe(201);
        expect(imported.body.template.name).toBe('导入模板');
        expect(imported.body.template.document).toBe(document);
    });

    it('复制带警告的模板时仍需显式确认', async () => {
        const app = setupApp();
        const created = await request(app)
            .post('/api/comfyui/workflows')
            .send({
                document: templateDocument('警告源模板', true),
                confirmWarnings: true,
            });
        const id = created.body.template.id as string;

        const warned = await request(app)
            .post(`/api/comfyui/workflows/${id}/duplicate`)
            .send({ name: '警告副本' });
        expect(warned.status).toBe(409);
        expect(warned.body.warnings).toContain('模板变量已定义但未使用：seed');

        const confirmed = await request(app)
            .post(`/api/comfyui/workflows/${id}/duplicate`)
            .send({ name: '警告副本', confirmWarnings: true });
        expect(confirmed.status).toBe(201);
        expect(confirmed.body.warnings).toContain('模板变量已定义但未使用：seed');
    });
});
