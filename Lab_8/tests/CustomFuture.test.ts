import {
  CustomFuture,
  FutureState,
  TimeoutError,
  submit,
} from "../src/CustomFuture";

function delayedFuture<T>(value: T, delayMs: number): CustomFuture<T> {
  const future = CustomFuture.create<T>();

  setTimeout(() => {
    future.resolve(value);
  }, delayMs);

  return future;
}

describe("CustomFuture", () => {
  test("successfully resolves and get() returns the value", async () => {
    const future = submit(() => 42);

    await expect(future.get()).resolves.toBe(42);
    expect(future.getState()).toBe(FutureState.FULFILLED);
  });

  test("supports then() chaining", async () => {
    const result = submit(() => 10)
      .then((value) => value * 2)
      .then((value) => `result=${value}`);

    await expect(result.get()).resolves.toBe("result=20");
  });

  test("propagates errors through catch()", async () => {
    const future = submit<number>(() => {
      throw new Error("boom");
    });

    const recovered = future.catch((err) => {
      expect(err).toBeInstanceOf(Error);
      return 99;
    });

    await expect(recovered.get()).resolves.toBe(99);
  });

  test("get() rejects when the Future is rejected", async () => {
    const future = submit(() => {
      throw new Error("failure");
    });

    await expect(future.get()).rejects.toThrow("failure");
    expect(future.getState()).toBe(FutureState.REJECTED);
  });

  test("state can transition only once: resolve then reject", async () => {
    const future = CustomFuture.create<number>();

    future.resolve(1);
    future.reject(new Error("second transition"));

    await expect(future.get()).resolves.toBe(1);
    expect(future.getState()).toBe(FutureState.FULFILLED);
  });

  test("state can transition only once: reject then resolve", async () => {
    const future = CustomFuture.create<number>();

    future.reject(new Error("first transition"));
    future.resolve(2);

    await expect(future.get()).rejects.toThrow("first transition");
    expect(future.getState()).toBe(FutureState.REJECTED);
  });

  test("all() waits for every Future and preserves input order", async () => {
    const start = Date.now();

    const futures = [
      delayedFuture("first", 80),
      delayedFuture("second", 150),
      delayedFuture("third", 100),
    ];

    await expect(CustomFuture.all(futures).get()).resolves.toEqual([
      "first",
      "second",
      "third",
    ]);

    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  test("all() fails fast when one Future rejects", async () => {
    const first = delayedFuture("ok", 150);
    const second = CustomFuture.create<string>();
    const third = delayedFuture("also ok", 200);

    setTimeout(() => {
      second.reject(new Error("all failed"));
    }, 40);

    const start = Date.now();

    await expect(CustomFuture.all([first, second, third]).get())
      .rejects.toThrow("all failed");

    expect(Date.now() - start).toBeLessThan(140);
  });

  test("race() resolves with the fastest fulfillment", async () => {
    const fast = delayedFuture("fast", 30);
    const slow = delayedFuture("slow", 100);

    await expect(CustomFuture.race([fast, slow]).get())
      .resolves.toBe("fast");
  });

  test("race() rejects when the fastest task rejects", async () => {
    const fastFailure = CustomFuture.create<string>();
    const slowSuccess = delayedFuture("slow", 100);

    setTimeout(() => {
      fastFailure.reject(new Error("fast failure"));
    }, 20);

    await expect(CustomFuture.race([fastFailure, slowSuccess]).get())
      .rejects.toThrow("fast failure");
  });

  test("get(timeoutMs) rejects with TimeoutError", async () => {
    const future = delayedFuture("too late", 100);

    await expect(future.get(20)).rejects.toBeInstanceOf(TimeoutError);
    await expect(future.get(20)).rejects.toThrow("timed out after 20 ms");
  });

  test("get() can still observe a Future after a previous get() timed out", async () => {
    const future = delayedFuture("eventual value", 50);

    await expect(future.get(10)).rejects.toBeInstanceOf(TimeoutError);
    await expect(future.get()).resolves.toBe("eventual value");
  });

  test("then() can adopt another CustomFuture", async () => {
    const result = submit(() => 5).then((value) =>
      delayedFuture(value + 10, 20),
    );

    await expect(result.get()).resolves.toBe(15);
  });

  test("catch() can adopt another CustomFuture", async () => {
    const result = submit<number>(() => {
      throw new Error("bad");
    }).catch(() => delayedFuture("recovered", 20));

    await expect(result.get()).resolves.toBe("recovered");
  });
});
