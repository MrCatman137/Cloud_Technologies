export type WindowRateLimit = {
  limit: number;
  intervalMs: number;
};

export type TokenBucketRateLimit = {
  capacity: number;
  refillRate: number;
  refillIntervalMs?: number;
};

export type RateLimit = WindowRateLimit | TokenBucketRateLimit;

export type ThrottleOptions = {
  leading?: boolean;
  trailing?: boolean;
  overflowStrategy?: 'drop' | 'queue';
};

export type ThrottledFunction<T extends (...args: any[]) => any> = ((
  ...args: Parameters<T>
) => ReturnType<T> | undefined) & {
  cancel: () => void;
  flush: () => void;
};

type PendingCall<TArgs extends any[]> = {
  args: TArgs;
  context: unknown;
};

const isTokenBucket = (rateLimit: RateLimit): rateLimit is TokenBucketRateLimit =>
  'capacity' in rateLimit;

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  rateLimit: RateLimit,
  options: ThrottleOptions = {},
): ThrottledFunction<T> {
  if (typeof fn !== 'function') {
    throw new TypeError('throttle requires a function');
  }

  const leading = options.leading ?? true;
  const trailing = options.trailing ?? true;
  const overflowStrategy = options.overflowStrategy ?? 'drop';
  const windowRate = isTokenBucket(rateLimit) ? null : rateLimit;
  const bucketRate = isTokenBucket(rateLimit) ? rateLimit : null;

  if (windowRate !== null && (!Number.isInteger(windowRate.limit) || windowRate.limit < 1)) {
    throw new TypeError('limit must be a positive integer');
  }
  if (windowRate !== null && (!Number.isFinite(windowRate.intervalMs) || windowRate.intervalMs <= 0)) {
    throw new TypeError('intervalMs must be a positive number');
  }
  if (bucketRate !== null && (!Number.isFinite(bucketRate.capacity) || bucketRate.capacity < 1)) {
    throw new TypeError('capacity must be at least 1');
  }
  if (bucketRate !== null && (!Number.isFinite(bucketRate.refillRate) || bucketRate.refillRate <= 0)) {
    throw new TypeError('refillRate must be a positive number');
  }
  if (
    bucketRate !== null &&
    bucketRate.refillIntervalMs !== undefined &&
    (!Number.isFinite(bucketRate.refillIntervalMs) || bucketRate.refillIntervalMs <= 0)
  ) {
    throw new TypeError('refillIntervalMs must be a positive number');
  }

  const refillIntervalMs = bucketRate?.refillIntervalMs ?? 1_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let initialCallPending = !leading;
  let trailingCall: PendingCall<Parameters<T>> | null = null;
  const queue: Array<PendingCall<Parameters<T>>> = [];
  const executionTimes: number[] = [];
  let tokens = bucketRate?.capacity ?? 0;
  let lastRefillAt = Date.now();

  const refill = (now: number): void => {
    if (bucketRate === null) return;
    const elapsed = now - lastRefillAt;
    if (elapsed <= 0) return;
    tokens = Math.min(
      bucketRate.capacity,
      tokens + (elapsed / refillIntervalMs) * bucketRate.refillRate,
    );
    lastRefillAt = now;
  };

  const pruneWindow = (now: number): void => {
    if (windowRate === null) return;
    while (executionTimes.length > 0 && now - executionTimes[0] >= windowRate.intervalMs) {
      executionTimes.shift();
    }
  };

  const canExecute = (now: number): boolean => {
    if (windowRate !== null) {
      pruneWindow(now);
      return executionTimes.length < windowRate.limit;
    }
    refill(now);
    return tokens >= 1;
  };

  const recordExecution = (now: number): void => {
    if (windowRate !== null) {
      executionTimes.push(now);
    } else {
      tokens -= 1;
    }
    initialCallPending = false;
  };

  const waitForCapacity = (now: number): number => {
    if (windowRate !== null) {
      pruneWindow(now);
      if (executionTimes.length < windowRate.limit) return 0;
      return Math.max(0, executionTimes[0] + windowRate.intervalMs - now);
    }
    refill(now);
    if (tokens >= 1) return 0;
    return Math.max(1, ((1 - tokens) / bucketRate!.refillRate) * refillIntervalMs);
  };

  const schedule = (delayMs: number, callback: () => void): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, Math.max(0, delayMs));
  };

  const execute = (pending: PendingCall<Parameters<T>>, now: number): ReturnType<T> => {
    recordExecution(now);
    return fn.apply(pending.context, pending.args);
  };

  const drainQueue = (): void => {
    if (cancelled || queue.length === 0) return;
    let now = Date.now();
    if (initialCallPending) initialCallPending = false;
    while (queue.length > 0 && canExecute(now)) {
      execute(queue.shift()!, now);
      now = Date.now();
    }
    if (queue.length > 0) {
      const delay = initialCallPending
        ? (windowRate?.intervalMs ?? refillIntervalMs)
        : waitForCapacity(now);
      schedule(delay, drainQueue);
    }
  };

  const drainTrailing = (): void => {
    if (cancelled || trailingCall === null) return;
    const now = Date.now();
    if (initialCallPending) {
      initialCallPending = false;
      drainTrailing();
    } else if (canExecute(now)) {
      const pending = trailingCall;
      trailingCall = null;
      execute(pending, now);
    } else {
      schedule(waitForCapacity(now), drainTrailing);
    }
  };

  const throttled = function (this: unknown, ...args: Parameters<T>): ReturnType<T> | undefined {
    if (cancelled) return undefined;
    const pending = { args, context: this };

    if (overflowStrategy === 'queue') {
      queue.push(pending);
      drainQueue();
      return undefined;
    }

    const now = Date.now();
    if (!initialCallPending && canExecute(now)) {
      return execute(pending, now);
    }

    if (trailing) {
      trailingCall = pending;
      const delay = initialCallPending
        ? (windowRate?.intervalMs ?? refillIntervalMs)
        : waitForCapacity(now);
      schedule(delay, drainTrailing);
    }
    return undefined;
  } as ThrottledFunction<T>;

  throttled.cancel = (): void => {
    cancelled = true;
    queue.length = 0;
    trailingCall = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  throttled.flush = (): void => {
    if (cancelled) return;
    if (overflowStrategy === 'queue') {
      drainQueue();
    } else {
      drainTrailing();
    }
  };

  return throttled;
}