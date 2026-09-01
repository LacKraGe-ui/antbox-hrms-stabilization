import type { Queue } from './queue.js';

/**
 * Background worker: polls the queue on an interval and drains due jobs. Kept
 * separate from the HTTP server so long-running side effects never ride along
 * with a user-facing request (the incident had "no background job queuing for
 * long-running side effects").
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly queue: Queue,
    private readonly pollMs = 250,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    // Don't keep the event loop alive purely for the poller.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap ticks
    this.running = true;
    try {
      await this.queue.drainDue();
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
