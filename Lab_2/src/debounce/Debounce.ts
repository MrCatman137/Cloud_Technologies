import type { DebounceOptions } from '../shared/types.js';

export type DebouncedFunction<TArgs extends unknown[], TResult> = ((...args: TArgs) => TResult | undefined) & {
  dispose: () => void;
};

export class Debounce<TArgs extends unknown[], TResult> {
  private readonly fn: (...args: TArgs) => TResult;
  private readonly delayMs: number;
  private readonly leading: boolean;
  private readonly trailing: boolean;
  private readonly onSuppressed?: () => void;

  private timerId: ReturnType<typeof setTimeout> | null = null;
  private lastArgs: TArgs | null = null;
  private lastContext: unknown = null;
  private disposed = false;
  private leadingExecuted = false;
  private trailingPending = false;

  constructor(fn: (...args: TArgs) => TResult, options: DebounceOptions) {
    if (typeof fn !== 'function') {
      throw new TypeError('Debounce requires a function');
    }

    if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
      throw new TypeError('delayMs must be a non-negative number');
    }

    this.fn = fn;
    this.delayMs = options.delayMs;
    this.leading = options.leading ?? false;
    this.trailing = options.trailing ?? true;
    this.onSuppressed = options.onSuppressed;
  }

  public wrap(): DebouncedFunction<TArgs, TResult> {
    const debounced = ((...args: TArgs): TResult | undefined => {
      if (this.disposed) {
        return undefined;
      }

      const currentArgs = args;
      this.lastArgs = args;
      this.lastContext = this;

      if (this.leading && !this.trailing) {
        if (!this.leadingExecuted) {
          this.leadingExecuted = true;
          this.timerId = setTimeout(() => {
            this.leadingExecuted = false;
            this.timerId = null;
            this.lastArgs = null;
          }, this.delayMs);
          return this.fn.apply(this.lastContext, args);
        }

        this.onSuppressed?.();
        return undefined;
      }

      if (!this.leading && this.trailing) {
        if (this.timerId === null) {
          this.timerId = setTimeout(() => {
            if (this.lastArgs !== null) {
              const pendingArgs = this.lastArgs;
              this.lastArgs = null;
              this.fn.apply(this.lastContext, pendingArgs);
            }
            this.timerId = null;
          }, this.delayMs);
        } else {
          this.onSuppressed?.();
        }
        return undefined;
      }

      if (this.leading && this.trailing) {
        if (!this.leadingExecuted) {
          this.leadingExecuted = true;
          this.trailingPending = false;
          this.timerId = setTimeout(() => {
            const shouldRunTrailing = this.trailingPending && this.lastArgs !== null;
            this.leadingExecuted = false;
            this.trailingPending = false;
            this.timerId = null;

            if (shouldRunTrailing) {
              const pendingArgs = this.lastArgs ?? currentArgs;
              this.lastArgs = null;
              this.fn.apply(this.lastContext, pendingArgs!);
            }
          }, this.delayMs);

          return this.fn.apply(this.lastContext, args);
        }

        this.trailingPending = true;
        this.onSuppressed?.();
        return undefined;
      }

      this.onSuppressed?.();
      return undefined;
    }) as DebouncedFunction<TArgs, TResult>;

    debounced.dispose = () => {
      this.dispose();
    };

    return debounced;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.lastArgs = null;
    this.lastContext = null;
    this.leadingExecuted = false;
    this.trailingPending = false;
  }
}

export function debounce<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  options: DebounceOptions,
): DebouncedFunction<TArgs, TResult> {
  return new Debounce(fn, options).wrap();
}
