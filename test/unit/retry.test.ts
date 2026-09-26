import { describe, expect, it } from 'vitest';
import { RetrySchedule } from '../../src/content/retry';

describe('RetrySchedule', () => {
  it('backs off exponentially up to the maximum', () => {
    const retries = new RetrySchedule(1000, 8000);
    const waits: number[] = [];
    let now = 0;
    for (let i = 0; i < 6; i++) {
      expect(retries.wait(now)).toBe(0);
      retries.attempted(now);
      waits.push(retries.wait(now));
      now += retries.wait(now);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it('allows an immediate attempt again after new content appears', () => {
    const retries = new RetrySchedule(1000, 30_000);
    for (let i = 0; i < 5; i++) retries.attempted(i);
    expect(retries.wait(10)).toBeGreaterThan(0);
    retries.reset();
    expect(retries.wait(10)).toBe(0);
    retries.attempted(10);
    expect(retries.wait(10)).toBe(1000);
  });
});
