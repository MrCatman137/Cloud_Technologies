import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateDelay, Retryer, type RetryOptions } from './retry.js';

const baseOptions: RetryOptions = {
  maxAttempts: 4,
  strategy: 'exponential',
  baseDelayMs: 100,
  multiplier: 2,
  maxDelayMs: 10_000,
  maxJitterMs: 50,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Retryer', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const retryer = new Retryer(baseOptions);

    await expect(retryer.execute(fn)).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('eventually succeeds on the third attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockResolvedValue('ok');
    const retryer = new Retryer(baseOptions);
    const execution = retryer.execute(fn);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(execution).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after maxAttempts and waits for the exact cumulative delay', async () => {
    const failure = new Error('still unavailable');
    const fn = vi.fn().mockRejectedValue(failure);
    const retryer = new Retryer({ ...baseOptions, maxAttempts: 4 });
    const execution = retryer.execute(fn);
    const rejection = expect(execution).rejects.toBe(failure);

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(400);

    await rejection;
    expect(fn).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts immediately for a non-retryable error', async () => {
    class FatalError extends Error {}
    const failure = new FatalError('invalid request');
    const fn = vi.fn().mockRejectedValue(failure);
    const retryer = new Retryer({ ...baseOptions, retryOn: [503] });

    await expect(retryer.execute(fn)).rejects.toBe(failure);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('calculateDelay', () => {
  const options = {
    baseDelayMs: 100,
    multiplier: 2,
    maxDelayMs: 350,
    maxJitterMs: 25,
  };

  it('calculates constant delays', () => {
    expect(calculateDelay({ ...options, strategy: 'constant' }, 1)).toBe(100);
    expect(calculateDelay({ ...options, strategy: 'constant' }, 4)).toBe(100);
  });

  it('calculates capped exponential delays', () => {
    expect(calculateDelay({ ...options, strategy: 'exponential' }, 1)).toBe(100);
    expect(calculateDelay({ ...options, strategy: 'exponential' }, 2)).toBe(200);
    expect(calculateDelay({ ...options, strategy: 'exponential' }, 3)).toBe(350);
  });

  it('adds deterministic jitter and respects the cap', () => {
    const delay = calculateDelay({ ...options, strategy: 'exponentialJitter' }, 2, () => 0.5);
    expect(delay).toBe(213);
    expect(calculateDelay({ ...options, strategy: 'exponentialJitter' }, 3, () => 1)).toBe(350);
  });
});
