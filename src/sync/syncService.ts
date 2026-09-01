import type { DB } from '../db/client.js';
import { Repository } from '../domain/repository.js';
import {
  ExternalSyncPayloadSchema,
  type ExternalSyncPayload,
} from '../domain/types.js';
import { SnapshotStore } from './snapshot.js';
import type { CurrentData, ExternalTarget, SyncScenario } from './externalTarget.js';

/**
 * The safety-critical module.
 *
 * Root cause from the incident: "a Google Sheets integration deleted live
 * production database records." The DB is the system of record; an external
 * SaaS is never allowed to trigger unvalidated bulk deletes. The reconcile
 * pipeline below applies additive changes freely but treats every *deletion*
 * as guilty until proven safe, through four independent gates.
 */

export type SyncOutcome =
  | 'applied' // upserts + (any) safe deletes applied
  | 'applied_upserts_only' // upserts applied; deletes refused by a guard
  | 'rejected_validation' // payload failed strict schema validation
  | 'rejected_empty' // source empty while DB non-empty — refused entirely
  | 'rejected_null'; // no usable body at all

export interface SyncGuards {
  /**
   * Max fraction of existing rows a single sync may delete before the whole
   * deletion set is treated as an anomaly and refused. 0.2 = 20%.
   */
  maxDeleteRatio: number;
  /**
   * Absolute floor: deletions at or below this count are always allowed
   * (so a 1-of-3-row test DB can still process a legitimate single removal).
   */
  maxDeleteAbsolute: number;
}

export const DEFAULT_GUARDS: SyncGuards = {
  maxDeleteRatio: 0.2,
  maxDeleteAbsolute: 2,
};

export interface SyncResult {
  outcome: SyncOutcome;
  reason: string;
  incomingCount: number;
  appliedCount: number;
  deletionsRequested: number;
  deletionsApplied: number;
  guardsTriggered: string[];
}

export class SyncService {
  private readonly repo: Repository;
  private readonly snapshots: SnapshotStore;

  constructor(
    private readonly db: DB,
    private readonly target: ExternalTarget,
    private readonly guards: SyncGuards = DEFAULT_GUARDS,
  ) {
    this.repo = new Repository(db);
    this.snapshots = new SnapshotStore(db);
  }

  private currentData(): CurrentData {
    return {
      employees: this.repo.listEmployees(),
      leaveRequests: this.repo.listLeaveRequests(),
    };
  }

