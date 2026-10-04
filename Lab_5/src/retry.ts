export interface RetryOptions {
  retries: number;
  delayMs?: number;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  { retries, delayMs = 0 }: RetryOptions,
): Promise<T> {
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('retries must be a non-negative integer');
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a finite, non-negative number');
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt <= retries && delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}