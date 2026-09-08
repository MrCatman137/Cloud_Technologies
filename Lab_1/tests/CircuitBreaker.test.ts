import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerHalfOpenExhaustedError,
  CircuitBreakerOpenError,
  TimeoutError,
} from '../src/CircuitBreaker.js';

const options = {
  failureThreshold: 3,
  halfOpenMaxCalls: 2,
  openStateDuration: 100,
  timeoutPerCall: 50,
};

async function tripBreaker(breaker: CircuitBreaker): Promise<void> {
  for (let attempt = 0; attempt < options.failureThreshold; attempt++) {
    await expect(breaker.call(async () => {
      throw new Error('failure');
    })).rejects.toThrow('failure');
  }
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts CLOSED', () => {
    expect(new CircuitBreaker(options).state()).toBe('CLOSED');
  });

  it('returns successful CLOSED results and invokes once', async () => {
    const breaker = new CircuitBreaker(options);
    const fn = vi.fn(async () => 'ok');

    await expect(breaker.call(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
    expect(breaker.state()).toBe('CLOSED');
  });

  it('keeps successful calls CLOSED and resets consecutive failures', async () => {
    const breaker = new CircuitBreaker(options);
    const fail = async () => { throw new Error('failure'); };

    await expect(breaker.call(fail)).rejects.toThrow('failure');
    await expect(breaker.call(fail)).rejects.toThrow('failure');
    await expect(breaker.call(async () => 42)).resolves.toBe(42);
    await expect(breaker.call(fail)).rejects.toThrow('failure');
    await expect(breaker.call(fail)).rejects.toThrow('failure');
    expect(breaker.state()).toBe('CLOSED');
  });

  it('remains CLOSED below the failure threshold', async () => {
    const breaker = new CircuitBreaker(options);

    await expect(breaker.call(async () => { throw new Error('one'); })).rejects.toThrow('one');
    await expect(breaker.call(async () => { throw new Error('two'); })).rejects.toThrow('two');
    expect(breaker.state()).toBe('CLOSED');
  });

  it('opens when the failure threshold is reached', async () => {
    const breaker = new CircuitBreaker(options);

    await tripBreaker(breaker);
    expect(breaker.state()).toBe('OPEN');
  });

  it('preserves the exact original rejection', async () => {
    const breaker = new CircuitBreaker(options);
    const originalError = new Error('service unavailable');

    await expect(breaker.call(async () => { throw originalError; })).rejects.toBe(originalError);
  });

  it('counts timeouts as failures and eventually opens', async () => {
    const breaker = new CircuitBreaker(options);
    const neverSettles = () => new Promise<string>(() => undefined);

    for (let attempt = 0; attempt < options.failureThreshold; attempt++) {
      const result = breaker.call(neverSettles);
      const rejection = expect(result).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(options.timeoutPerCall);
      await rejection;
    }

    expect(breaker.state()).toBe('OPEN');
  });

  it('fails fast while OPEN without invoking the function', async () => {
    const breaker = new CircuitBreaker(options);
    await tripBreaker(breaker);
    const fn = vi.fn(async () => 'must not execute');

    await expect(breaker.call(fn)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('lazily transitions OPEN to HALF_OPEN at the cooldown boundary', async () => {
    const breaker = new CircuitBreaker(options);
    await tripBreaker(breaker);

    expect(breaker.state()).toBe('OPEN');
    await vi.advanceTimersByTimeAsync(options.openStateDuration);
    expect(breaker.state()).toBe('HALF_OPEN');
  });

  it('closes after the required successful HALF_OPEN probes', async () => {
    const breaker = new CircuitBreaker({ ...options, halfOpenMaxCalls: 3 });
    await tripBreaker(breaker);
    await vi.advanceTimersByTimeAsync(options.openStateDuration);

    await expect(breaker.call(async () => 'a')).resolves.toBe('a');
    await expect(breaker.call(async () => 'b')).resolves.toBe('b');
    await expect(breaker.call(async () => 'c')).resolves.toBe('c');
    expect(breaker.state()).toBe('CLOSED');
    await expect(breaker.call(async () => 'normal')).resolves.toBe('normal');
  });

  it('reopens on a HALF_OPEN failure and refreshes the cooldown', async () => {
    const breaker = new CircuitBreaker(options);
    await tripBreaker(breaker);
    await vi.advanceTimersByTimeAsync(options.openStateDuration);

    await expect(breaker.call(async () => { throw new Error('probe failed'); })).rejects.toThrow('probe failed');
    expect(breaker.state()).toBe('OPEN');
    await expect(breaker.call(async () => 'blocked')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it('reopens on a HALF_OPEN timeout', async () => {
    const breaker = new CircuitBreaker(options);
    await tripBreaker(breaker);
    await vi.advanceTimersByTimeAsync(options.openStateDuration);

    const result = breaker.call(() => new Promise<string>(() => undefined));
    const rejection = expect(result).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(options.timeoutPerCall);
    await rejection;
    expect(breaker.state()).toBe('OPEN');
  });

  it('limits concurrent HALF_OPEN probes', async () => {
    const breaker = new CircuitBreaker(options);
    await tripBreaker(breaker);
    await vi.advanceTimersByTimeAsync(options.openStateDuration);

    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const first = vi.fn(() => new Promise<string>((resolve) => { resolveFirst = resolve; }));
    const second = vi.fn(() => new Promise<string>((resolve) => { resolveSecond = resolve; }));
    const third = vi.fn(async () => 'third');

    const firstCall = breaker.call(first);
    const secondCall = breaker.call(second);
    await Promise.resolve();
    await expect(breaker.call(third)).rejects.toBeInstanceOf(CircuitBreakerHalfOpenExhaustedError);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).not.toHaveBeenCalled();

    resolveFirst('first');
    resolveSecond('second');
    await expect(firstCall).resolves.toBe('first');
    await expect(secondCall).resolves.toBe('second');
    expect(breaker.state()).toBe('CLOSED');
  });

  it('clears timeout timers after success, rejection, and timeout', async () => {
    const breaker = new CircuitBreaker({ ...options, failureThreshold: 10 });

    await breaker.call(async () => 'success');
    expect(vi.getTimerCount()).toBe(0);

    await expect(breaker.call(async () => { throw new Error('rejected'); })).rejects.toThrow('rejected');
    expect(vi.getTimerCount()).toBe(0);

    const timeoutCall = breaker.call(() => new Promise<string>(() => undefined));
    const timeoutRejection = expect(timeoutCall).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(options.timeoutPerCall);
    await timeoutRejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores late settlement after a timeout', async () => {
    const breaker = new CircuitBreaker({ ...options, failureThreshold: 2 });
    let resolveOperation!: (value: string) => void;
    const operation = breaker.call(() => new Promise<string>((resolve) => { resolveOperation = resolve; }));
    const timeoutRejection = expect(operation).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(options.timeoutPerCall);
    await timeoutRejection;
    expect(breaker.state()).toBe('CLOSED');

    resolveOperation('late result');
    await Promise.resolve();
    expect(breaker.state()).toBe('CLOSED');
  });

  it.each([
    ['failureThreshold', { failureThreshold: 0 }],
    ['failureThreshold', { failureThreshold: -1 }],
    ['halfOpenMaxCalls', { halfOpenMaxCalls: 0 }],
    ['halfOpenMaxCalls', { halfOpenMaxCalls: -1 }],
    ['openStateDuration', { openStateDuration: -1 }],
    ['timeoutPerCall', { timeoutPerCall: 0 }],
    ['timeoutPerCall', { timeoutPerCall: -1 }],
    ['NaN', { timeoutPerCall: NaN }],
    ['Infinity', { timeoutPerCall: Infinity }],
    ['-Infinity', { timeoutPerCall: -Infinity }],
  ])('rejects invalid %s configuration', (_, invalidOptions) => {
    expect(() => new CircuitBreaker({ ...options, ...invalidOptions })).toThrow(TypeError);
  });

  it('preserves generic result types', async () => {
    const breaker = new CircuitBreaker(options);
    const stringResult: string = await breaker.call(async () => 'hello');
    const numberResult: number = await breaker.call(async () => 123);

    expect(stringResult).toBe('hello');
    expect(numberResult).toBe(123);
  });
});
