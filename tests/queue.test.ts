import { describe, it, expect, beforeEach } from 'vitest';
import type { DB } from '../src/db/client.js';
import { Queue } from '../src/queue/queue.js';
import { registerHandlers, JOB_TYPES, sendEmail } from '../src/queue/handlers/index.js';
import { ledger } from '../src/queue/handlers/effects.js';
import { testDb, fakeClock } from './helpers.js';

describe('Queue — idempotency, backoff, dead-lettering', () => {
  let db: DB;

  beforeEach(() => {
    db = testDb(false);
    ledger.reset();
  });

  it('dedupes enqueue by idempotency key (no duplicate jobs)', () => {
    const q = new Queue(db);
    registerHandlers(q);
    const a = q.enqueue(JOB_TYPES.sendEmail, { dedupeKey: 'k', to: 'a@b.c', subject: 'hi' }, { idempotencyKey: 'e1' });
    const b = q.enqueue(JOB_TYPES.sendEmail, { dedupeKey: 'k', to: 'a@b.c', subject: 'hi' }, { idempotencyKey: 'e1' });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect(q.counts().pending).toBe(1);
  });

  it('runs a handler successfully and records the result', async () => {
    const q = new Queue(db);
    registerHandlers(q);
    q.enqueue(JOB_TYPES.sendEmail, { dedupeKey: 'k1', to: 'a@b.c', subject: 'hi' }, { idempotencyKey: 'e1' });
    await q.drainDue();
    expect(q.counts().succeeded).toBe(1);
    expect(ledger.summary().emails).toBe(1);
  });

  it('handler is idempotent — running twice yields the effect once', async () => {
    // Prove the handler itself (independent of the queue) is safe to re-run.
    const payload = { dedupeKey: 'welcome-emp1', to: 'a@b.c', subject: 'hi' };
    await sendEmail(payload, { attempt: 1, job: {} as never });
    await sendEmail(payload, { attempt: 2, job: {} as never });
    expect(ledger.summary().emails).toBe(1);
  });

  it('retries with exponential backoff and eventually succeeds', async () => {
    const clock = fakeClock(0);
    const base = 100;
    const q = new Queue(db, { defaultMaxAttempts: 5, backoffBaseMs: base, now: clock.now });
    registerHandlers(q);
    q.enqueue(JOB_TYPES.syncWebhook, { url: 'u', event: 'e', failTimes: 2 }, { idempotencyKey: 'w1' });

    // attempt 1 → fail, next run at +base
    let job = await q.processOne();
    expect(job?.status).toBe('pending');
    expect(job?.attempts).toBe(1);
    expect(await q.processOne()).toBeNull(); // nothing due yet (backoff)

    clock.advance(base); // attempt 2 → fail, next run at +2*base
    job = await q.processOne();
    expect(job?.attempts).toBe(2);
    expect(job?.status).toBe('pending');

    clock.advance(2 * base); // attempt 3 → succeeds (failTimes=2)
    job = await q.processOne();
    expect(job?.status).toBe('succeeded');
    expect(job?.attempts).toBe(3);
    expect(ledger.summary().webhooks).toBe(1);
  });

  it('exposes an exponential backoff schedule', () => {
    const q = new Queue(db, { backoffBaseMs: 100 });
    expect(q.backoffMs(1)).toBe(100);
    expect(q.backoffMs(2)).toBe(200);
    expect(q.backoffMs(3)).toBe(400);
    expect(q.backoffMs(4)).toBe(800);
  });

  it('moves an always-failing job to dead_letter without blocking others', async () => {
    const clock = fakeClock(0);
    const q = new Queue(db, { defaultMaxAttempts: 3, backoffBaseMs: 10, now: clock.now });
    registerHandlers(q);
    q.enqueue(JOB_TYPES.syncWebhook, { url: 'u', event: 'e', failTimes: 99 }, { idempotencyKey: 'dead' });
    q.enqueue(JOB_TYPES.sendEmail, { dedupeKey: 'ok', to: 'a@b.c', subject: 'hi' }, { idempotencyKey: 'good' });

    // Drive the failing job through all its attempts.
    for (let i = 0; i < 5; i++) {
      await q.drainDue();
      clock.advance(1000);
    }

    const counts = q.counts();
    expect(counts.dead_letter).toBe(1);
    // The healthy job still completed — a poison job doesn't stall the queue.
    expect(counts.succeeded).toBe(1);
    const dead = q.list().find((j) => j.idempotencyKey === 'dead');
    expect(dead?.attempts).toBe(3);
    expect(dead?.lastError).toMatch(/503/);
  });

  it('short-circuits a re-run after a crash that committed the result but not the status', async () => {
    const q = new Queue(db);
    registerHandlers(q);
    // A job completes: side effect done, result + status committed.
    const { job } = q.enqueue(
      JOB_TYPES.calendarSync,
      { employeeId: 'emp_1', title: 'A' },
      { idempotencyKey: 'cal1' },
    );
    await q.drainDue();
    expect(ledger.summary().calendarEvents).toBe(1);

    // Simulate the crash window: the effect ran and job_results was written,
    // but the process died before the job flipped to 'succeeded'. On restart
    // the job is picked up again — it must NOT re-run the side effect.
    db.prepare("UPDATE jobs SET status = 'pending' WHERE id = ?").run(job.id);

    await q.drainDue();

    // Still exactly one calendar event; the re-run was short-circuited.
    expect(ledger.summary().calendarEvents).toBe(1);
    expect(q.getJob(job.id)?.status).toBe('succeeded');
  });
});
