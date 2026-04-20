import { describe, it, expect, beforeEach } from 'vitest';
import { initDb } from '../src/server/database.js';
import {
    getAllPrompts,
    getPromptById,
    searchPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    getAllFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    getDefaultPromptId,
    setDefaultPromptId,
    getEffectivePromptContent,
    initSystemPrompts,
    SYSTEM_PROMPTS,
    getPromptsByFolder,
} from '../src/server/prompt-model.js';

describe('prompt-model', () => {
    beforeEach(() => {
        initDb(':memory:');
    });

    // ── 系统 Prompt 初始化 ──────────────────

    describe('initSystemPrompts', () => {
        it('首次初始化应插入系统 Prompt', () => {
            initSystemPrompts();
            const all = getAllPrompts();
            expect(all.length).toBe(SYSTEM_PROMPTS.length);
            for (const p of all) {
                expect(p.is_system).toBe(true);
            }
        });

        it('重复初始化不会重复插入', () => {
            initSystemPrompts();
            initSystemPrompts();
            const all = getAllPrompts();
            expect(all.length).toBe(SYSTEM_PROMPTS.length);
        });

        it('系统 Prompt 包含正确的标签', () => {
            initSystemPrompts();
            const all = getAllPrompts();
            const first = all.find(p => p.name === SYSTEM_PROMPTS[0].name);
            expect(first).toBeDefined();
            expect(first!.tags).toEqual(SYSTEM_PROMPTS[0].tags);
        });
    });

    // ── 自定义 Prompt CRUD ──────────────────

    describe('Prompt CRUD', () => {
        it('创建自定义 Prompt', () => {
            const prompt = createPrompt({
                name: '测试 Prompt',
                content: '测试内容 ${input}',
                tags: ['测试'],
            });
            expect(prompt.id).toBeGreaterThan(0);
            expect(prompt.name).toBe('测试 Prompt');
            expect(prompt.content).toBe('测试内容 ${input}');
            expect(prompt.tags).toEqual(['测试']);
            expect(prompt.is_system).toBe(false);
            expect(prompt.folder_id).toBeNull();
        });

        it('根据 ID 获取 Prompt', () => {
            const created = createPrompt({ name: 'A', content: 'C ${input}' });
            const found = getPromptById(created.id);
            expect(found).toBeDefined();
            expect(found!.name).toBe('A');
        });

        it('获取所有 Prompt', () => {
            createPrompt({ name: 'A', content: 'C1 ${input}' });
            createPrompt({ name: 'B', content: 'C2 ${input}' });
            expect(getAllPrompts().length).toBe(2);
        });

        it('更新自定义 Prompt', () => {
            const prompt = createPrompt({ name: 'A', content: 'C ${input}', tags: ['x'] });
            const updated = updatePrompt(prompt.id, { name: 'B', content: 'D ${input}', tags: ['y'] });
            expect(updated).not.toBeNull();
            expect(updated!.name).toBe('B');
            expect(updated!.content).toBe('D ${input}');
            expect(updated!.tags).toEqual(['y']);
        });

        it('不能更新系统 Prompt', () => {
            initSystemPrompts();
            const systemPrompts = getAllPrompts().filter(p => p.is_system);
            const result = updatePrompt(systemPrompts[0].id, { name: '修改名称' });
            expect(result).toBeNull();
        });

        it('删除自定义 Prompt', () => {
            const prompt = createPrompt({ name: 'A', content: 'C ${input}' });
            expect(deletePrompt(prompt.id)).toBe(true);
            expect(getPromptById(prompt.id)).toBeUndefined();
        });

        it('不能删除系统 Prompt', () => {
            initSystemPrompts();
            const systemPrompts = getAllPrompts().filter(p => p.is_system);
            expect(deletePrompt(systemPrompts[0].id)).toBe(false);
        });

        it('删除不存在的 Prompt 返回 false', () => {
            expect(deletePrompt(9999)).toBe(false);
        });
    });

    // ── 搜索 ──────────────────

    describe('searchPrompts', () => {
        it('按名称搜索', () => {
            createPrompt({ name: '视频优化', content: '${input}' });
            createPrompt({ name: '简洁风格', content: '${input}' });
            const results = searchPrompts('视频');
            expect(results.length).toBe(1);
            expect(results[0].name).toBe('视频优化');
        });

        it('按标签搜索', () => {
            createPrompt({ name: 'A', content: '${input}', tags: ['电影'] });
            createPrompt({ name: 'B', content: '${input}', tags: ['动画'] });
            const results = searchPrompts('电影');
            expect(results.length).toBe(1);
            expect(results[0].name).toBe('A');
        });
    });

    // ── 目录管理 ──────────────────

    describe('Folders', () => {
        it('创建目录', () => {
            const folder = createFolder('我的模板');
            expect(folder.id).toBeGreaterThan(0);
            expect(folder.name).toBe('我的模板');
            expect(folder.parent_id).toBeNull();
        });

        it('创建子目录', () => {
            const parent = createFolder('父级');
            const child = createFolder('子级', parent.id);
            expect(child.parent_id).toBe(parent.id);
        });

        it('获取所有目录', () => {
            createFolder('A');
            createFolder('B');
            expect(getAllFolders().length).toBe(2);
        });

        it('重命名目录', () => {
            const folder = createFolder('旧名');
            expect(renameFolder(folder.id, '新名')).toBe(true);
            const folders = getAllFolders();
            expect(folders[0].name).toBe('新名');
        });

        it('删除目录时将内容移到根级', () => {
            const folder = createFolder('待删除');
            const prompt = createPrompt({ name: 'A', content: '${input}', folderId: folder.id });
            expect(deleteFolder(folder.id)).toBe(true);
            const found = getPromptById(prompt.id);
            expect(found!.folder_id).toBeNull();
        });

        it('按目录筛选 Prompt', () => {
            const folder = createFolder('目录A');
            createPrompt({ name: 'A', content: '${input}', folderId: folder.id });
            createPrompt({ name: 'B', content: '${input}' });
            expect(getPromptsByFolder(folder.id).length).toBe(1);
            expect(getPromptsByFolder(null).length).toBe(1);
        });
    });

    // ── 全局默认 Prompt ──────────────────

    describe('Default Prompt', () => {
        it('初始无默认 Prompt', () => {
            expect(getDefaultPromptId()).toBeNull();
        });

        it('设置和获取默认 Prompt', () => {
            const prompt = createPrompt({ name: 'A', content: '${input}' });
            setDefaultPromptId(prompt.id);
            expect(getDefaultPromptId()).toBe(prompt.id);
        });

        it('清空默认 Prompt', () => {
            const prompt = createPrompt({ name: 'A', content: '${input}' });
            setDefaultPromptId(prompt.id);
            setDefaultPromptId(null);
            expect(getDefaultPromptId()).toBeNull();
        });

        it('获取生效的 Prompt 内容', () => {
            const prompt = createPrompt({ name: 'A', content: '测试模板 ${input} ${lang}' });
            setDefaultPromptId(prompt.id);
            const effective = getEffectivePromptContent();
            expect(effective.id).toBe(prompt.id);
            expect(effective.content).toBe('测试模板 ${input} ${lang}');
        });

        it('无默认 Prompt 时返回空内容', () => {
            const effective = getEffectivePromptContent();
            expect(effective.id).toBeNull();
            expect(effective.content).toBe('');
        });
    });
});
