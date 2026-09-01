import express, { type Express, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { liveness, readiness } from '../health/checks.js';
import type { SyncScenario } from '../sync/externalTarget.js';
import { JOB_TYPES } from '../queue/handlers/index.js';
import { ledger } from '../queue/handlers/effects.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the dashboard directory across both run modes: `tsx src/…` (dev)
 * and `node dist/src/…` (built). The .ts sources live two levels below the
 * project root, the compiled files three levels below dist/src, so probe the
 * candidates and use the first that actually holds index.html.
 */
function resolvePublicDir(): string {
  const candidates = [
    join(__dirname, '..', '..', 'public'), // dev: src/server -> root/public
    join(__dirname, '..', '..', '..', 'public'), // built: dist/src/server -> root/public
    join(process.cwd(), 'public'),
  ];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? candidates[0]!;
}
const PUBLIC_DIR = resolvePublicDir();

const ScenarioSchema = z.enum([
  'healthy',
  'empty',
  'malformed',
  'null',
  'mass_delete',
  'partial_update',
]);

const EnqueueSchema = z.object({
  type: z.enum(['send_email', 'calendar_sync', 'sync_webhook']),
  failTimes: z.number().int().min(0).max(10).optional(),
});

/**
 * Build the Express app around an already-constructed context. Returning the
 * app (rather than listening here) lets tests drive it with supertest and
 * lets index.ts own the process lifecycle.
 */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json());

  // ---- Health ----
  app.get('/health/live', (_req: Request, res: Response) => {
    res.json(liveness());
  });

  app.get('/health/ready', (_req: Request, res: Response) => {
    const report = readiness(ctx.db);
    // Readiness failures must surface as 503 so a load balancer stops routing.
    res.status(report.status === 'ok' ? 200 : 503).json(report);
  });

  // ---- Data reads ----
  app.get('/api/employees', (_req, res) => {
    res.json({ employees: ctx.repo.listEmployees() });
  });

  app.get('/api/leave', (_req, res) => {
    res.json({ leaveRequests: ctx.repo.listLeaveRequests() });
  });

  app.get('/api/sync/audit', (_req, res) => {
    res.json({ audit: ctx.sync.recentAudit() });
  });

  // ---- Sync (the safety-critical action) ----
  app.post('/api/sync/pull', async (req, res) => {
    const parsed = ScenarioSchema.safeParse(req.body?.scenario);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid scenario', allowed: ScenarioSchema.options });
      return;
    }
    const result = await ctx.sync.syncFromExternal(parsed.data as SyncScenario);
    // A refused sync is a *successful* safety outcome, not a 500 — the API
    // did exactly what it should. Report 200 with the outcome in the body.
    res.json({ result });
  });

  app.post('/api/sync/push', async (_req, res) => {
    const result = await ctx.sync.exportToExternal();
    res.json({ result });
  });

  // ---- Jobs ----
  app.get('/api/jobs', (_req, res) => {
    res.json({
      jobs: ctx.queue.list(),
      counts: ctx.queue.counts(),
      effects: ledger.summary(),
    });
  });

  app.post('/api/jobs/enqueue', (req, res) => {
    const parsed = EnqueueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid job request', detail: parsed.error.issues });
      return;
    }
    const { type, failTimes } = parsed.data;
    // Unique per request so distinct demo clicks always create distinct jobs.
    // (The email case below deliberately reuses ONE key twice to show dedupe.)
    const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;

    if (type === JOB_TYPES.sendEmail) {
      // Enqueue the SAME effect twice to demonstrate idempotent enqueue:
      // the second call collapses onto the first (deduped), so the welcome
      // email is sent exactly once no matter how many times it's requested.
      const key = `email_welcome_${stamp}`;
      const payload = { dedupeKey: `welcome_${stamp}`, to: 'new.hire@antbox.test', subject: 'Welcome to AntBox' };
      const first = ctx.queue.enqueue(JOB_TYPES.sendEmail, payload, { idempotencyKey: key });
      const second = ctx.queue.enqueue(JOB_TYPES.sendEmail, payload, { idempotencyKey: key });
      res.json({ enqueued: first, duplicate: second, dedupedSecond: second.deduped });
      return;
    }
    if (type === JOB_TYPES.calendarSync) {
      const r = ctx.queue.enqueue(
        JOB_TYPES.calendarSync,
        { employeeId: `emp_${stamp}`, title: 'Onboarding sync' },
        { idempotencyKey: `cal_${stamp}` },
      );
      res.json({ enqueued: r });
      return;
    }
    // sync_webhook — supports failTimes to demo backoff / dead-letter.
    const r = ctx.queue.enqueue(
      JOB_TYPES.syncWebhook,
      { url: 'https://hooks.antbox.test/hr', event: 'employee.updated', failTimes: failTimes ?? 0 },
      { idempotencyKey: `hook_${stamp}` },
    );
    res.json({ enqueued: r });
  });

  // Manually drain due jobs (the demo lets you step the worker by hand so the
  // retry/backoff sequence is observable; in production the Worker polls).
  app.post('/api/jobs/process', async (_req, res) => {
    const processed = await ctx.queue.drainDue();
    res.json({ processed, counts: ctx.queue.counts() });
  });

  // ---- Combined state for the dashboard (one round-trip) ----
  app.get('/api/state', (_req, res) => {
    res.json({
      employees: ctx.repo.listEmployees(),
      leaveRequests: ctx.repo.listLeaveRequests(),
      jobs: ctx.queue.list(),
      jobCounts: ctx.queue.counts(),
      effects: ledger.summary(),
      audit: ctx.sync.recentAudit(),
      health: readiness(ctx.db),
      counts: {
        employees: ctx.repo.countEmployees(),
        leave: ctx.repo.countLeaveRequests(),
      },
    });
  });

  // ---- Static dashboard ----
  app.use(express.static(PUBLIC_DIR));

  return app;
}
