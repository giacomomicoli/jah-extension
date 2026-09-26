/**
 * Exponential backoff for re-resolving highlights that are missing while the page keeps
 * changing: unrelated churn (clocks, tickers, ads) makes attempts rarer, while content that
 * actually appears resets the schedule so it is picked up right away.
 */
export class RetrySchedule {
  private delay: number;
  private nextAt = 0;

  constructor(
    private readonly minDelay = 1000,
    private readonly maxDelay = 30_000,
  ) {
    this.delay = minDelay;
  }

  /** Milliseconds until the next attempt is allowed (0 = now). */
  wait(now: number): number {
    return Math.max(0, this.nextAt - now);
  }

  /** Records an attempt and doubles the delay before the next one. */
  attempted(now: number): void {
    this.nextAt = now + this.delay;
    this.delay = Math.min(this.delay * 2, this.maxDelay);
  }

  /** New content appeared: allow an immediate attempt and restart the backoff. */
  reset(): void {
    this.delay = this.minDelay;
    this.nextAt = 0;
  }
}
