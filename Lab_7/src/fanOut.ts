export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type TaskProcessor<T, R> = (task: T) => Promise<R>;

export interface FanOutPool<T, R> {
  submit(task: T): void;
  results(): AsyncIterable<R | Result<R, unknown>>;
  close(): void;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function fanOut<T, R>(
  process: TaskProcessor<T, R>,
  workers: number,
): FanOutPool<T, R> {
  if (!Number.isInteger(workers) || workers <= 0) {
    throw new RangeError('workers must be a positive integer');
  }

  const queue: T[] = [];
  const results: Array<R | Result<R, unknown>> = [];
  let closed = false;
  let activeWorkers = workers;

  const workerLoop = async (): Promise<void> => {
    while (true) {
      if (queue.length === 0) {
        if (closed) {
          break;
        }
        await wait(10);
        continue;
      }

      const task = queue.shift();
      if (task === undefined) {
        continue;
      }

      try {
        const value = await process(task);
        results.push(value);
      } catch (error) {
        results.push({ ok: false, error } as Result<R, unknown>);
      }
    }

    activeWorkers -= 1;
  };

  for (let index = 0; index < workers; index += 1) {
    void workerLoop();
  }

  return {
    submit(task: T): void {
      if (closed) {
        throw new Error('fanOut is closed; no new tasks can be submitted');
      }
      queue.push(task);
    },

    results(): AsyncIterable<R | Result<R, unknown>> {
      return {
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (results.length > 0) {
              yield results.shift() as R | Result<R, unknown>;
              continue;
            }

            if (closed && activeWorkers === 0 && queue.length === 0) {
              return;
            }

            await wait(10);
          }
        },
      };
    },

    close(): void {
      closed = true;
    },
  };
}
