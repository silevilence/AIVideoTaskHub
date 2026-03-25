import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/server/app.js';

describe('Express 基础服务', () => {
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
});
