/**
 * Prompt 管理模块 —— 数据访问层。
 * 管理 prompts 和 prompt_folders 表。
 */
import { getDb } from './database.js';
import { getSetting, setSetting } from './task-model.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';

// ── 类型定义 ──────────────────────────

export interface Prompt {
    id: number;
    name: string;
    content: string;
    tags: string[];
    folder_id: number | null;
    is_system: boolean;
    created_at: string;
    updated_at: string;
}

export interface PromptFolder {
    id: number;
    name: string;
    parent_id: number | null;
    created_at: string;
}

export interface CreatePromptParams {
    name: string;
    content: string;
    tags?: string[];
    folderId?: number | null;
}

export interface UpdatePromptParams {
    name?: string;
    content?: string;
    tags?: string[];
    folderId?: number | null;
}

// ── 原始行类型（数据库直接返回）──────────────────

interface PromptRow {
    id: number;
    name: string;
    content: string;
    tags: string;
    folder_id: number | null;
    is_system: number;
    created_at: string;
    updated_at: string;
}

interface FolderRow {
    id: number;
    name: string;
    parent_id: number | null;
    created_at: string;
}

function rowToPrompt(row: PromptRow): Prompt {
    let tags: string[] = [];
    try {
        tags = JSON.parse(row.tags);
    } catch { /* ignore */ }
    return {
        id: row.id,
        name: row.name,
        content: row.content,
        tags,
        folder_id: row.folder_id,
        is_system: row.is_system === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

// ── 系统预置 Prompt ──────────────────────────

export const SYSTEM_PROMPTS: Omit<Prompt, 'id' | 'created_at' | 'updated_at'>[] = [
    {
        name: '视频生成提示词优化',
        content: `你是一位资深的 AI 视频生成提示词（Prompt）专家与电影视觉导演。你的任务是将用户简单的原始描述，扩写并优化为高质量、细节丰富、画面感极强的视频生成提示词。

### 【优化维度】
请基于用户的原始输入，在不改变核心意图的前提下，从以下维度进行合理想象与扩充：
1. **具体场景（Scene）**：细化画面的核心主体（外貌/穿着/神态）、具体动作细节、所处环境（前景/背景）、光线条件（如：清晨柔和的自然光、赛博朋克霓虹灯、电影级体积光）以及整体氛围（如：温馨、悬疑、宏大）。
2. **镜头语言（Camera）**：补充专业的摄影机运动和景别描述，如："面部特写"、"大远景航拍"、"缓慢推镜头"、"环绕跟拍"、"120帧慢动作"等。
3. **视觉风格（Style）**：赋予明确的影像或艺术风格，如："好莱坞电影感"、"8mm复古胶片"、"BBC野生动物纪录片风格"、"吉卜力动画风格"、"8k超清写实"。
4. **音频描述（Audio）**：如果场景适合，请自然地融入与画面匹配的声音描述，如："清脆的鸟鸣声"、"空灵的钢琴旋律"、"嘈杂的街道环境音"、"呼啸的风声"，以辅助视频模型生成音效。

### 【输出要求】
- **语言限制**：必须严格使用 **\${lang}** 输出最终的提示词。词语之间衔接自然，富有画面感。
- **直接输出**：仅输出优化后的提示词文本，**严禁**包含任何解释性话语（如"好的"、"为您优化如下"、"解析"等）。
- **格式要求**：保持段落连贯，不要使用 Markdown 列表格式输出结果，直接输出一段或多段结构紧凑的纯文本描述。
- **忠于原意**：必须包含用户的核心诉求，绝不能偏离原始主题。

---
用户的原始输入：
\${input}`,
        tags: ['视频', '优化', '系统'],
        folder_id: null,
        is_system: true,
    },
    {
        name: '简洁风格视频提示词',
        content: `你是一位专业的 AI 视频提示词撰写师。请将用户的原始描述改写为简洁、精准、适合视频模型理解的提示词。

### 【要求】
- 删除冗余描述，保留关键视觉信息
- 补充必要的风格和镜头描述
- 输出语言：**\${lang}**
- 直接输出优化后的提示词，不要加任何解释

用户的原始输入：
\${input}`,
        tags: ['视频', '简洁', '系统'],
        folder_id: null,
        is_system: true,
    },
    {
        name: '电影级叙事提示词',
        content: `你是一位好莱坞级别的视觉叙事专家。请将用户的简单描述转化为具有电影叙事感的视频生成提示词。

### 【优化方向】
1. 注入电影叙事结构：开场-发展-高潮
2. 丰富镜头语言：推拉摇移、特写、大远景
3. 强调光影与氛围：光线、色调、情绪渲染
4. 添加声音层次：环境音、配乐暗示

### 【输出要求】
- 语言：**\${lang}**
- 直接输出，无需解释
- 保持连贯段落，不使用列表

用户的原始输入：
\${input}`,
        tags: ['视频', '电影', '叙事', '系统'],
        folder_id: null,
        is_system: true,
    },
    {
        name: 'Seedance2.0-文-基础',
        content: `# Role
你是一个专业的 Seedance 2.0 视频生成模型提示词扩写专家。

# Task
请根据用户的简短输入，将其扩写为一段结构清晰、细节丰富的视频生成提示词。请使用 \`\${lang}\` 输出最终结果。

# Seedance 2.0 提示词基础公式
提示词需要包含以下三个层级，请根据用户的输入智能判断是否需要补充非必需部分，以保证画面的生动性和完整性：
1. **逻辑基石（必需）**：明确谁（主体）正在进行什么动作。若用户未提供细节，请合理推测补充。
2. **视觉格调（智能补充）**：描述空间背景、光影细节或特定视觉风格（如：赛博朋克、电影感、手绘漫画风格等）。若用户输入较短，请自动为其匹配契合的场景与光影。
3. **进阶指令（智能补充）**：使用镜头调度（如：特写、缓慢旋转、推远、横摇）或氛围描述。

# Rules
1. 忠于用户原本的意图，如果用户的输入已经非常详尽，请对其进行润色和结构化，切勿生搬硬套或改变原意。
2. 扩写后的语言必须自然流畅。
3. 直接输出扩写后的提示词，**不要包含**任何解释性废话或开场白。

# User Input
\${input}`,
        tags: ['Seedance 2.0', '系统'],
        folder_id: null,
        is_system: true,
    },
    {
        name: 'Seedance2.0-图-基础',
        content: `# Role
你是一个专业的 Seedance 2.0 图生视频（I2V）提示词扩写专家。

# Background & Constraints
【重要提示】你**无法看到**用户实际上传的参考图片。你的任务是仅根据用户的文字输入，推测用户对图片的使用意图（例如：谁是主体图、谁是背景图），并扩写成高质量的视频提示词。
**核心禁忌：切勿凭空捏造（幻觉）图片中未提及的具体视觉细节（如特定的衣服颜色、长相、背景物件等），除非用户在输入中明确提及。**

# Task
请将用户的简短输入，扩写为一段结构清晰、富有动态感、符合 Seedance 2.0 图像参考规范的视频生成提示词。请使用 \`\${lang}\` 输出最终结果。

# 图生视频专属语法及扩写规范
1. **精准指代**：保留并规范化用户对图片的引用（如"图1"、"图2"、"参考图片"等，若 \`\${lang}\` 非中文，请准确翻译为 Image 1, Image 2 等占位符）。
   常用句式参考：
   - "以「图1」中的角色为主体，在「图2」的场景中……"
   - "保持参考图片中的人物特征……"
2. **补全动态与运镜（核心）**：既然是图生视频，需要让静态图片"动起来"。请基于用户的基础描述，合理补充：
   - **主体动作**（如：微微一笑、缓慢转身、向前走动、衣服随风飘动）
   - **环境动态**（如：背景中有微风吹过树叶、光影在脸上流转、水面波光粼粼）
   - **镜头调度**（如：镜头缓慢推近特写、环绕主体展示、平移长镜头）
3. **氛围与画质提升**：智能补充契合用户意境的氛围词和画质词（如：电影级质感、自然柔和的光线、8k分辨率、细腻质感），使画面更具质感。

# Rules
1. 绝对忠于用户的原始设定，仅在动作、运镜、光影和画质上进行合理扩写，**不篡改图片原本应有的实体特征**。
2. 扩写后的语言必须自然流畅。
3. 直接输出扩写后的提示词，**不要包含**任何解释性废话或开场白。

# User Input
\${input}`,
        tags: ['Seedance 2.0', '系统'],
        folder_id: null,
        is_system: true,
    },
    {
        name: 'Seedance2.0-文-文字生成',
        content: `# Role
你是一个专业的 Seedance 2.0 视频生成模型提示词扩写专家，尤其擅长处理带有"文字生成"需求的视频场景。

# Task
请根据用户的输入，分析其文字展示意图（广告语 Slogan、配音字幕、或是角色对话气泡），并扩写为符合 Seedance 2.0 文字生成规范的提示词。请使用 \`\${lang}\` 输出最终结果。

# 文字生成专属语法规范
请必须结合以下对应场景的规范句式，将其融入到画面的基础描述（主体+环境+运镜）中：
1. **广告语（Slogan）场景**：
   语法公式：「文字内容」+「出现时机」+「出现位置」+「出现方式」，「文字特征（颜色、风格）」。
   示例：画面中部逐渐显示文字"快乐尽在 Seedance"，文字为霓虹灯风格。
2. **台词/字幕（Subtitle）场景**：
   语法公式：画面底部出现字幕，字幕内容为"X"，字幕需与音频节奏完全同步。
3. **气泡台词（Bubble）场景**：
   语法公式：「角色」说："X"，角色说话时周围出现气泡，气泡里写着台词。

# Rules
1. 请先根据用户的输入，构建主体动作和环境的视觉描述。
2. 智能推测用户希望生成的文字内容和形式。如果是旁白或对话，优先使用【字幕】或【气泡】格式；如果是品牌宣传或标题，优先使用【广告语】格式。
3. 严格套用上述语法规范中的句式插入提示词。
4. 直接输出扩写后的提示词，**不要包含**任何解释性废话或开场白。

# User Input
\${input}`,
        tags: ['Seedance 2.0', '系统'],
        folder_id: null,
        is_system: true,
    },
];

// ── 文件系统 Prompt 加载 ──────────────────────────

interface ParsedPromptFile {
    name?: string;
    tags?: string[];
    content: string;
}

/** 解析带 YAML front-matter 的 md 文件内容 */
export function parsePromptFile(raw: string): ParsedPromptFile {
    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = raw.match(fmRegex);
    if (!match) {
        // 也尝试匹配空 YAML 头 (---\n---\n)
        const emptyFm = raw.match(/^---\r?\n---\r?\n?([\s\S]*)$/);
        if (emptyFm) {
            return { content: emptyFm[1].trimStart() };
        }
        return { content: raw };
    }

    const yamlStr = match[1];
    const body = match[2].trimStart();
    const result: ParsedPromptFile = { content: body || '' };

    // 简易 YAML 解析（只需 name 和 tags）
    for (const line of yamlStr.split(/\r?\n/)) {
        const nameMatch = line.match(/^name:\s*(.+)$/);
        if (nameMatch) {
            result.name = nameMatch[1].trim();
            continue;
        }
        // tags: [标签A, 标签B] 行内数组格式
        const tagsInline = line.match(/^tags:\s*\[(.+)\]$/);
        if (tagsInline) {
            result.tags = tagsInline[1].split(',').map(t => t.trim()).filter(Boolean);
            continue;
        }
        // tags: 单值字符串
        const tagsSingle = line.match(/^tags:\s+(\S.*)$/);
        if (tagsSingle) {
            result.tags = [tagsSingle[1].trim()];
            continue;
        }
    }

    // tags: YAML 列表格式 (  - 标签)
    const listItems: string[] = [];
    let inTagsList = false;
    for (const line of yamlStr.split(/\r?\n/)) {
        if (/^tags:\s*$/.test(line)) {
            inTagsList = true;
            continue;
        }
        if (inTagsList) {
            const itemMatch = line.match(/^\s+-\s+(.+)$/);
            if (itemMatch) {
                listItems.push(itemMatch[1].trim());
            } else {
                inTagsList = false;
            }
        }
    }
    if (listItems.length > 0) {
        result.tags = listItems;
    }

    return result;
}

/** 从指定目录加载所有 .md 文件并解析为系统 Prompt */
export function loadFileSystemPrompts(dir: string): Omit<Prompt, 'id' | 'created_at' | 'updated_at'>[] {
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    const results: Omit<Prompt, 'id' | 'created_at' | 'updated_at'>[] = [];

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
            const parsed = parsePromptFile(raw);
            const name = parsed.name || path.basename(file, '.md');
            results.push({
                name,
                content: parsed.content,
                tags: parsed.tags || [],
                folder_id: null,
                is_system: true,
            });
        } catch (err) {
            logger.warn(`加载系统 Prompt 文件失败: ${file}`, err);
        }
    }

    return results;
}

