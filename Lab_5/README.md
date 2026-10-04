# Lab 5: Time-out Pattern

This laboratory demonstrates the time-out design pattern for asynchronous TypeScript operations.

`withTimeout` races an operation against a timer. If the timer wins, it rejects with `TimeoutError`, aborts the supplied `AbortSignal`, and clears the timer. The `withRetry` helper can repeat a timed-out operation a bounded number of times.

## Manual HTTP Demo With curl

Install dependencies once from the repository root:

```bash
cd Lab_5
npm install
```

Start the demonstration server in one terminal:

```bash
npm run server
```

Use a second terminal for the requests below. The server listens on `http://localhost:3000`.

### Case 1: Fast task succeeds

```bash
curl "http://localhost:3000/timeout/fast?taskMs=25&timeoutMs=200"
```

Expected response: HTTP `200` with `"ok":true`.

### Case 2: Slow task times out and is cancelled

```bash
curl -i "http://localhost:3000/timeout/slow?taskMs=500&timeoutMs=50"
```

Expected response: HTTP `504` with `"timedOut":true` and `"cancelled":true`. The task's timer is cancelled through `AbortSignal`.

### Case 3: Timed-out task is retried a bounded number of times

```bash
curl -i "http://localhost:3000/retry?taskMs=500&timeoutMs=50&retries=2"
```

Expected response: HTTP `504` with `"attempts":3`. Each attempt has its own 50 ms timeout, so the request does not wait indefinitely.

### Health check

```bash
curl "http://localhost:3000/health"
```

## Automated Tests

The curl demo is optional; the unit tests can be run separately:

```bash
npm test
npm run typecheck
```

The direct, non-HTTP demonstration is also available:

```bash
npm run manual
```