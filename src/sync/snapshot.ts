import type { DB } from '../db/client.js';
import type { CurrentData } from './externalTarget.js';

/**
 * Last-known-good snapshot store. Before any sync applies changes, we record
 * the current trusted state; the sync service diffs incoming external data
 * against the most recent snapshot to decide whether a proposed change looks
 * like a normal delta or a catastrophic wipe.
 */

interface SnapshotRow {
  snapshot: string;
  row_count: number;
}

export interface Snapshot {
  data: CurrentData;
  rowCount: number;
}

export class SnapshotStore {
  constructor(private readonly db: DB) {}

  save(entity: 'all', data: CurrentData): void {
    const rowCount = data.employees.length + data.leaveRequests.length;
    this.db
      .prepare(
        'INSERT INTO sync_snapshots (entity, snapshot, row_count, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(entity, JSON.stringify(data), rowCount, new Date().toISOString());
  }

  latest(entity: 'all'): Snapshot | null {
    const row = this.db
      .prepare(
        'SELECT snapshot, row_count FROM sync_snapshots WHERE entity = ? ORDER BY id DESC LIMIT 1',
      )
      .get(entity) as SnapshotRow | undefined;
    if (!row) return null;
    return { data: JSON.parse(row.snapshot) as CurrentData, rowCount: row.row_count };
  }
}
