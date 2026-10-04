import { describe, expect, it } from 'vitest';
import { withRetry } from './retry.js';
import { TimeoutError, withTimeout } from './timeout.js';

describe('withTimeout', () => {
  it('returns a result when the operation finishes in time', async () => {
    await expect(withTimeout(async () => 'finished', 50)).resolves.toBe('finished');
  });

  it('throws TimeoutError and aborts the operation when the deadline wins', async () => {
    let wasAborted = false;
    const result = withTimeout(
      (signal) =>
        new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => {
            wasAborted = true;
            reject(new Error('operation cancelled'));
          });
        }),
      10,
    );

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    expect(wasAborted).toBe(true);
  });
});

describe('withRetry and withTimeout', () => {
  it('retries a timed-out call the configured number of times', async () => {
    let attempts = 0;

    const result = withRetry(
      () => {
        attempts += 1;
        return withTimeout(() => new Promise<string>(() => undefined), 5);
      },
      { retries: 2 },
    );

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    expect(attempts).toBe(3);
  });
});