/** 将代码中的系统预置 Prompt 导出为 md 文件（不覆盖已存在的文件） */
export function exportSystemPromptsToFiles(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    for (const prompt of SYSTEM_PROMPTS) {
        const safeName = prompt.name.replace(/[\\/:*?"<>|]/g, '_');
        const filePath = path.join(dir, `${safeName}.md`);
        if (fs.existsSync(filePath)) continue;

        const tagsLine = prompt.tags.length > 0
            ? `tags:\n${prompt.tags.map(t => `  - ${t}`).join('\n')}`
            : 'tags: []';
        const fileContent = `---\nname: ${prompt.name}\n${tagsLine}\n---\n${prompt.content}`;
        fs.writeFileSync(filePath, fileContent, 'utf-8');
    }
}

// ── 初始化系统 Prompt ──────────────────────────

const SYSTEM_PROMPTS_INIT_KEY = 'prompt:system_initialized';

/** 初始化系统预置 Prompt（仅首次运行时执行） */
export function initSystemPrompts(sysPromptDir?: string): void {
    const dir = sysPromptDir ?? path.resolve(process.env.DATA_DIR || 'data', 'sys_prompt');

    // 导出代码内置 Prompt 为参考文件（不覆盖已有的）
    exportSystemPromptsToFiles(dir);

    // 从文件系统加载 Prompt
    const filePrompts = loadFileSystemPrompts(dir);

    // 合并：文件中同名的覆盖代码中的
    const fileNames = new Set(filePrompts.map(p => p.name));
    const codeOnly = SYSTEM_PROMPTS.filter(p => !fileNames.has(p.name));
    const mergedPrompts = [...codeOnly, ...filePrompts];

    const initialized = getSetting(SYSTEM_PROMPTS_INIT_KEY);
    const db = getDb();

    if (!initialized) {
        // 首次初始化：直接插入所有
        const insertStmt = db.prepare(`
            INSERT INTO prompts (name, content, tags, folder_id, is_system)
            VALUES (@name, @content, @tags, @folderId, 1)
        `);
        for (const prompt of mergedPrompts) {
            insertStmt.run({
                name: prompt.name,
                content: prompt.content,
                tags: JSON.stringify(prompt.tags),
                folderId: prompt.folder_id,
            });
        }
        setSetting(SYSTEM_PROMPTS_INIT_KEY, 'true');
    } else {
        // 后续启动：同步文件系统中的 Prompt（更新/新增）
        const existingRows = db.prepare(
            'SELECT id, name FROM prompts WHERE is_system = 1'
        ).all() as { id: number; name: string }[];
        const existingMap = new Map(existingRows.map(r => [r.name, r.id]));

        const updateStmt = db.prepare(`
            UPDATE prompts SET content = @content, tags = @tags, updated_at = datetime('now')
            WHERE id = @id
        `);
        const insertStmt = db.prepare(`
            INSERT INTO prompts (name, content, tags, folder_id, is_system)
            VALUES (@name, @content, @tags, @folderId, 1)
        `);

        for (const prompt of mergedPrompts) {
            const existingId = existingMap.get(prompt.name);
            if (existingId !== undefined) {
                // 已存在的系统 Prompt：用文件内容更新
                updateStmt.run({
                    id: existingId,
                    content: prompt.content,
                    tags: JSON.stringify(prompt.tags),
                });
            } else {
                // 新增的系统 Prompt
                insertStmt.run({
                    name: prompt.name,
                    content: prompt.content,
                    tags: JSON.stringify(prompt.tags),
                    folderId: prompt.folder_id,
                });
            }
        }
    }
}

// ── Prompt CRUD ──────────────────────────

/** 获取所有 Prompt */
export function getAllPrompts(): Prompt[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM prompts ORDER BY is_system DESC, updated_at DESC').all() as PromptRow[];
    return rows.map(rowToPrompt);
}

/** 根据 ID 获取 Prompt */
export function getPromptById(id: number): Prompt | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id) as PromptRow | undefined;
    return row ? rowToPrompt(row) : undefined;
}

