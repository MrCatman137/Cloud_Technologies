export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  halfOpenMaxCalls: number;
  openStateDuration: number;
  timeoutPerCall: number;
}

export interface ICircuitBreaker {
  state(): CircuitBreakerState;
  call<T>(fn: () => Promise<T>): Promise<T>;
}

export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is open') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreakerHalfOpenExhaustedError extends Error {
  constructor(message = 'Circuit breaker has no available half-open probe capacity') {
    super(message);
    this.name = 'CircuitBreakerHalfOpenExhaustedError';
  }
}

export class TimeoutError extends Error {
  constructor(message = 'Circuit breaker call timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class CircuitBreaker implements ICircuitBreaker {
  private currentState: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private halfOpenCalls = 0;
  private halfOpenSuccesses = 0;
  private nextAttemptTimestamp = 0;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.validateOptions(options);
  }

  state(): CircuitBreakerState {
    if (
      this.currentState === 'OPEN' &&
      Date.now() >= this.nextAttemptTimestamp
    ) {
      this.currentState = 'HALF_OPEN';
      this.halfOpenCalls = 0;
      this.halfOpenSuccesses = 0;
    }

    return this.currentState;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state();

    if (currentState === 'OPEN') {
      throw new CircuitBreakerOpenError();
    }

    if (currentState === 'HALF_OPEN') {
      if (this.halfOpenCalls >= this.options.halfOpenMaxCalls) {
        throw new CircuitBreakerHalfOpenExhaustedError();
      }
      this.halfOpenCalls++;
    }

    const operation = Promise.resolve().then(fn);
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
      timerId = setTimeout(() => reject(new TimeoutError()), this.options.timeoutPerCall);
    });

    try {
      const result = await Promise.race([operation, timeout]);
      this.handleSuccess(currentState);
      return result;
    } catch (error) {
      this.handleFailure(currentState);
      throw error;
    } finally {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    }
  }

  private handleSuccess(admittedState: CircuitBreakerState): void {
    if (admittedState === 'HALF_OPEN') {
      this.halfOpenCalls--;
      if (this.currentState !== 'HALF_OPEN') {
        return;
      }

      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.options.halfOpenMaxCalls) {
        this.currentState = 'CLOSED';
        this.consecutiveFailures = 0;
        this.halfOpenCalls = 0;
        this.halfOpenSuccesses = 0;
        this.nextAttemptTimestamp = 0;
      }
      return;
    }

    if (this.currentState === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
  }

  private handleFailure(admittedState: CircuitBreakerState): void {
    if (admittedState === 'HALF_OPEN') {
      this.halfOpenCalls--;
      if (this.currentState === 'HALF_OPEN') {
        this.open();
      }
      return;
    }

    if (this.currentState !== 'CLOSED') {
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.currentState = 'OPEN';
    this.nextAttemptTimestamp = Date.now() + this.options.openStateDuration;
  }

  private validateOptions(options: CircuitBreakerOptions): void {
    const positiveOptions: Array<keyof CircuitBreakerOptions> = [
      'failureThreshold',
      'halfOpenMaxCalls',
      'timeoutPerCall',
    ];

    for (const optionName of positiveOptions) {
      const value = options[optionName];
      if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(`${optionName} must be a finite number greater than 0`);
      }
    }

    if (!Number.isFinite(options.openStateDuration) || options.openStateDuration < 0) {
      throw new TypeError('openStateDuration must be a finite number greater than or equal to 0');
    }
  }
}
