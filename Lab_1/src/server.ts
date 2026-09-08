import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  CircuitBreaker,
  CircuitBreakerHalfOpenExhaustedError,
  CircuitBreakerOpenError,
  TimeoutError,
  type CircuitBreakerOptions,
} from './CircuitBreaker.js';

const port = Number(process.env.PORT ?? 3000);
const breakerOptions: CircuitBreakerOptions = {
  failureThreshold: Number(process.env.FAILURE_THRESHOLD ?? 3),
  halfOpenMaxCalls: Number(process.env.HALF_OPEN_MAX_CALLS ?? 2),
  openStateDuration: Number(process.env.OPEN_STATE_DURATION ?? 5000),
  timeoutPerCall: Number(process.env.TIMEOUT_PER_CALL ?? 1000),
};

let breaker = new CircuitBreaker(breakerOptions);
let restartCount = 0;

type CallMode = 'success' | 'failure' | 'timeout';

interface CallRequest {
  mode?: CallMode;
  value?: string;
  delayMs?: number;
}

interface ApiResponse {
  ok: boolean;
  state: ReturnType<CircuitBreaker['state']>;
  result?: string;
  error?: string;
  errorName?: string;
  restartCount: number;
}

function sendJson(response: ServerResponse, statusCode: number, body: ApiResponse): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<CallRequest> {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }

  if (body.trim() === '') {
    return {};
  }

  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Request body must be a JSON object');
  }

  const value = parsed as Record<string, unknown>;
  const mode = value.mode;
  if (mode !== undefined && mode !== 'success' && mode !== 'failure' && mode !== 'timeout') {
    throw new TypeError('mode must be success, failure, or timeout');
  }

  const delayMs = value.delayMs;
  if (delayMs !== undefined && (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0)) {
    throw new TypeError('delayMs must be a finite number greater than or equal to 0');
  }

  return {
    mode,
    value: typeof value.value === 'string' ? value.value : undefined,
    delayMs,
  };
}

function operationFor(request: CallRequest): () => Promise<string> {
  const mode = request.mode ?? 'success';
  const delayMs = request.delayMs ?? 0;
  const value = request.value ?? 'success';

  return async () => {
    if (mode === 'timeout') {
      await new Promise<never>(() => undefined);
    }

    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }

    if (mode === 'failure') {
      throw new Error(value === 'success' ? 'simulated service failure' : value);
    }

    return value;
  };
}

async function handleCall(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const callRequest = await readJson(request);
    const result = await breaker.call(operationFor(callRequest));
    sendJson(response, 200, {
      ok: true,
      state: breaker.state(),
      result,
      restartCount,
    });
  } catch (error) {
    const statusCode = error instanceof CircuitBreakerOpenError
      ? 503
      : error instanceof CircuitBreakerHalfOpenExhaustedError
        ? 429
        : error instanceof TimeoutError
          ? 504
          : 502;

    sendJson(response, statusCode, {
      ok: false,
      state: breaker.state(),
      error: error instanceof Error ? error.message : 'Unknown error',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      restartCount,
    });
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        ok: true,
        state: breaker.state(),
        restartCount,
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/state') {
      sendJson(response, 200, {
        ok: true,
        state: breaker.state(),
        restartCount,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/call') {
      await handleCall(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/restart') {
      breaker = new CircuitBreaker(breakerOptions);
      restartCount++;
      sendJson(response, 200, {
        ok: true,
        state: breaker.state(),
        result: 'Circuit breaker restarted',
        restartCount,
      });
      return;
    }

    sendJson(response, 404, {
      ok: false,
      state: breaker.state(),
      error: 'Not found',
      errorName: 'NotFoundError',
      restartCount,
    });
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      state: breaker.state(),
      error: error instanceof Error ? error.message : 'Invalid request',
      errorName: error instanceof Error ? error.name : 'RequestError',
      restartCount,
    });
  }
});

server.listen(port, () => {
  console.log(`Circuit Breaker server listening on http://localhost:${port}`);
  console.log(`Options: ${JSON.stringify(breakerOptions)}`);
});