/** 按目录获取 Prompt */
export function getPromptsByFolder(folderId: number | null): Prompt[] {
    const db = getDb();
    const sql = folderId === null
        ? 'SELECT * FROM prompts WHERE folder_id IS NULL ORDER BY is_system DESC, updated_at DESC'
        : 'SELECT * FROM prompts WHERE folder_id = ? ORDER BY is_system DESC, updated_at DESC';
    const rows = (folderId === null ? db.prepare(sql).all() : db.prepare(sql).all(folderId)) as PromptRow[];
    return rows.map(rowToPrompt);
}

/** 搜索 Prompt（按名称和标签） */
export function searchPrompts(query: string): Prompt[] {
    const db = getDb();
    const rows = db.prepare(
        `SELECT * FROM prompts WHERE name LIKE @q OR tags LIKE @q ORDER BY is_system DESC, updated_at DESC`
    ).all({ q: `%${query}%` }) as PromptRow[];
    return rows.map(rowToPrompt);
}

/** 创建自定义 Prompt */
export function createPrompt(params: CreatePromptParams): Prompt {
    const db = getDb();
    const result = db.prepare(`
        INSERT INTO prompts (name, content, tags, folder_id, is_system)
        VALUES (@name, @content, @tags, @folderId, 0)
    `).run({
        name: params.name,
        content: params.content,
        tags: JSON.stringify(params.tags || []),
        folderId: params.folderId ?? null,
    });
    return getPromptById(Number(result.lastInsertRowid))!;
}

