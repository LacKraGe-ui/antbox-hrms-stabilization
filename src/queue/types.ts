export type JobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'dead_letter';

export interface Job<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A job handler performs the side effect. Handlers MUST be idempotent —
 * running twice with the same payload must be safe, because at-least-once
 * delivery means a handler can legitimately run more than once (e.g. the
 * process died after the side effect but before the status was committed).
 *
 * Returning a value stores it against the idempotency key so a later
 * duplicate is short-circuited without re-executing.
 */
export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
  ctx: { attempt: number; job: Job<TPayload> },
) => Promise<unknown>;

export interface EnqueueOptions {
  /**
   * Stable key that identifies the *effect*, not the request. Two enqueues
   * with the same key collapse to one job. Defaults to a random id (i.e. not
   * deduped) if omitted — but for real side effects you should always set it.
   */
  idempotencyKey?: string;
  maxAttempts?: number;
  /** Delay before first run, ms. */
  delayMs?: number;
}
