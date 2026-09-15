import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Retryer } from './retry.js';

const port = Number(process.env.PORT ?? 3000);
const flakyAttempts = new Map<string, number>();

class HttpError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function getSessionKey(request: IncomingMessage, url: URL): string {
  return request.headers['x-demo-session']?.toString()
    ?? `${request.socket.remoteAddress ?? 'local'}:${url.pathname}:${url.search}`;
}

function handleFlaky(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const failCount = Math.max(0, Number(url.searchParams.get('failCount') ?? 2));
  const status = Number(url.searchParams.get('status') ?? 503);
  const key = getSessionKey(request, url);
  const attempt = (flakyAttempts.get(key) ?? 0) + 1;
  flakyAttempts.set(key, attempt);

  if (attempt <= failCount) {
    json(response, status, { ok: false, attempt, message: `Transient failure ${attempt} of ${failCount}` });
    return;
  }

  json(response, 200, { ok: true, attempt, message: 'Flaky service recovered' });
}

function requestTarget(path: string, sessionId: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = fetch(`http://localhost:${port}${path}`, {
      headers: { 'x-demo-session': sessionId },
    });

    request.then(async (response) => {
      const body = await response.json() as unknown;
      if (!response.ok) {
        reject(new HttpError(response.status, `Target returned HTTP ${response.status}`));
        return;
      }
      resolve({ status: response.status, body });
    }).catch(reject);
  });
}

async function handleDemo(response: ServerResponse, url: URL): Promise<void> {
  const strategy = url.searchParams.get('strategy') ?? 'exponential';
  const maxAttempts = Number(url.searchParams.get('maxAttempts') ?? 4);
  const target = url.searchParams.get('target') ?? 'flaky';
  const failCount = Number(url.searchParams.get('failCount') ?? 2);
  const baseDelayMs = Number(url.searchParams.get('baseDelayMs') ?? 500);
  const multiplier = Number(url.searchParams.get('multiplier') ?? 2);
  const maxDelayMs = Number(url.searchParams.get('maxDelayMs') ?? 30_000);
  const maxJitterMs = Number(url.searchParams.get('maxJitterMs') ?? 250);
  const sessionId = randomUUID();
  const targetPath = target === 'fatal'
    ? '/mock/fatal'
    : `/mock/flaky?failCount=${failCount}&status=${url.searchParams.get('status') ?? 503}`;
  const delays: number[] = [];
  let attempts = 0;
  let finalResponse: { status: number; body: unknown } | undefined;

  try {
    const retryer = new Retryer({
      maxAttempts,
      strategy: strategy as 'constant' | 'exponential' | 'exponentialJitter',
      baseDelayMs,
      multiplier,
      maxDelayMs,
      maxJitterMs,
      retryOn: (error) => error instanceof HttpError && error.status >= 500 && error.status < 600,
      onRetry: (attempt, delayMs, error) => {
        delays.push(delayMs);
        const status = error instanceof HttpError ? error.status : 'unknown';
        console.log(`[Attempt ${attempt}] Failed with ${status}. Retrying in ${delayMs}ms...`);
      },
    });

    finalResponse = await retryer.execute(async () => {
      attempts += 1;
      const result = await requestTarget(targetPath, sessionId);
      console.log(`[Attempt ${attempts}] Succeeded with ${result.status} OK.`);
      return result;
    });

    json(response, 200, {
      success: true,
      totalAttempts: attempts,
      delays,
      successStatus: finalResponse.status,
      finalResponse,
    });
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : undefined;
    json(response, status && status >= 400 ? status : 500, {
      success: false,
      totalAttempts: attempts,
      delays,
      finalError: {
        status,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `localhost:${port}`}`);

  if (request.method !== 'GET') {
    json(response, 405, { error: 'Only GET is supported' });
    return;
  }
  if (url.pathname === '/mock/flaky') {
    handleFlaky(request, response, url);
    return;
  }
  if (url.pathname === '/mock/fatal') {
    json(response, 400, { ok: false, message: 'Permanent bad request' });
    return;
  }
  if (url.pathname === '/demo/run') {
    void handleDemo(response, url);
    return;
  }

  json(response, 404, { error: 'Route not found' });
});

server.listen(port, () => {
  console.log(`Retry demo server listening at http://localhost:${port}`);
});
