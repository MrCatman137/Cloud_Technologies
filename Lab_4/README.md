# Throttling Pattern Lab

A TypeScript throttling utility supporting window-based limits, token buckets, leading and trailing execution, drop or FIFO queue overflow handling, cancellation, and flushing.

## Requirements

- Node.js 18+
- `npx tsx` or `ts-node` for running TypeScript directly

The throttler itself uses only standard TypeScript and Node.js timer APIs. It does not require a test framework or a runtime library.

## Run the demonstration

From the workspace root:

```bash
npx --yes tsx Lab_4/demo.ts
```

Alternatively, from the `Lab_4` directory:

```bash
npx --yes tsx demo.ts
```

The demo prints timestamps in the form `[+XXXms]` and covers four scenarios:

1. A window limit of 3 calls per second with drop overflow. Ten rapid calls produce exactly three executions and seven drops.
2. Leading-only and trailing-only execution.
3. A FIFO queue with a limit of two calls per second. All six calls execute in order, in rate-limited batches.
4. Cancellation of a pending trailing call. The cancelled callback does not run.

The exact millisecond values vary slightly by machine. Check the counts, ordering, and absence of the cancelled message rather than exact timestamps.

## Quick command checklist

Run these commands from the workspace root. Keep the server command running in Terminal 1 and run the curl commands in Terminal 2.

Terminal 1:

```bash
npx --yes tsx Lab_4/server.ts
```

Terminal 2:

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/throttle/window?value=one"
curl "http://localhost:3000/throttle/queue?value=one"
curl "http://localhost:3000/throttle/token-bucket?value=one"
```

For a rapid window-limit test in Git Bash:

```bash
for value in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null -w "%{http_code} " "http://localhost:3000/throttle/window?value=$value"
done
printf "\n"
```

Expected status codes are `200 200 200 429 429 429 429 429 429 429`. The server terminal should show three executed window calls.

For a FIFO queue test in Git Bash:

```bash
for value in 1 2 3 4 5 6; do
  curl -s "http://localhost:3000/throttle/queue?value=$value"
  printf "\n"
done
```

All six requests return `202`. Watch Terminal 1: values `1` through `6` execute in order, two at a time per one-second window. Stop the server with `Ctrl+C` when finished.

## Run the HTTP server

Start the server in one terminal from the workspace root:

```bash
npx --yes tsx Lab_4/server.ts
```

It listens on `http://localhost:3000`. Use a second terminal for the requests below. The server terminal prints the callbacks that actually execute.

Check that the server is running:

```bash
curl http://localhost:3000/health
```

### Window limit with dropped requests

The first three requests return HTTP 200. The remaining requests in the same one-second window return HTTP 429.

```bash
for value in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" "http://localhost:3000/throttle/window?value=$value"
done
```

The server terminal should print only three `[window-drop] executed` lines.

### FIFO queue

All six requests return HTTP 202 immediately. The server terminal prints values `1` through `6` in FIFO order, with at most two executions per one-second window.

```bash
for value in 1 2 3 4 5 6; do curl -s "http://localhost:3000/throttle/queue?value=$value"; echo; done
```

### Token bucket

The first three requests consume the bucket capacity. Additional rapid requests return HTTP 429 until tokens refill.

```bash
for value in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code} %{url_effective}\n" "http://localhost:3000/throttle/token-bucket?value=$value"
done
```

Stop the server with `Ctrl+C`.

## Type-check without tests

Use the TypeScript compiler in strict mode. If TypeScript is installed in one of the lab packages, run this from the workspace root:

```bash
cd Lab_3
npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node ../Lab_4/throttle.ts ../Lab_4/demo.ts ../Lab_4/server.ts
```

A successful check exits without output.

## Manual checks

Create a temporary TypeScript file beside the demo, or add one of these snippets to `demo.ts` while experimenting. Run it with `npx --yes tsx Lab_4/your-file.ts`.

### Window limit and drop

```ts
import { throttle } from './throttle.js';

let count = 0;
const limited = throttle(
  () => { count += 1; console.log('executed', count); },
  { limit: 2, intervalMs: 1_000 },
  { trailing: false, overflowStrategy: 'drop' },
);

for (let index = 0; index < 5; index += 1) limited();
setTimeout(() => console.log('expected count: 2, actual:', count), 50);
```

### Leading and trailing behavior

```ts
import { throttle } from './throttle.js';

const leading = throttle(
  (value: string) => console.log('leading:', value),
  { limit: 1, intervalMs: 500 },
  { leading: true, trailing: false },
);
leading('runs now');
leading('drops');

const trailing = throttle(
  (value: string) => console.log('trailing:', value),
  { limit: 1, intervalMs: 500 },
  { leading: false, trailing: true },
);
trailing('replaced');
trailing('latest value runs later');
```

### FIFO queue

```ts
import { throttle } from './throttle.js';

const queued = throttle(
  (value: number) => console.log('FIFO:', value),
  { limit: 2, intervalMs: 1_000 },
  { overflowStrategy: 'queue' },
);

for (let value = 1; value <= 6; value += 1) queued(value);
// Expected order: FIFO: 1, FIFO: 2, ... FIFO: 6.
```

### Token bucket

`refillRate` is the number of tokens added every `refillIntervalMs`. The interval defaults to 1000ms.

```ts
import { throttle } from './throttle.js';

const bucket = throttle(
  (value: number) => console.log('token accepted:', value),
  { capacity: 3, refillRate: 1, refillIntervalMs: 1_000 },
  { trailing: false, overflowStrategy: 'drop' },
);

for (let value = 1; value <= 5; value += 1) bucket(value);
// The first three calls use the initial tokens; the rest are dropped.
```

### Cancel and flush

```ts
import { throttle } from './throttle.js';

const controlled = throttle(
  (value: string) => console.log('ran:', value),
  { limit: 1, intervalMs: 1_000 },
  { leading: false, trailing: true },
);

controlled('pending');
controlled.cancel();
// The pending callback will never run.

controlled.flush();
// flush() runs pending work immediately when the rate limit allows it.
```

## API summary

```ts
throttle(fn, rateLimit, options?)
```

Supported rate limits:

```ts
{ limit: number; intervalMs: number }
{ capacity: number; refillRate: number; refillIntervalMs?: number }
```

Options default to `leading: true`, `trailing: true`, and `overflowStrategy: 'drop'`.

The returned function preserves the original argument and return types and exposes:

- `cancel()` clears pending queued or trailing calls and disables future calls.
- `flush()` attempts to execute pending work while preserving the configured rate limit.
