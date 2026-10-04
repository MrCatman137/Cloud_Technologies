export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function withTimeout<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return Promise.reject(new RangeError('timeoutMs must be a finite, non-negative number'));
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const operation = Promise.resolve().then(() => fn(controller.signal));
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}