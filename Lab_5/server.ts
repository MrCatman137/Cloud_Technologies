import { createServer, type ServerResponse } from 'node:http';
import { withRetry } from './src/retry.js';
import { TimeoutError, withTimeout } from './src/timeout.js';

const port = Number(process.env.PORT ?? 3000);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function numberParam(url: URL, name: string, fallback: number): number {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) ? value : fallback;
}

function cancellableTask(durationMs: number, signal: AbortSignal | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(`task completed in ${durationMs} ms`), durationMs);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('task cancelled by AbortSignal'));
    }, { once: true });
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);

  if (request.method !== 'GET') {
    json(response, 405, { error: 'Only GET is supported' });
    return;
  }

  if (url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/timeout/fast') {
    const timeoutMs = numberParam(url, 'timeoutMs', 200);
    const taskMs = numberParam(url, 'taskMs', 25);
    try {
      const result = await withTimeout((signal) => cancellableTask(taskMs, signal), timeoutMs);
      json(response, 200, { ok: true, result, timeoutMs, taskMs });
    } catch (error) {
      json(response, error instanceof TimeoutError ? 504 : 500, { ok: false, error: String(error) });
    }
    return;
  }

  if (url.pathname === '/timeout/slow') {
    const timeoutMs = numberParam(url, 'timeoutMs', 50);
    const taskMs = numberParam(url, 'taskMs', 500);
    try {
      const result = await withTimeout((signal) => cancellableTask(taskMs, signal), timeoutMs);
      json(response, 200, { ok: true, result, timeoutMs, taskMs });
    } catch (error) {
      json(response, error instanceof TimeoutError ? 504 : 500, {
        ok: false,
        timedOut: error instanceof TimeoutError,
        cancelled: true,
        error: String(error),
        timeoutMs,
        taskMs,
      });
    }
    return;
  }

  if (url.pathname === '/retry') {
    const timeoutMs = numberParam(url, 'timeoutMs', 50);
    const taskMs = numberParam(url, 'taskMs', 500);
    const retries = numberParam(url, 'retries', 2);
    let attempts = 0;
    try {
      const result = await withRetry(
        (attempt) => {
          attempts = attempt;
          return withTimeout((signal) => cancellableTask(taskMs, signal), timeoutMs);
        },
        { retries },
      );
      json(response, 200, { ok: true, result, attempts, timeoutMs, taskMs, retries });
    } catch (error) {
      json(response, 504, {
        ok: false,
        timedOut: error instanceof TimeoutError,
        attempts,
        timeoutMs,
        taskMs,
        retries,
        error: String(error),
      });
    }
    return;
  }

  json(response, 404, {
    error: 'Route not found',
    routes: ['/health', '/timeout/fast', '/timeout/slow', '/retry'],
  });
});

server.listen(port, () => {
  console.log(`Timeout demo server listening at http://localhost:${port}`);
});