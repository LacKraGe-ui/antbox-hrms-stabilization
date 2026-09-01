import type { Queue } from '../queue.js';
import type { JobHandler } from '../types.js';
import { ledger } from './effects.js';

/**
 * Job handlers. Each is idempotent by construction: the operation is keyed
 * so that a second execution with the same input is a no-op on the effect.
 */

export interface SendEmailPayload {
  dedupeKey: string;
  to: string;
  subject: string;
}

export const sendEmail: JobHandler<SendEmailPayload> = async (payload) => {
  // Idempotent write: keyed insert, so re-running never sends twice.
  if (!ledger.emails.has(payload.dedupeKey)) {
    ledger.emails.set(payload.dedupeKey, {
      to: payload.to,
      subject: payload.subject,
      at: new Date().toISOString(),
    });
  }
  return { messageId: payload.dedupeKey };
};

export interface CalendarSyncPayload {
  employeeId: string;
  title: string;
}

export const calendarSync: JobHandler<CalendarSyncPayload> = async (payload) => {
  // Idempotent upsert keyed by employee — running twice yields one event.
  ledger.calendar.set(payload.employeeId, {
    employeeId: payload.employeeId,
    title: payload.title,
    at: new Date().toISOString(),
  });
  return { ok: true };
};

export interface WebhookPayload {
  url: string;
  event: string;
  /**
   * Test/demo affordance: fail this many times before succeeding, to
   * exercise exponential backoff and (if it never succeeds) dead-lettering.
   */
  failTimes?: number;
}

export const syncWebhook: JobHandler<WebhookPayload> = async (payload, ctx) => {
  const failTimes = payload.failTimes ?? 0;
  if (ctx.attempt <= failTimes) {
    throw new Error(
      `Webhook target ${payload.url} returned 503 (attempt ${ctx.attempt} of expected ${failTimes} failures)`,
    );
  }
  ledger.webhooks.push({ url: payload.url, event: payload.event, at: new Date().toISOString() });
  return { delivered: true, attempt: ctx.attempt };
};

export const JOB_TYPES = {
  sendEmail: 'send_email',
  calendarSync: 'calendar_sync',
  syncWebhook: 'sync_webhook',
} as const;

/** Register every handler on a queue instance. */
export function registerHandlers(queue: Queue): void {
  queue.register(JOB_TYPES.sendEmail, sendEmail);
  queue.register(JOB_TYPES.calendarSync, calendarSync);
  queue.register(JOB_TYPES.syncWebhook, syncWebhook);
}
