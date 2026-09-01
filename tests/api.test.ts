import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/server/app.js';
import { buildContext } from '../src/server/context.js';
import { parseEnv } from '../src/config/env.js';
import { ledger } from '../src/queue/handlers/effects.js';
import { testDb } from './helpers.js';

function makeApp(): Express {
  const db = testDb(true);
  const env = parseEnv({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: ':memory:',
    SYNC_TARGET_URL: 'mock://sheets',
  }).env!;
  return createApp(buildContext(db, env));
}

describe('HTTP API', () => {
  let app: Express;
  beforeEach(() => {
    app = makeApp();
    ledger.reset();
  });

  it('serves liveness and readiness', async () => {
    await request(app).get('/health/live').expect(200);
    const ready = await request(app).get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
  });

  it('returns combined dashboard state', async () => {
    const res = await request(app).get('/api/state').expect(200);
    expect(res.body.employees.length).toBeGreaterThan(0);
    expect(res.body.counts.employees).toBeGreaterThan(0);
  });

  it('a hostile sync returns 200 with a refused outcome (not a 500)', async () => {
    const before = (await request(app).get('/api/state')).body.counts.employees;
    const res = await request(app).post('/api/sync/pull').send({ scenario: 'empty' }).expect(200);
    expect(res.body.result.outcome).toBe('rejected_empty');
    const after = (await request(app).get('/api/state')).body.counts.employees;
    expect(after).toBe(before); // nothing deleted
  });

  it('rejects an unknown sync scenario with 400', async () => {
    await request(app).post('/api/sync/pull').send({ scenario: 'wipe-everything' }).expect(400);
  });

  it('enqueues an email twice but dedupes the second', async () => {
    const res = await request(app).post('/api/jobs/enqueue').send({ type: 'send_email' }).expect(200);
    expect(res.body.dedupedSecond).toBe(true);
    await request(app).post('/api/jobs/process').send({}).expect(200);
    const state = await request(app).get('/api/state');
    expect(state.body.effects.emails).toBe(1);
  });
});