/** 更新自定义 Prompt（系统 Prompt 禁止修改） */
export function updatePrompt(id: number, params: UpdatePromptParams): Prompt | null {
    const existing = getPromptById(id);
    if (!existing || existing.is_system) return null;

    const db = getDb();
    const sets: string[] = ["updated_at = datetime('now')"];
    const values: Record<string, unknown> = { id };

    if (params.name !== undefined) {
        sets.push('name = @name');
        values.name = params.name;
    }
    if (params.content !== undefined) {
        sets.push('content = @content');
        values.content = params.content;
    }
    if (params.tags !== undefined) {
        sets.push('tags = @tags');
        values.tags = JSON.stringify(params.tags);
    }
    if (params.folderId !== undefined) {
        sets.push('folder_id = @folderId');
        values.folderId = params.folderId;
    }

    db.prepare(`UPDATE prompts SET ${sets.join(', ')} WHERE id = @id`).run(values);
    return getPromptById(id)!;
}

/** 删除自定义 Prompt（系统 Prompt 禁止删除） */
export function deletePrompt(id: number): boolean {
    const existing = getPromptById(id);
    if (!existing || existing.is_system) return false;

    const db = getDb();
    const result = db.prepare('DELETE FROM prompts WHERE id = ? AND is_system = 0').run(id);
    return result.changes > 0;
}

