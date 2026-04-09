import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { initDb } from '../src/server/database.js';
import app from '../src/server/app.js';

describe('Express 基础服务', () => {
  beforeEach(() => {
    initDb(':memory:');
  });

  it('GET /api/health 应返回 200 及 ok 状态', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.timestamp).toBe('number');
  });

  it('GET /api/health 返回的 timestamp 应为合理的时间戳', async () => {
    const before = Date.now();
    const res = await request(app).get('/api/health');
    const after = Date.now();
    expect(res.body.timestamp).toBeGreaterThanOrEqual(before);
    expect(res.body.timestamp).toBeLessThanOrEqual(after);
  });

  it('GET /api/health 应返回版本号', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toHaveProperty('version');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version).not.toBe('unknown');
  });

  it('GET /api/health 应返回数据库状态', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toHaveProperty('db', 'ok');
  });
});
