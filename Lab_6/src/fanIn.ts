export type Result<T, E = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export type Stream<T> = AsyncIterable<T>;

type PendingEntry<T> = Promise<{
  index: number;
  result: IteratorResult<T, unknown>;
}>;

async function readNext<T>(
  iterator: AsyncIterator<T>,
  index: number,
): Promise<{ index: number; result: IteratorResult<T, unknown> }> {
  try {
    const result = await iterator.next();
    return { index, result };
  } catch (error) {
    return {
      index,
      result: {
        done: false,
        value: { ok: false, error } as T,
      },
    };
  }
}

export async function* fanIn<T>(inputs: Stream<T>[]): AsyncGenerator<T, void, unknown> {
  if (inputs.length === 0) {
    return;
  }

  const iterators = inputs.map((input) => input[Symbol.asyncIterator]());
  const pending = new Map<number, PendingEntry<T>>();

  try {
    for (let index = 0; index < iterators.length; index += 1) {
      pending.set(index, readNext(iterators[index], index));
    }

    while (pending.size > 0) {
      const nextEntry = await Promise.race(Array.from(pending.values()));
      pending.delete(nextEntry.index);

      if (nextEntry.result.done) {
        continue;
      }

      yield nextEntry.result.value;

      const nextPromise = readNext(iterators[nextEntry.index], nextEntry.index);
      pending.set(nextEntry.index, nextPromise);
    }
  } finally {
    await Promise.allSettled(
      iterators.map((iterator) => {
        if (typeof iterator.return === 'function') {
          return iterator.return();
        }
        return Promise.resolve();
      }),
    );
  }
}