// ── 目录 CRUD ──────────────────────────

/** 获取所有目录 */
export function getAllFolders(): PromptFolder[] {
    const db = getDb();
    return db.prepare('SELECT * FROM prompt_folders ORDER BY name').all() as FolderRow[];
}

/** 获取子目录 */
export function getChildFolders(parentId: number | null): PromptFolder[] {
    const db = getDb();
    const sql = parentId === null
        ? 'SELECT * FROM prompt_folders WHERE parent_id IS NULL ORDER BY name'
        : 'SELECT * FROM prompt_folders WHERE parent_id = ? ORDER BY name';
    return (parentId === null ? db.prepare(sql).all() : db.prepare(sql).all(parentId)) as FolderRow[];
}

/** 创建目录 */
export function createFolder(name: string, parentId?: number | null): PromptFolder {
    const db = getDb();
    const result = db.prepare(`
        INSERT INTO prompt_folders (name, parent_id) VALUES (@name, @parentId)
    `).run({ name, parentId: parentId ?? null });
    return db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(Number(result.lastInsertRowid)) as FolderRow;
}

/** 重命名目录 */
export function renameFolder(id: number, name: string): boolean {
    const db = getDb();
    const result = db.prepare('UPDATE prompt_folders SET name = ? WHERE id = ?').run(name, id);
    return result.changes > 0;
}

/** 删除目录（内容移到根级） */
export function deleteFolder(id: number): boolean {
    const db = getDb();
    // 先把该目录下的 Prompt 移到根级
    db.prepare('UPDATE prompts SET folder_id = NULL WHERE folder_id = ?').run(id);
    // 把子目录移到根级
    db.prepare('UPDATE prompt_folders SET parent_id = NULL WHERE parent_id = ?').run(id);
    const result = db.prepare('DELETE FROM prompt_folders WHERE id = ?').run(id);
    return result.changes > 0;
}

// ── 全局默认 Prompt ──────────────────────────

const KEY_DEFAULT_PROMPT_ID = 'prompt:default_id';

/** 获取全局默认 Prompt ID */
export function getDefaultPromptId(): number | null {
    const val = getSetting(KEY_DEFAULT_PROMPT_ID);
    if (!val) return null;
    const id = parseInt(val, 10);
    return isNaN(id) ? null : id;
}

/** 设置全局默认 Prompt ID */
export function setDefaultPromptId(id: number | null): void {
    setSetting(KEY_DEFAULT_PROMPT_ID, id !== null ? String(id) : '');
}

/** 获取当前生效的 Prompt 内容（优先使用默认 Prompt，回退到 text-settings 的模板） */
export function getEffectivePromptContent(): { id: number | null; content: string } {
    const defaultId = getDefaultPromptId();
    if (defaultId !== null) {
        const prompt = getPromptById(defaultId);
        if (prompt) {
            return { id: prompt.id, content: prompt.content };
        }
    }
    // 回退：不返回内容，让调用方使用 text-settings 的模板
    return { id: null, content: '' };
}