  private audit(entity: string, r: SyncResult): void {
    this.db
      .prepare(
        `INSERT INTO sync_audit (entity, outcome, reason, incoming_count, applied_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(entity, r.outcome, r.reason, r.incomingCount, r.appliedCount, new Date().toISOString());
  }

  /**
   * Pull from the external target and reconcile into the DB — safely.
   */
  async syncFromExternal(scenario: SyncScenario): Promise<SyncResult> {
    const before = this.currentData();
    // Record a last-known-good snapshot *before* we touch anything.
    this.snapshots.save('all', before);

    const raw = await this.target.pull(scenario, before);

    // ---- GATE 1: usable body ----
    if (raw === null || raw === undefined) {
      const result = this.reject('rejected_null', 'External target returned no body (null/undefined). Nothing applied.', 0, ['null-body']);
      this.audit('all', result);
      return result;
    }

    // ---- GATE 2: strict schema validation ----
    const parsed = ExternalSyncPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      const result = this.reject(
        'rejected_validation',
        `External payload failed strict validation and was discarded. No writes derived from it. Sample issues: ${detail}`,
        0,
        ['schema-validation'],
      );
      this.audit('all', result);
      return result;
    }

    const payload: ExternalSyncPayload = parsed.data;
    const incomingCount = payload.employees.length + payload.leaveRequests.length;
    const currentCount = before.employees.length + before.leaveRequests.length;

    // ---- GATE 3: empty-source guard ----
    // An empty payload from a non-empty DB is the exact incident signature.
    // "Source is now empty" and "source glitched" are indistinguishable, so
    // we fail closed and refuse the entire sync — no deletions derived.
    if (incomingCount === 0 && currentCount > 0) {
      const result = this.reject(
        'rejected_empty',
        `External source returned 0 records while the DB holds ${currentCount}. Treated as a source fault, not a mass deletion. No records removed.`,
        0,
        ['empty-source'],
      );
      this.audit('all', result);
      return result;
    }

    // Compute the proposed deletion set: records in the DB that are absent
    // from the (validated) incoming payload.
    const incomingEmpIds = new Set(payload.employees.map((e) => e.id));
    const incomingLeaveIds = new Set(payload.leaveRequests.map((l) => l.id));
    const empToDelete = before.employees.filter((e) => !incomingEmpIds.has(e.id));
    const leaveToDelete = before.leaveRequests.filter((l) => !incomingLeaveIds.has(l.id));
    const deletionsRequested = empToDelete.length + leaveToDelete.length;

    // ---- GATE 4: bulk-delete anomaly guard (snapshot verification) ----
    // Compare the proposed deletions against the last-known-good size. If a
    // single sync wants to remove more than `maxDeleteRatio` of current rows
    // (and above the absolute floor), we apply the safe additive changes but
    // refuse the deletions.
    const guardsTriggered: string[] = [];
    const ratio = currentCount === 0 ? 0 : deletionsRequested / currentCount;
    const deletionsAllowed =
      deletionsRequested <= this.guards.maxDeleteAbsolute ||
      ratio <= this.guards.maxDeleteRatio;

    // Apply upserts (always safe) in a single transaction.
    const applyUpserts = this.db.transaction(() => {
      for (const e of payload.employees) this.repo.upsertEmployee(e);
      for (const l of payload.leaveRequests) this.repo.upsertLeaveRequest(l);
    });
    applyUpserts();
    const appliedCount = incomingCount;

    let deletionsApplied = 0;
    let outcome: SyncOutcome;
    let reason: string;

    if (deletionsRequested === 0) {
      outcome = 'applied';
      reason = `Sync applied cleanly: ${appliedCount} record(s) upserted, no deletions proposed.`;
    } else if (deletionsAllowed) {
      const at = new Date().toISOString();
      const applyDeletes = this.db.transaction(() => {
        for (const e of empToDelete) this.repo.softDeleteEmployee(e.id, at);
        for (const l of leaveToDelete) this.repo.softDeleteLeaveRequest(l.id, at);
      });
      applyDeletes();
      deletionsApplied = deletionsRequested;
      outcome = 'applied';
      reason = `Sync applied: ${appliedCount} upserted, ${deletionsApplied} soft-deleted (within safe threshold; reversible).`;
    } else {
      guardsTriggered.push('bulk-delete-anomaly');
      outcome = 'applied_upserts_only';
      reason =
        `Bulk-delete anomaly: sync proposed removing ${deletionsRequested} of ${currentCount} rows ` +
        `(${(ratio * 100).toFixed(0)}% > ${(this.guards.maxDeleteRatio * 100).toFixed(0)}% limit). ` +
        `Upserts applied; deletions REFUSED pending human review.`;
    }

    // On a fully clean, deletion-inclusive apply, refresh last-known-good.
    if (outcome === 'applied') {
      this.snapshots.save('all', this.currentData());
    }

    const result: SyncResult = {
      outcome,
      reason,
      incomingCount,
      appliedCount,
      deletionsRequested,
      deletionsApplied,
      guardsTriggered,
    };
    this.audit('all', result);
    return result;
  }

  /** Export current DB state to the external target. Always non-destructive. */
  async exportToExternal(): Promise<{ rowsWritten: number }> {
    return this.target.push(this.currentData());
  }

  private reject(
    outcome: SyncOutcome,
    reason: string,
    appliedCount: number,
    guardsTriggered: string[],
  ): SyncResult {
    return {
      outcome,
      reason,
      incomingCount: 0,
      appliedCount,
      deletionsRequested: 0,
      deletionsApplied: 0,
      guardsTriggered,
    };
  }

  /** Read the audit trail (most recent first) for the dashboard. */
  recentAudit(limit = 20): Array<{
    entity: string;
    outcome: string;
    reason: string;
    incomingCount: number;
    appliedCount: number;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT entity, outcome, reason, incoming_count, applied_count, created_at
         FROM sync_audit ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      entity: string;
      outcome: string;
      reason: string;
      incoming_count: number;
      applied_count: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      entity: r.entity,
      outcome: r.outcome,
      reason: r.reason,
      incomingCount: r.incoming_count,
      appliedCount: r.applied_count,
      createdAt: r.created_at,
    }));
  }
}
