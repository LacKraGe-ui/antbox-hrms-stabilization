import { describe, it, expect, beforeEach } from 'vitest';
import type { DB } from '../src/db/client.js';
import { Repository } from '../src/domain/repository.js';
import { SyncService } from '../src/sync/syncService.js';
import { MockExternalTarget } from '../src/sync/externalTarget.js';
import { testDb } from './helpers.js';

/**
 * The safety-critical suite. If any test here fails, the exact production
 * incident (external source wiping live records) can happen again.
 */
describe('SyncService — non-destructive guarantees', () => {
  let db: DB;
  let repo: Repository;
  let sync: SyncService;

  beforeEach(() => {
    db = testDb(true);
    repo = new Repository(db);
    sync = new SyncService(db, new MockExternalTarget());
  });

  it('REFUSES to delete anything when the source returns empty (the incident)', async () => {
    const before = repo.countEmployees();
    expect(before).toBeGreaterThan(0);

    const result = await sync.syncFromExternal('empty');

    expect(result.outcome).toBe('rejected_empty');
    expect(result.deletionsApplied).toBe(0);
    // No record removed — count is exactly preserved.
    expect(repo.countEmployees()).toBe(before);
    expect(repo.countLeaveRequests()).toBeGreaterThan(0);
  });

  it('REFUSES a malformed payload without deriving any write', async () => {
    const beforeEmp = repo.countEmployees();
    const beforeLeave = repo.countLeaveRequests();

    const result = await sync.syncFromExternal('malformed');

    expect(result.outcome).toBe('rejected_validation');
    expect(result.appliedCount).toBe(0);
    expect(repo.countEmployees()).toBe(beforeEmp);
    expect(repo.countLeaveRequests()).toBe(beforeLeave);
  });

  it('REFUSES a null/absent body', async () => {
    const before = repo.countEmployees();
    const result = await sync.syncFromExternal('null');
    expect(result.outcome).toBe('rejected_null');
    expect(repo.countEmployees()).toBe(before);
  });

  it('applies upserts but REFUSES a bulk-delete anomaly (90% of rows vanish)', async () => {
    const before = repo.countEmployees();
    const result = await sync.syncFromExternal('mass_delete');

    expect(result.outcome).toBe('applied_upserts_only');
    expect(result.guardsTriggered).toContain('bulk-delete-anomaly');
    expect(result.deletionsApplied).toBe(0);
    // The 5 "missing" employees are NOT deleted.
    expect(repo.countEmployees()).toBe(before);
  });

  it('applies a healthy round-trip (upserts + one legitimate new hire)', async () => {
    const before = repo.countEmployees();
    const result = await sync.syncFromExternal('healthy');

    expect(result.outcome).toBe('applied');
    expect(result.appliedCount).toBeGreaterThan(0);
    // A new employee came back from the source and was added.
    expect(repo.countEmployees()).toBe(before + 1);
    expect(repo.listEmployees().some((e) => e.id === 'emp_100')).toBe(true);
  });

  it('applies a small, in-threshold deletion on a partial update', async () => {
    const before = repo.countEmployees();
    const result = await sync.syncFromExternal('partial_update');

    expect(result.outcome).toBe('applied');
    expect(result.deletionsRequested).toBe(1);
    expect(result.deletionsApplied).toBe(1);
    expect(repo.countEmployees()).toBe(before - 1);
  });

  it('makes deletions reversible (soft delete, not physical delete)', async () => {
    await sync.syncFromExternal('partial_update');
    // The active list shrank...
    const active = repo.listEmployees();
    // ...but the record still physically exists (recoverable).
    const all = repo.listEmployees(true);
    expect(all.length).toBeGreaterThan(active.length);
    expect(all.some((e) => !active.find((a) => a.id === e.id))).toBe(true);
  });

  it('records an audit row for every sync decision', async () => {
    await sync.syncFromExternal('empty');
    await sync.syncFromExternal('healthy');
    const audit = sync.recentAudit();
    expect(audit.length).toBe(2);
    expect(audit[0]?.outcome).toBe('applied'); // most recent first
    expect(audit[1]?.outcome).toBe('rejected_empty');
    expect(audit[1]?.reason).toMatch(/source fault|0 records/i);
  });
});
