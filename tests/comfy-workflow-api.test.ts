import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
        vi.unstubAllGlobals();
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

    it('保存并读取规范化的默认 ComfyUI 地址', async () => {
        const app = setupApp();

        expect((await request(app).get('/api/comfyui/settings')).body).toEqual({ baseUrl: '' });
        const saved = await request(app)
            .put('/api/comfyui/settings')
            .send({ baseUrl: ' http://127.0.0.1:8188/// ' });

        expect(saved.status).toBe(200);
        expect(saved.body).toEqual({ baseUrl: 'http://127.0.0.1:8188' });
        expect((await request(app).get('/api/comfyui/settings')).body).toEqual(saved.body);

        const rejected = await request(app)
            .put('/api/comfyui/settings')
            .send({ baseUrl: 'file:///tmp/comfy' });
        expect(rejected.status).toBe(400);
        expect(rejected.body.error).toBe('ComfyUI 地址仅支持 HTTP 或 HTTPS');

        const invalidTest = await request(app)
            .post('/api/comfyui/connection/test')
            .send({ baseUrl: 'not-a-url' });
        expect(invalidTest.status).toBe(400);
        expect(invalidTest.body.error).toBe('ComfyUI 地址无效');
    });

    it('使用默认地址检查模板兼容性并准确返回缺失节点', async () => {
        const app = setupApp();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            TextNode: { input: { required: { text: ['STRING', {}] } } },
        }), { status: 200 })));
        await request(app)
            .put('/api/comfyui/settings')
            .send({ baseUrl: 'http://127.0.0.1:8188' });
        const created = await request(app)
            .post('/api/comfyui/workflows')
            .send({ document: templateDocument('兼容性模板') });

        const checked = await request(app)
            .post('/api/comfyui/workflows/check')
            .send({ id: created.body.template.id });

        expect(checked.status).toBe(200);
        expect(checked.body.ok).toBe(false);
        expect(checked.body.missingNodeTypes).toEqual(['VideoNode']);
        expect(checked.body.incompatibleInputs).toEqual([]);
    });

    it('在线检查失败不影响模板离线保存', async () => {
        const app = setupApp();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        await request(app)
            .put('/api/comfyui/settings')
            .send({ baseUrl: 'http://127.0.0.1:8188' });

        const checked = await request(app)
            .post('/api/comfyui/workflows/check')
            .send({ document: templateDocument('离线模板') });
        expect(checked.status).toBe(502);
        expect(checked.body.error).toBe('无法连接 ComfyUI：offline');

        const saved = await request(app)
            .post('/api/comfyui/workflows')
            .send({ document: templateDocument('离线模板') });
        expect(saved.status).toBe(201);
    });
});
