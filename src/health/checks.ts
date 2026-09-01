import type { DB } from '../db/client.js';
import { pendingMigrations } from '../db/migrate.js';

/**
 * Liveness vs readiness — the distinction matters operationally:
 *
 *   - LIVENESS  ("/health/live")  → is the process itself up? A failing
 *     liveness check tells an orchestrator to RESTART the pod.
 *   - READINESS ("/health/ready") → can it safely serve traffic right now?
 *     A failing readiness check tells the load balancer to STOP routing to
 *     it (but not restart) — e.g. the DB is unreachable or migrations are
 *     pending. Serving traffic in that state is how bad deploys cause damage.
 */

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: CheckResult[];
  at: string;
}

/** Liveness: cheap, no dependencies. If the event loop runs, we're alive. */
export function liveness(): HealthReport {
  return {
    status: 'ok',
    checks: [{ name: 'process', ok: true }],
    at: new Date().toISOString(),
  };
}

/** Readiness: verifies the DB answers and the schema is fully migrated. */
export function readiness(db: DB): HealthReport {
  const checks: CheckResult[] = [];

  // 1. Database connectivity.
  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
    checks.push({ name: 'database', ok: true });
  } catch (err) {
    checks.push({
      name: 'database',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Schema is up to date (no migration bypass).
  if (dbOk) {
    try {
      const pending = pendingMigrations(db);
      if (pending.length === 0) {
        checks.push({ name: 'migrations', ok: true });
      } else {
        checks.push({
          name: 'migrations',
          ok: false,
          detail: `${pending.length} pending migration(s): ${pending.map((m) => m.name).join(', ')}`,
        });
      }
    } catch (err) {
      checks.push({
        name: 'migrations',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allOk = checks.every((c) => c.ok);
  return {
    status: allOk ? 'ok' : 'degraded',
    checks,
    at: new Date().toISOString(),
  };
}
