import { createServer, type ServerResponse } from 'node:http';
import { throttle } from './throttle.js';

const port = Number(process.env.PORT ?? 3000);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

const windowDrop = throttle(
  (value: string) => {
    console.log(`[window-drop] executed value=${value}`);
    return true;
  },
  { limit: 3, intervalMs: 1_000 },
  { trailing: false, overflowStrategy: 'drop' },
);

const queue = throttle(
  (value: string) => {
    console.log(`[queue] executed value=${value}`);
  },
  { limit: 2, intervalMs: 1_000 },
  { overflowStrategy: 'queue' },
);

const tokenBucket = throttle(
  (value: string) => {
    console.log(`[token-bucket] executed value=${value}`);
    return true;
  },
  { capacity: 3, refillRate: 1, refillIntervalMs: 1_000 },
  { trailing: false, overflowStrategy: 'drop' },
);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${port}`}`);
  const value = url.searchParams.get('value') ?? new Date().toISOString();

  if (request.method !== 'GET') {
    json(response, 405, { error: 'Only GET is supported' });
    return;
  }

  if (url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/throttle/window') {
    const accepted = windowDrop(value);
    json(response, accepted ? 200 : 429, {
      accepted: Boolean(accepted),
      strategy: 'window-drop',
      value,
    });
    return;
  }

  if (url.pathname === '/throttle/queue') {
    queue(value);
    json(response, 202, {
      accepted: true,
      strategy: 'queue',
      value,
      message: 'Queued for FIFO execution; watch the server terminal.',
    });
    return;
  }

  if (url.pathname === '/throttle/token-bucket') {
    const accepted = tokenBucket(value);
    json(response, accepted ? 200 : 429, {
      accepted: Boolean(accepted),
      strategy: 'token-bucket',
      value,
    });
    return;
  }

  json(response, 404, {
    error: 'Route not found',
    routes: ['/health', '/throttle/window', '/throttle/queue', '/throttle/token-bucket'],
  });
});

server.listen(port, () => {
  console.log(`Throttle demo server listening at http://localhost:${port}`);
});