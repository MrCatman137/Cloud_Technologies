export enum FutureState {
  PENDING = "PENDING",
  FULFILLED = "FULFILLED",
  REJECTED = "REJECTED",
}

export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Future timed out after ${timeoutMs} ms`);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type SuccessHandler<T, U> = (value: T) => U | CustomFuture<U>;
type ErrorHandler<U> = (err: any) => U | CustomFuture<U>;
type Listener = () => void;

/**
 * A small Future implementation intended for education.
 *
 * Native Promise is deliberately NOT used for:
 * - state storage
 * - callback registration
 * - chaining
 * - resolution/rejection
 * - all/race
 *
 * The only native Promise boundary is get(), because its required API
 * returns Promise<T>. submit() also accepts a Promise<T> because the
 * assignment explicitly allows task functions to return one.
 */
export class CustomFuture<T> {
  private state: FutureState = FutureState.PENDING;
  private value?: T;
  private error: any;
  private listeners: Listener[] = [];

  private constructor() {}

  public static create<T>(): CustomFuture<T> {
    return new CustomFuture<T>();
  }

  public getState(): FutureState {
    return this.state;
  }

  /**
   * Internal one-shot fulfillment operation.
   * A second transition is ignored, preserving the immutable lifecycle.
   */
  public resolve(value: T): void {
    if (this.state !== FutureState.PENDING) {
      return;
    }

    this.state = FutureState.FULFILLED;
    this.value = value;
    this.notify();
  }

  /**
   * Internal one-shot rejection operation.
   * A second transition is ignored, preserving the immutable lifecycle.
   */
  public reject(err: any): void {
    if (this.state !== FutureState.PENDING) {
      return;
    }

    this.state = FutureState.REJECTED;
    this.error = err;
    this.notify();
  }

  public then<U>(
    onSuccess: SuccessHandler<T, U>,
  ): CustomFuture<U> {
    const next = CustomFuture.create<U>();

    this.addListener(() => {
      if (this.state !== FutureState.FULFILLED) {
        next.reject(this.error);
        return;
      }

      try {
        const result = onSuccess(this.value as T);
        CustomFuture.adoptResult(next, result);
      } catch (err) {
        next.reject(err);
      }
    });

    return next;
  }

  public catch<U = never>(
    onError: ErrorHandler<U>,
  ): CustomFuture<T | U> {
    const next = CustomFuture.create<T | U>();

    this.addListener(() => {
      if (this.state !== FutureState.REJECTED) {
        return;
      }

      try {
        const result = onError(this.error);
        CustomFuture.adoptResult(next, result);
      } catch (err) {
        next.reject(err);
      }
    });

    return next;
  }

  /**
   * Required public API: get() returns a native Promise only as an adapter
   * around this custom Future.
   *
   * A timeout rejects the adapter Promise with TimeoutError, but it does not
   * cancel the underlying Future/task.
   */
  public get(timeoutMs?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        fn();
      };

      this.addListener(() => {
        if (this.state === FutureState.FULFILLED) {
          finish(() => resolve(this.value as T));
        } else if (this.state === FutureState.REJECTED) {
          finish(() => reject(this.error));
        }
      });

      if (timeoutMs !== undefined) {
        if (timeoutMs < 0 || !Number.isFinite(timeoutMs)) {
          finish(() => reject(new RangeError("timeoutMs must be a finite non-negative number")));
          return;
        }

        if (this.state === FutureState.PENDING) {
          timer = setTimeout(() => {
            finish(() => reject(new TimeoutError(timeoutMs)));
          }, timeoutMs);
        }
      }
    });
  }

  public static all<T>(
    futures: CustomFuture<T>[],
  ): CustomFuture<T[]> {
    const combined = CustomFuture.create<T[]>();

    if (futures.length === 0) {
      combined.resolve([]);
      return combined;
    }

    const results = new Array<T>(futures.length);
    let remaining = futures.length;
    let finished = false;

    futures.forEach((future, index) => {
      future.then((value) => {
        if (finished) {
          return value;
        }

        results[index] = value;
        remaining -= 1;

        if (remaining === 0) {
          finished = true;
          combined.resolve(results);
        }

        return value;
      }).catch((err) => {
        if (!finished) {
          finished = true;
          combined.reject(err);
        }
        return undefined as never;
      });
    });

    return combined;
  }

  public static race<T>(
    futures: CustomFuture<T>[],
  ): CustomFuture<T> {
    const combined = CustomFuture.create<T>();

    if (futures.length === 0) {
      return combined;
    }

    let finished = false;

    futures.forEach((future) => {
      future.then((value) => {
        if (!finished) {
          finished = true;
          combined.resolve(value);
        }
        return value;
      }).catch((err) => {
        if (!finished) {
          finished = true;
          combined.reject(err);
        }
        return undefined as never;
      });
    });

    return combined;
  }

  private addListener(listener: Listener): void {
    if (this.state === FutureState.PENDING) {
      this.listeners.push(listener);
      return;
    }

    // Defer callbacks so a handler attached after settlement still behaves
    // asynchronously, without using native Promise scheduling.
    setTimeout(listener, 0);
  }

  private notify(): void {
    const listeners = this.listeners;
    this.listeners = [];

    for (const listener of listeners) {
      setTimeout(listener, 0);
    }
  }

  private static adoptResult<A, B>(
    target: CustomFuture<B>,
    result: B | CustomFuture<B>,
  ): void {
    if (result instanceof CustomFuture) {
      result.then((value) => {
        target.resolve(value);
        return value;
      }).catch((err) => {
        target.reject(err);
        return undefined as never;
      });
      return;
    }

    target.resolve(result as B);
  }
}

/**
 * Runs a task asynchronously and connects its result to a CustomFuture.
 *
 * The Promise<T> return type is accepted at the boundary because the
 * assignment explicitly permits task functions to return either T or Promise<T>.
 * The CustomFuture itself never stores or chains native Promises.
 */
export function submit<T>(
  fn: () => T | Promise<T>,
): CustomFuture<T> {
  const future = CustomFuture.create<T>();

  setTimeout(() => {
    try {
      const result = fn();

      if (result instanceof Promise) {
        result.then(
          (value) => future.resolve(value),
          (err) => future.reject(err),
        );
      } else {
        future.resolve(result);
      }
    } catch (err) {
      future.reject(err);
    }
  }, 0);

  return future;
}
