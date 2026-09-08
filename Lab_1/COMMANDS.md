# Circuit Breaker Lab - Git Bash

Open Git Bash and run:

```bash
cd /d/4_1/Cloud_Technologies/Lab_1
```

All commands below are for Git Bash.

## 1. Install and test

```bash
npm install
npm test
npm run typecheck
```

## 2. Start the server

Terminal 1:

```bash
npm start
```

The server uses `http://localhost:3000`.

Open Terminal 2 for the requests below.

## 3. Try the breaker

Check the initial state:

```bash
curl -s http://localhost:3000/state
```

Successful request:

```bash
curl -s -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"success","value":"hello"}'
```

Send three failures. The third one opens the breaker:

```bash
curl -s -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"failure","value":"service unavailable"}'

```

The next request fails fast with `CircuitBreakerOpenError`:

```bash
curl -i -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"success"}'
```

Wait for HALF_OPEN, then send two requests in parallel:

```bash
sleep 5 && curl -s http://localhost:3000/state && curl -s -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"success","value":"probe-1"}' & curl -s -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"success","value":"probe-2"}' & wait

or

curl -s -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"timeout"}' & curl -s -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"timeout"}' & sleep 0.1; curl -i -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"success","value":"probe-3"}'; wait
```

Check that the successful probes closed the breaker:

```bash
curl -s http://localhost:3000/state
```

Test a timeout:

```bash
curl -i -X POST http://localhost:3000/call -H 'content-type: application/json' -d '{"mode":"timeout"}'
```

Reset the breaker without stopping the server:

```bash
curl -s -X POST http://localhost:3000/restart
```

Run only the Circuit Breaker tests:

```bash
npx vitest run tests/CircuitBreaker.test.ts
```
