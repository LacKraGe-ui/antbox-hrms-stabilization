/**
 * A tiny in-memory ledger standing in for real external side effects
 * (an email provider, a calendar API, an outbound webhook). Tests and the
 * dashboard read it to prove that an effect happened *exactly once* even
 * when its job runs more than once.
 */
export interface SentEmail {
  to: string;
  subject: string;
  at: string;
}

export interface CalendarEvent {
  employeeId: string;
  title: string;
  at: string;
}

export interface WebhookDelivery {
  url: string;
  event: string;
  at: string;
}

class EffectLedger {
  readonly emails = new Map<string, SentEmail>(); // keyed by dedupe key
  readonly calendar = new Map<string, CalendarEvent>();
  readonly webhooks: WebhookDelivery[] = [];

  reset(): void {
    this.emails.clear();
    this.calendar.clear();
    this.webhooks.length = 0;
  }

  summary(): { emails: number; calendarEvents: number; webhooks: number } {
    return {
      emails: this.emails.size,
      calendarEvents: this.calendar.size,
      webhooks: this.webhooks.length,
    };
  }
}

export const ledger = new EffectLedger();
