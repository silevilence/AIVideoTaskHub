import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDb } from '../src/server/database.js';
import {
    loadFileSystemPrompts,
    parsePromptFile,
    exportSystemPromptsToFiles,
    SYSTEM_PROMPTS,
    initSystemPrompts,
    getAllPrompts,
} from '../src/server/prompt-model.js';

describe('文件系统 Prompt 加载', () => {
    let tmpDir: string;

    beforeEach(() => {
        initDb(':memory:');
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sys_prompt_test_'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── YAML 前置解析 ──────────────────

    describe('parsePromptFile', () => {
        it('解析带 YAML front-matter 的 md 文件', () => {
            const content = `---
name: 测试提示词
tags:
  - 视频
  - 测试
---
这是提示词内容 \${input} \${lang}`;
            const result = parsePromptFile(content);
            expect(result.name).toBe('测试提示词');
            expect(result.tags).toEqual(['视频', '测试']);
            expect(result.content).toBe('这是提示词内容 ${input} ${lang}');
        });

        it('没有 YAML 头时整个文件作为内容', () => {
            const content = '纯文本内容 ${input}';
            const result = parsePromptFile(content);
            expect(result.name).toBeUndefined();
            expect(result.content).toBe('纯文本内容 ${input}');
        });

        it('YAML 头中可以指定 name 和 tags', () => {
            const content = `---
name: 自定义名称
tags: [标签A, 标签B]
---
内容`;
            const result = parsePromptFile(content);
            expect(result.name).toBe('自定义名称');
            expect(result.tags).toEqual(['标签A', '标签B']);
        });

        it('tags 为字符串时转为数组', () => {
            const content = `---
name: 测试
tags: 单标签
---
内容`;
            const result = parsePromptFile(content);
            expect(result.tags).toEqual(['单标签']);
        });

        it('空 YAML 头不报错', () => {
            const content = `---
---
正文内容`;
            const result = parsePromptFile(content);
            expect(result.content).toBe('正文内容');
        });
    });

    // ── 从文件系统加载 ──────────────────

    describe('loadFileSystemPrompts', () => {
        it('从目录加载 md 文件', () => {
            fs.writeFileSync(path.join(tmpDir, 'test.md'), `---
name: 文件提示词
tags: [测试]
---
内容 \${input}`);

            const prompts = loadFileSystemPrompts(tmpDir);
            expect(prompts.length).toBe(1);
            expect(prompts[0].name).toBe('文件提示词');
            expect(prompts[0].tags).toEqual(['测试']);
        });

        it('忽略非 md 文件', () => {
            fs.writeFileSync(path.join(tmpDir, 'test.txt'), '不是 md 文件');
            fs.writeFileSync(path.join(tmpDir, 'test.md'), `---
name: 有效
---
\${input}`);

            const prompts = loadFileSystemPrompts(tmpDir);
            expect(prompts.length).toBe(1);
        });

        it('没有 name 时使用文件名作为名称', () => {
            fs.writeFileSync(path.join(tmpDir, '我的提示词.md'), '内容 ${input}');
            const prompts = loadFileSystemPrompts(tmpDir);
            expect(prompts[0].name).toBe('我的提示词');
        });

        it('目录不存在时返回空数组', () => {
            const prompts = loadFileSystemPrompts(path.join(tmpDir, 'not_exist'));
            expect(prompts).toEqual([]);
        });
    });

    // ── 合并逻辑（文件覆盖代码） ──────────────────

    describe('initSystemPrompts 合并文件', () => {
        it('文件中同名提示词覆盖代码中的', () => {
            // 创建一个与代码中第一个系统提示词同名的文件
            fs.writeFileSync(path.join(tmpDir, 'override.md'), `---
name: ${SYSTEM_PROMPTS[0].name}
tags: [覆盖, 测试]
---
这是覆盖后的内容 \${input} \${lang}`);

            initSystemPrompts(tmpDir);
            const all = getAllPrompts();
            const overridden = all.find(p => p.name === SYSTEM_PROMPTS[0].name);
            expect(overridden).toBeDefined();
            expect(overridden!.content).toBe('这是覆盖后的内容 ${input} ${lang}');
            expect(overridden!.tags).toEqual(['覆盖', '测试']);
            expect(overridden!.is_system).toBe(true);
        });

        it('文件中新增的提示词也被创建为系统提示词', () => {
            fs.writeFileSync(path.join(tmpDir, 'extra.md'), `---
name: 额外提示词
tags: [新增]
---
额外内容 \${input}`);

            initSystemPrompts(tmpDir);
            const all = getAllPrompts();
            expect(all.length).toBe(SYSTEM_PROMPTS.length + 1);
            const extra = all.find(p => p.name === '额外提示词');
            expect(extra).toBeDefined();
            expect(extra!.is_system).toBe(true);
        });

        it('合并后代码中未被覆盖的保持不变', () => {
            initSystemPrompts(tmpDir);
            const all = getAllPrompts();
            const second = all.find(p => p.name === SYSTEM_PROMPTS[1].name);
            expect(second).toBeDefined();
            expect(second!.content).toBe(SYSTEM_PROMPTS[1].content);
        });

        it('重复初始化不重复插入（含文件）', () => {
            fs.writeFileSync(path.join(tmpDir, 'extra.md'), `---
name: 额外
---
\${input}`);

            initSystemPrompts(tmpDir);
            initSystemPrompts(tmpDir);
            const all = getAllPrompts();
            expect(all.filter(p => p.name === '额外').length).toBe(1);
        });

        it('重复初始化后，文件内容更新会同步到数据库', () => {
            fs.writeFileSync(path.join(tmpDir, 'test.md'), `---
name: 动态提示词
tags: [v1]
---
版本一 \${input}`);

            initSystemPrompts(tmpDir);
            let p = getAllPrompts().find(p => p.name === '动态提示词');
            expect(p!.content).toBe('版本一 ${input}');

            // 修改文件内容
            fs.writeFileSync(path.join(tmpDir, 'test.md'), `---
name: 动态提示词
tags: [v2]
---
版本二 \${input}`);

            initSystemPrompts(tmpDir);
            p = getAllPrompts().find(p => p.name === '动态提示词');
            expect(p!.content).toBe('版本二 ${input}');
            expect(p!.tags).toEqual(['v2']);
        });
    });

    // ── 导出到文件 ──────────────────

    describe('exportSystemPromptsToFiles', () => {
        it('将系统预置提示词导出为 md 文件', () => {
            exportSystemPromptsToFiles(tmpDir);
            const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.md'));
            expect(files.length).toBe(SYSTEM_PROMPTS.length);
        });

        it('导出的文件包含 YAML 头和内容', () => {
            exportSystemPromptsToFiles(tmpDir);
            const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.md'));
            const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');
            expect(content).toContain('---');
            expect(content).toContain('name:');
            expect(content).toContain('tags:');
        });

        it('不覆盖已有的同名文件', () => {
            const firstPrompt = SYSTEM_PROMPTS[0];
            const fileName = firstPrompt.name.replace(/[\\/:*?"<>|]/g, '_') + '.md';
            fs.writeFileSync(path.join(tmpDir, fileName), '已有内容');

            exportSystemPromptsToFiles(tmpDir);
            const content = fs.readFileSync(path.join(tmpDir, fileName), 'utf-8');
            expect(content).toBe('已有内容');
        });
    });
});
