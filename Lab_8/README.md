# CustomFuture — TypeScript Future/Promise Pattern

Educational implementation of a Future/Promise-style abstraction built from scratch.

The core `CustomFuture<T>` does **not** use native JavaScript `Promise` for its lifecycle, callback storage, chaining, `all()`, or `race()` implementation.

The assignment explicitly requires:

- `get()` to return `Promise<T>`, so `get()` uses a native Promise as an adapter at the API boundary.
- `submit()` to accept `() => T | Promise<T>`, so a task is allowed to return a native Promise. The returned Promise is consumed only at that boundary; it is never stored as the Future's state.

## 1. Project structure

```text
custom-future-project/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── CustomFuture.ts
│   └── server.ts
└── tests/
    └── CustomFuture.test.ts
```

## 2. Design

### Lifecycle

Each `CustomFuture<T>` starts in:

```text
PENDING
```

It can make exactly one terminal transition:

```text
PENDING ──────> FULFILLED
       \
        └─────> REJECTED
```

There are no transitions out of `FULFILLED` or `REJECTED`.

The `resolve()` and `reject()` methods therefore begin with:

```ts
if (this.state !== FutureState.PENDING) {
  return;
}
```

This gives the Future a one-shot completion guarantee.

### Stored state

The class stores:

- `state`
- `value`
- `error`
- registered callback listeners

It does not store a native Promise.

### Callback scheduling

Callbacks are registered in an internal listener array.

When the Future settles, listeners are removed from the array and scheduled with:

```ts
setTimeout(listener, 0);
```

This keeps callback execution asynchronous without implementing the core with native Promise chaining.

## 3. `then()`

```ts
future.then<U>(
  (value: T) => U | CustomFuture<U>
): CustomFuture<U>
```

`then()` creates a new Future.

For example:

```ts
const result = submit(() => 10)
  .then(value => value * 2)
  .then(value => `result=${value}`);
```

The chain is:

```text
Future<number>
     │
     │ then()
     ▼
Future<number>
     │
     │ then()
     ▼
Future<string>
```

If a handler returns another `CustomFuture`, the next Future adopts that Future's result.

## 4. `catch()`

```ts
future.catch<U = never>(
  (err: any) => U | CustomFuture<U>
): CustomFuture<T | U>
```

A rejection invokes the error handler and creates a new Future containing either:

- the recovered value, or
- the result of another `CustomFuture`.

If the handler itself throws, the returned Future becomes rejected.

## 5. `get(timeoutMs?)`

The assignment requires:

```ts
get(timeoutMs?: number): Promise<T>
```

This is the only place where native `Promise` is deliberately used.

The native Promise acts as an adapter:

```text
CustomFuture
     │
     ├── FULFILLED ──> resolve(value)
     │
     └── REJECTED ───> reject(error)
```

With a timeout:

```text
PENDING
  │
  ├── Future finishes first ──> resolve(value)
  │
  └── timeout fires first ────> reject(TimeoutError)
```

The timeout does **not** cancel the underlying computation. It only stops waiting through that particular `get()` call.

Therefore this is valid:

```ts
const future = delayedFuture("eventual", 50);

await future.get(10); // TimeoutError

await future.get();   // "eventual"
```

## 6. `submit()`

```ts
submit<T>(fn: () => T | Promise<T>): CustomFuture<T>
```

The task starts asynchronously using `setTimeout(..., 0)`.

For a synchronous result:

```ts
submit(() => 21 * 2);
```

For an explicitly allowed native Promise result:

```ts
submit(() => fetchSomething());
```

The Future itself still stores only the final value/error and its own lifecycle state.

## 7. `CustomFuture.all()`

```ts
CustomFuture.all<T>(
  futures: CustomFuture<T>[]
): CustomFuture<T[]>
```

Properties:

1. Waits for every input Future.
2. Preserves input order.
3. Resolves only when every Future fulfills.
4. Rejects as soon as one Future rejects.
5. Empty input resolves immediately with `[]`.

For example:

```text
Future A ────────┐
Future B ────────┼──> all() ──> [A, B, C]
Future C ────────┘
```

If B rejects:

```text
Future A ────────────────> still running
Future B ──> REJECTED ──> all() REJECTED
Future C ────────────────> still running
```

`all()` does not cancel A or C because `CustomFuture` has no cancellation protocol.

## 8. `CustomFuture.race()`

```ts
CustomFuture.race<T>(
  futures: CustomFuture<T>[]
): CustomFuture<T>
```

The first Future to settle determines the result.

```text
Future A ─────── 100 ms ──────> winner
Future B ─────── 300 ms ──────────────>
```

If the first settled Future rejects, `race()` rejects.

An empty array remains pending because there is no task capable of settling the race.

# Setup

## 1. Install Node.js

Use a current LTS version of Node.js.

Verify:

```bash
node --version
npm --version
```

## 2. Enter the project

```bash
cd custom-future-project
```

## 3. Install dependencies

```bash
npm install
```

There are no runtime third-party dependencies. Jest, TypeScript and `tsx` are development tools.

# Build

Compile the TypeScript sources:

