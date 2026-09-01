import { loadDotenv } from './config/loadDotenv.js';
loadDotenv();
import { loadEnv } from './config/env.js';
import { openDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { readiness } from './health/checks.js';
import { buildContext } from './server/context.js';
import { createApp } from './server/app.js';
import { Worker } from './queue/worker.js';
import { Repository } from './domain/repository.js';

/**
 * Application entrypoint. Boot order is deliberate and fail-closed:
 *
 *   1. Validate env (throws → process never starts on bad config).
 *   2. Open DB + apply migrations (the app owns its schema).
 *   3. Seed a fresh DB so the dashboard has data to show.
 *   4. Verify readiness; a degraded state exits non-zero rather than
 *      serving traffic in a broken state.
 *   5. Only then bind the HTTP server and start the background worker.
 *
 * The dedicated pre-deploy gate lives in `scripts/preflight.ts` (run it as
 * `npm run preflight` before releasing); this boot sequence is the app's own
 * last line of defence.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const db = openDb(env.DATABASE_URL);
  const { applied } = runMigrations(db);
  if (applied.length) console.log(`✓ Applied migrations: ${applied.join(', ')}`);

  // Seed only an empty DB.
  const repo = new Repository(db);
  if (repo.countEmployees() === 0) {
    const counts = seed(db);
    console.log(`✓ Seeded ${counts.employees} employees, ${counts.leave} leave requests`);
  }

  const health = readiness(db);
  if (health.status !== 'ok') {
    console.error('✗ Readiness check failed at boot — refusing to serve traffic:');
    for (const c of health.checks.filter((c) => !c.ok)) {
      console.error(`    - ${c.name}: ${c.detail}`);
    }
    process.exit(1);
  }

  const ctx = buildContext(db, env);
  const app = createApp(ctx);

  const worker = new Worker(ctx.queue, env.WORKER_POLL_MS);
  worker.start();

  const server = app.listen(env.PORT, () => {
    console.log(`\n  AntBox HRMS stabilization service`);
    console.log(`  → Dashboard:  http://localhost:${env.PORT}/`);
    console.log(`  → Liveness:   http://localhost:${env.PORT}/health/live`);
    console.log(`  → Readiness:  http://localhost:${env.PORT}/health/ready\n`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received — shutting down gracefully.`);
    worker.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
