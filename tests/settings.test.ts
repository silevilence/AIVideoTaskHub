import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, closeDb } from '../src/server/database.js';
import {
    getSetting,
    setSetting,
} from '../src/server/task-model.js';

describe('Settings 持久化', () => {
    beforeEach(() => {
        closeDb();
        initDb(':memory:');
    });

    it('getSetting 不存在的 key 应返回 undefined', () => {
        expect(getSetting('nonexistent')).toBeUndefined();
    });

    it('setSetting + getSetting 应能保存和读取', () => {
        setSetting('siliconflow_api_key', 'sk-abc123');
        expect(getSetting('siliconflow_api_key')).toBe('sk-abc123');
    });

    it('setSetting 重复写入同一个 key 应覆盖', () => {
        setSetting('siliconflow_api_key', 'old-key');
        setSetting('siliconflow_api_key', 'new-key');
        expect(getSetting('siliconflow_api_key')).toBe('new-key');
    });

    it('不同 key 之间相互隔离', () => {
        setSetting('key_a', 'aaa');
        setSetting('key_b', 'bbb');
        expect(getSetting('key_a')).toBe('aaa');
        expect(getSetting('key_b')).toBe('bbb');
    });
});
