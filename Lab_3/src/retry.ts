export type RetryStrategy = 'constant' | 'exponential' | 'exponentialJitter';

export type ErrorConstructor = new (...args: never[]) => Error;
export type RetryPredicate = (error: unknown) => boolean;
export type RetryOn = ErrorConstructor[] | number[] | RetryPredicate;

export interface RetryOptions {
  maxAttempts: number;
  strategy: RetryStrategy;
  baseDelayMs: number;
  multiplier?: number;
  maxDelayMs?: number;
  maxJitterMs?: number;
  retryOn?: RetryOn;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export interface RequiredRetryOptions {
  maxAttempts: number;
  strategy: RetryStrategy;
  baseDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  maxJitterMs: number;
  retryOn?: RetryOn;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export function calculateDelay(
  options: Pick<RequiredRetryOptions, 'strategy' | 'baseDelayMs' | 'multiplier' | 'maxDelayMs' | 'maxJitterMs'>,
  retryNumber: number,
  random: () => number = Math.random,
): number {
  const exponentialDelay = options.baseDelayMs * options.multiplier ** (retryNumber - 1);
  const uncappedDelay = options.strategy === 'constant'
    ? options.baseDelayMs
    : exponentialDelay;
  const cappedDelay = Math.min(uncappedDelay, options.maxDelayMs);

  if (options.strategy !== 'exponentialJitter') {
    return cappedDelay;
  }

  const jitter = Math.floor(random() * (options.maxJitterMs + 1));
  return Math.min(cappedDelay + jitter, options.maxDelayMs);
}

function isErrorConstructorList(value: RetryOn): value is ErrorConstructor[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'function');
}

function isStatusCodeList(value: RetryOn): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === 'number') {
    return candidate.status;
  }
  if (typeof candidate.statusCode === 'number') {
    return candidate.statusCode;
  }
  return undefined;
}

function matchesRetryOn(error: unknown, retryOn: RetryOn): boolean {
  if (typeof retryOn === 'function') {
    return retryOn(error);
  }
  if (isStatusCodeList(retryOn)) {
    const statusCode = getStatusCode(error);
    return statusCode !== undefined && retryOn.includes(statusCode);
  }
  if (isErrorConstructorList(retryOn)) {
    return retryOn.some((errorType) => error instanceof errorType);
  }
  return false;
}

function validateOptions(options: RequiredRetryOptions): void {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RangeError('maxAttempts must be an integer greater than or equal to 1');
  }
  if (options.baseDelayMs < 0 || options.maxDelayMs < 0 || options.maxJitterMs < 0) {
    throw new RangeError('Delay values cannot be negative');
  }
  if (options.multiplier < 0) {
    throw new RangeError('multiplier cannot be negative');
  }
  if (options.maxDelayMs < options.baseDelayMs) {
    throw new RangeError('maxDelayMs must be greater than or equal to baseDelayMs');
  }
}

export class Retryer {
  private readonly options: RequiredRetryOptions;

  public constructor(options: RetryOptions) {
    this.options = {
      multiplier: 2,
      maxDelayMs: Number.POSITIVE_INFINITY,
      maxJitterMs: 0,
      ...options,
    };
    validateOptions(this.options);
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 1;

    while (true) {
      try {
        return await fn();
      } catch (error: unknown) {
        const canRetry = attempt < this.options.maxAttempts
          && (this.options.retryOn === undefined || matchesRetryOn(error, this.options.retryOn));

        if (!canRetry) {
          throw error;
        }

        const delayMs = calculateDelay(this.options, attempt);
        this.options.onRetry?.(attempt, delayMs, error);
        await this.delay(delayMs);
        attempt += 1;
      }
    }
  }

  private delay(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
