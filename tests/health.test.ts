import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { liveness, readiness } from '../src/health/checks.js';
import { runPreflight } from '../src/preflight/preflight.js';
import { openDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { testDb } from './helpers.js';

const tempFiles: string[] = [];
function tempDbPath(): string {
  const p = join(tmpdir(), `antbox-test-${randomUUID()}.db`);
  tempFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of tempFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(f + suffix); } catch { /* ignore */ }
    }
  }
});

describe('Health checks', () => {
  it('liveness is always ok when the process runs', () => {
    expect(liveness().status).toBe('ok');
  });

  it('readiness is ok on a migrated database', () => {
    const db = testDb(false);
    const report = readiness(db);
    expect(report.status).toBe('ok');
    expect(report.checks.find((c) => c.name === 'database')?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'migrations')?.ok).toBe(true);
  });

  it('readiness is degraded when migrations are pending', () => {
    const db = openDb(':memory:'); // fresh, NOT migrated
    const report = readiness(db);
    expect(report.status).toBe('degraded');
    expect(report.checks.find((c) => c.name === 'migrations')?.ok).toBe(false);
  });
});

describe('Preflight — fail-closed deploy gate', () => {
  const baseEnv = () => ({
    NODE_ENV: 'production',
    PORT: '3000',
    SYNC_TARGET_URL: 'mock://sheets',
  });

  it('FAILS when required env vars are missing', () => {
    const result = runPreflight({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'environment')?.ok).toBe(false);
  });

  it('FAILS when migrations are pending on the target DB', () => {
    const dbPath = tempDbPath();
    // create the file but do NOT migrate it
    openDb(dbPath).close();
    const result = runPreflight({ ...baseEnv(), DATABASE_URL: dbPath } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'migrations')?.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'migrations')?.detail).toMatch(/pending/i);
  });

  it('PASSES on a valid env and fully-migrated DB', () => {
    const dbPath = tempDbPath();
    const db = openDb(dbPath);
    runMigrations(db);
    db.close();
    const result = runPreflight({ ...baseEnv(), DATABASE_URL: dbPath } as NodeJS.ProcessEnv);
    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });
});
