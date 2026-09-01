import { parseEnv } from '../config/env.js';
import { openDb } from '../db/client.js';
import { pendingMigrations } from '../db/migrate.js';

/**
 * Fail-closed preflight check.
 *
 * The incident involved "migration bypasses during deployment". The cure is
 * a gate that runs BEFORE the app takes traffic and refuses to proceed when
 * the deploy is unsafe:
 *
 *   - required env vars missing / invalid, or
 *   - migrations pending against the target database.
 *
 * `runPreflight()` never throws — it returns a structured verdict. The CLI
 * wrapper (scripts/preflight.ts) turns a failing verdict into a non-zero
 * exit code so a CI/CD pipeline halts the rollout.
 */

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

export function runPreflight(
  source: NodeJS.ProcessEnv = process.env,
): PreflightResult {
  const checks: PreflightCheck[] = [];

  // 1. Environment contract.
  const env = parseEnv(source);
  if (env.ok && env.env) {
    checks.push({ name: 'environment', ok: true, detail: 'All required variables present and valid.' });
  } else {
    checks.push({
      name: 'environment',
      ok: false,
      detail: `Invalid/missing env: ${env.errors.join('; ')}`,
    });
    // Can't check the DB without a valid DATABASE_URL — stop here.
    return { ok: false, checks };
  }

  // 2. Migrations must be fully applied.
  try {
    const db = openDb(env.env.DATABASE_URL);
    try {
      const pending = pendingMigrations(db);
      if (pending.length === 0) {
        checks.push({ name: 'migrations', ok: true, detail: 'Schema is up to date.' });
      } else {
        checks.push({
          name: 'migrations',
          ok: false,
          detail: `${pending.length} pending migration(s) would be bypassed: ${pending
            .map((m) => `#${m.id} ${m.name}`)
            .join(', ')}. Run migrations before deploying.`,
        });
      }
    } finally {
      db.close();
    }
  } catch (err) {
    checks.push({
      name: 'migrations',
      ok: false,
      detail: `Could not verify migrations: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}
