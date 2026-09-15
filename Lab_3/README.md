# Retry Pattern Lab

A TypeScript implementation of the Retry pattern with constant, exponential, and exponential-jitter backoff strategies. The project includes a native Node.js demo server that simulates unreliable microservices and a deterministic Vitest suite using fake timers.

## Theory

A retry temporarily repeats an operation after a transient failure. Cloud services commonly experience transient faults caused by congestion, temporary network failures, throttling, deployments, or brief dependency outages. Retrying can improve availability when the operation is safe to repeat and the fault is expected to clear.

Retries must be bounded. `maxAttempts` prevents infinite loops, `maxDelayMs` limits latency, and backoff spaces requests to avoid amplifying load during an incident. Exponential backoff grows the wait between attempts. Jitter adds controlled randomness so many clients do not retry simultaneously. Permanent errors such as an invalid request should be classified as non-retryable and returned immediately.

`Retryer` supports `retryOn` as an array of HTTP status codes, an array of error constructors, or a predicate receiving the unknown thrown value. When it is omitted, all errors are considered retryable until attempts are exhausted.

## Setup

Requirements: Node.js 18+ and npm.

```bash
cd Lab_3
npm install
```

## Commands

Run the automated tests:

```bash
npm test
```

Run the TypeScript type checker:

```bash
npm run typecheck
```

Start the demo server in development mode:

```bash
npm run dev
```

The server listens at `http://localhost:3000`.

## cURL Scenarios

Keep `npm run dev` running in one terminal and execute these commands in another.

### 1. Eventual success after transient 503 errors

The target fails twice, waits 500ms then 1000ms with exponential backoff, and succeeds on attempt three.

```bash
curl "http://localhost:3000/demo/run?strategy=exponential&maxAttempts=4&target=flaky&failCount=2&status=503&baseDelayMs=500"
```

The response includes `totalAttempts: 3`, `delays: [500, 1000]`, and the final 200 response.

### 2. Exhausted attempts

The target fails more times than the retry budget, so the final 503 error is returned after three attempts.

```bash
curl "http://localhost:3000/demo/run?strategy=exponential&maxAttempts=3&target=flaky&failCount=10&status=503&baseDelayMs=100"
```

### 3. Immediate stop on a non-retryable 400

The fatal target returns 400. The demo retries only 5xx errors, so no delay is scheduled and the response reports one attempt.

```bash
curl "http://localhost:3000/demo/run?strategy=exponential&maxAttempts=4&target=fatal&baseDelayMs=500"
```

### 4. Compare constant and exponential jitter

Constant backoff uses the same delay for every retry:

```bash
curl "http://localhost:3000/demo/run?strategy=constant&maxAttempts=4&target=flaky&failCount=3&status=503&baseDelayMs=250"
```

Exponential jitter grows the base delay and adds up to 100ms of random jitter:

```bash
curl "http://localhost:3000/demo/run?strategy=exponentialJitter&maxAttempts=4&target=flaky&failCount=3&status=503&baseDelayMs=250&maxJitterMs=100"
```

Compare the `delays` arrays in the JSON responses and the corresponding server log lines.

## API Example

```ts
const retryer = new Retryer({
  maxAttempts: 4,
  strategy: 'exponential',
  baseDelayMs: 200,
  multiplier: 2,
  maxDelayMs: 5_000,
  retryOn: [503, 504],
});

const value = await retryer.execute(() => callRemoteService());
```
