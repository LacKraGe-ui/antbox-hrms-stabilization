import type { DB } from '../db/client.js';
import { Repository } from '../domain/repository.js';
import { SyncService } from '../sync/syncService.js';
import { MockExternalTarget } from '../sync/externalTarget.js';
import { Queue } from '../queue/queue.js';
import { registerHandlers } from '../queue/handlers/index.js';
import type { Env } from '../config/env.js';

/** Everything the HTTP layer needs, constructed once and injected. */
export interface AppContext {
  db: DB;
  repo: Repository;
  sync: SyncService;
  queue: Queue;
}

export function buildContext(db: DB, env: Env): AppContext {
  const repo = new Repository(db);
  const sync = new SyncService(db, new MockExternalTarget());
  const queue = new Queue(db, {
    defaultMaxAttempts: env.JOB_MAX_ATTEMPTS,
    backoffBaseMs: env.JOB_BACKOFF_BASE_MS,
  });
  registerHandlers(queue);
  return { db, repo, sync, queue };
}
