/**
 * Database schema as ordered, idempotent migrations.
 *
 * Each migration has a monotonic `id`. The migration runner records applied
 * ids in `_migrations`; `pendingMigrations()` (see migrate.ts) compares the
 * code-defined list against what the DB has applied. That comparison is what
 * the preflight check uses to HALT a deploy when migrations were skipped —
 * the exact failure mode described in the incident ("migration bypasses
 * during deployment").
 */
export interface Migration {
  id: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'create_employees',
    up: `
      CREATE TABLE IF NOT EXISTS employees (
        id          TEXT PRIMARY KEY,
        full_name   TEXT NOT NULL,
        email       TEXT NOT NULL UNIQUE,
        department  TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('active','terminated','on_leave')),
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );
    `,
  },
  {
    id: 2,
    name: 'create_leave_requests',
    up: `
      CREATE TABLE IF NOT EXISTS leave_requests (
        id           TEXT PRIMARY KEY,
        employee_id  TEXT NOT NULL,
        type         TEXT NOT NULL CHECK (type IN ('annual','sick','unpaid')),
        start_date   TEXT NOT NULL,
        end_date     TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
      );
    `,
  },
  {
    id: 3,
    name: 'create_jobs',
    up: `
      CREATE TABLE IF NOT EXISTS jobs (
        id             TEXT PRIMARY KEY,
        type           TEXT NOT NULL,
        payload        TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status         TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','dead_letter')),
        attempts       INTEGER NOT NULL DEFAULT 0,
        max_attempts   INTEGER NOT NULL,
        run_at         TEXT NOT NULL,
        last_error     TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: 'create_job_results',
    up: `
      -- Records the outcome of an idempotency key so a re-run returns the
      -- stored result instead of executing the side effect a second time.
      CREATE TABLE IF NOT EXISTS job_results (
        idempotency_key TEXT PRIMARY KEY,
        result          TEXT NOT NULL,
        completed_at    TEXT NOT NULL
      );
    `,
  },
  {
    id: 5,
    name: 'create_sync_snapshots',
    up: `
      -- Last-known-good snapshots of each entity set, used to diff an
      -- incoming external sync against a trusted baseline before any
      -- destructive change is derived from it.
      CREATE TABLE IF NOT EXISTS sync_snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity      TEXT NOT NULL,
        snapshot    TEXT NOT NULL,
        row_count   INTEGER NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_entity ON sync_snapshots(entity, id DESC);
    `,
  },
  {
    id: 6,
    name: 'create_sync_audit',
    up: `
      -- Every sync attempt is audited: what came in, what we decided, and
      -- why. This is the paper trail that would have caught the destructive
      -- Google Sheets sync in the incident.
      CREATE TABLE IF NOT EXISTS sync_audit (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        entity        TEXT NOT NULL,
        outcome       TEXT NOT NULL,
        reason        TEXT NOT NULL,
        incoming_count INTEGER NOT NULL,
        applied_count INTEGER NOT NULL,
        created_at    TEXT NOT NULL
      );
    `,
  },
];
