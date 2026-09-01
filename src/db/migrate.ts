import type { DB } from './client.js';
import { openDb } from './client.js';
import { MIGRATIONS } from './schema.js';
import { loadEnv } from '../config/env.js';
import { loadDotenv } from '../config/loadDotenv.js';

interface MigrationRow {
  id: number;
}

function ensureMigrationsTable(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/** Ids the DB has already applied. */
export function appliedMigrationIds(db: DB): number[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare('SELECT id FROM _migrations ORDER BY id ASC')
    .all() as MigrationRow[];
  return rows.map((r) => r.id);
}

/**
 * Migrations defined in code but not yet applied to this DB. This is the
 * function the preflight check calls: if it returns a non-empty list in a
 * production start, the deploy must halt rather than run against a schema
 * that doesn't match the code.
 */
export function pendingMigrations(db: DB): typeof MIGRATIONS {
  const applied = new Set(appliedMigrationIds(db));
  return MIGRATIONS.filter((m) => !applied.has(m.id));
}

/** Apply all pending migrations inside a transaction each. */
export function runMigrations(db: DB): { applied: number[] } {
  ensureMigrationsTable(db);
  const pending = pendingMigrations(db);
  const appliedNow: number[] = [];

  const insert = db.prepare(
    'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  for (const migration of pending) {
    const tx = db.transaction(() => {
      db.exec(migration.up);
      insert.run(migration.id, migration.name, new Date().toISOString());
    });
    tx();
    appliedNow.push(migration.id);
  }

  return { applied: appliedNow };
}

// CLI entrypoint: `npm run migrate`
const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  loadDotenv();
  const env = loadEnv();
  const db = openDb(env.DATABASE_URL);
  const { applied } = runMigrations(db);
  if (applied.length === 0) {
    console.log('✓ Database is up to date — no migrations to apply.');
  } else {
    console.log(`✓ Applied ${applied.length} migration(s): ${applied.join(', ')}`);
  }
  db.close();
}
