import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

/**
 * Open a SQLite connection. `:memory:` is honoured for tests. WAL mode +
 * foreign keys are enabled so the DB behaves like a real relational store
 * (the "system of record" the brief insists on).
 */
export function openDb(databaseUrl: string): DB {
  if (databaseUrl !== ':memory:') {
    // Ensure the parent directory exists so a first run doesn't crash.
    mkdirSync(dirname(databaseUrl), { recursive: true });
  }
  const db = new Database(databaseUrl);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