```bash
npm run build
```

The compiled JavaScript is written to:

```text
dist/
```

Run the compiled HTTP server:

```bash
npm start
```

Or run the TypeScript server directly:

```bash
npm run dev
```

The server listens on:

```text
http://localhost:3000
```

# Automated tests

Run all Jest tests:

```bash
npm test
```

The tests cover:

- successful execution
- value resolution
- `then()` chaining
- error propagation
- `catch()` recovery
- rejected `get()`
- single-transition guarantee
- `CustomFuture.all()`
- fail-fast `all()`
- `CustomFuture.race()`
- race rejection
- timeout handling
- Future adoption from `then()`
- Future adoption from `catch()`

For a watch mode:

```bash
npm run test:watch
```

# HTTP server demonstration

Start the server:

```bash
npm run dev
```

## `/compute`

The endpoint submits a computation and applies `then()`:

```bash
curl http://localhost:3000/compute
```

Expected response:

```json
{
  "endpoint": "/compute",
  "result": 43
}
```

Timing benchmark:

```bash
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/compute
```

## `/timeout`

This creates a task taking approximately 3 seconds and waits with:

```ts
future.get(1000)
```

The expected result is HTTP 504 after approximately one second:

```bash
curl -i http://localhost:3000/timeout
```

Or:

```bash
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/timeout
```

Expected response:

```json
{
  "endpoint": "/timeout",
  "error": "Future timed out after 1000 ms"
}
```

Important: the underlying 3-second task is not cancelled. Its worker can still finish after the HTTP request has already returned 504.

## `/race`

The endpoint starts:

- task 1: 1 second
- task 2: 3 seconds

and uses:

```ts
CustomFuture.race([fast, slow])
```

Run:

```bash
curl http://localhost:3000/race
```

Timing benchmark:

```bash
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/race
```

Expected response is approximately:

```json
{
  "endpoint": "/race",
  "winner": "fast task won",
  "elapsedMs": 1000
}
```

The exact measured value varies slightly because of operating-system scheduling and timer resolution.

## `/all`

The endpoint starts three tasks:

```text
task 1 = 1000 ms
task 2 = 2000 ms
task 3 = 1500 ms
```

They are submitted before waiting, so they execute concurrently.

Run:

```bash
curl http://localhost:3000/all
```

Timing benchmark:

```bash
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/all
```

Expected response is approximately:

```json
{
  "endpoint": "/all",
  "results": [
    "A",
    "B",
    "C"
  ],
  "elapsedMs": 2000,
  "note": "Tasks run concurrently; total time is approximately the slowest task."
}
```

The total is approximately 2 seconds rather than 4.5 seconds because the tasks overlap.

# Example server logs

A `/race` request can produce output similar to:

```text
[2026-09-26T16:10:01.001Z] [Task submitted] race-fast, delay=1000ms
[2026-09-26T16:10:01.002Z] [Task submitted] race-slow, delay=3000ms
[2026-09-26T16:10:02.004Z] [Worker finished] race-fast
[2026-09-26T16:10:02.005Z] [Worker finished] race outcome=fast task won, elapsed=1004ms
[2026-09-26T16:10:02.006Z] [Response sent] status=200
```

A `/timeout` request can produce:

```text
[2026-09-26T16:10:10.001Z] [Task submitted] timeout-task, delay=3000ms
[2026-09-26T16:10:11.003Z] [Response sent] status=504
[2026-09-26T16:10:13.003Z] [Worker finished] timeout-task
```

This demonstrates an important distinction:

```text
get(1000) timeout
       ≠
task cancellation
```

The timeout only limits how long the caller waits.

# Demonstrating the single-transition guarantee

This:

```ts
const future = CustomFuture.create<number>();

future.resolve(10);
future.resolve(20);
future.reject(new Error("too late"));
```

leaves the Future in:

```text
FULFILLED
value = 10
```

The second `resolve()` and subsequent `reject()` have no effect.

The reverse also works:

```ts
const future = CustomFuture.create<number>();

future.reject(new Error("first"));
future.resolve(10);
```

The Future remains:

```text
REJECTED
error = Error("first")
```

# Educational architecture

```text
                    ┌─────────────────────┐
                    │    CustomFuture<T>  │
                    ├─────────────────────┤
                    │ state               │
                    │ value               │
                    │ error               │
                    │ listeners[]         │
                    └──────────┬──────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
          resolve()          reject()          get()
             │                 │                 │
             ▼                 ▼                 ▼
         FULFILLED          REJECTED        Promise adapter
             │                 │
             └────────┬────────┘
                      │
                 then()/catch()
                      │
                      ▼
                new CustomFuture
```

`all()` and `race()` are implemented on top of the same `then()`/`catch()` mechanism rather than delegating to native `Promise.all()` or `Promise.race()`.

# Verification

A complete run should be:

```bash
npm install
npm test
npm run build
npm start
```

Then, from another terminal:

```bash
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/compute
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/timeout
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/race
curl -w "\nHTTP %{http_code}\nTotal: %{time_total}s\n" http://localhost:3000/all
```
