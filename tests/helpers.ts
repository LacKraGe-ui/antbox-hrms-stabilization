import type { DB } from '../src/db/client.js';
import { openDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

/** Fresh in-memory DB, migrated and (optionally) seeded. */
export function testDb(withSeed = true): DB {
  const db = openDb(':memory:');
  runMigrations(db);
  if (withSeed) seed(db);
  return db;
}

/** A controllable clock for deterministic backoff/retry tests. */
export function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}
