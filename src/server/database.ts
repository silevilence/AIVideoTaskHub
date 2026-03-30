import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;
const DEFAULT_DB_PATH = 'data/app.db';

/**
 * 初始化数据库连接并创建表结构。
 * @param dbPath 数据库文件路径，传 ':memory:' 为内存数据库（测试用）
 */
export function initDb(dbPath: string = process.env.DB_PATH || DEFAULT_DB_PATH): void {
    if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            provider        TEXT    NOT NULL,
            provider_task_id TEXT,
            status          TEXT    NOT NULL DEFAULT 'pending',
            prompt          TEXT    NOT NULL,
            model           TEXT,
            image_url       TEXT,
            result_url      TEXT,
            error_message   TEXT,
            extra_params    TEXT,
            retry_count     INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            deleted_at      TEXT,
            purged_at       TEXT
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    // 为已有的数据库添加 deleted_at 字段
    const columns = db.pragma('table_info(tasks)') as { name: string }[];
    if (!columns.some((c) => c.name === 'deleted_at')) {
        db.exec('ALTER TABLE tasks ADD COLUMN deleted_at TEXT');
    }
    if (!columns.some((c) => c.name === 'extra_params')) {
        db.exec('ALTER TABLE tasks ADD COLUMN extra_params TEXT');
    }
    if (!columns.some((c) => c.name === 'purged_at')) {
        db.exec('ALTER TABLE tasks ADD COLUMN purged_at TEXT');
    }
}

/** 获取当前数据库实例 */
export function getDb(): Database.Database {
    if (!db) {
        throw new Error('数据库未初始化，请先调用 initDb()');
    }
    return db;
}

/** 关闭数据库连接 */
export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}
