import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { CustomFuture, submit, TimeoutError } from "./CustomFuture";

const PORT = Number(process.env.PORT ?? 3000);

function timestamp(): string {
  return new Date().toISOString();
}

function log(stage: string, message: string): void {
  console.log(`[${timestamp()}] [${stage}] ${message}`);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body, null, 2);

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);

  log("Response sent", `status=${statusCode}`);
}

function delayedTask<T>(
  name: string,
  delayMs: number,
  value: T,
): ReturnType<typeof submit<T>> {
  log("Task submitted", `${name}, delay=${delayMs}ms`);

  return submit(() => {
    return new Promise<T>((resolve) => {
      setTimeout(() => {
        log("Worker finished", `${name}`);
        resolve(value);
      }, delayMs);
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method Not Allowed" });
      return;
    }

    if (url.pathname === "/compute") {
      const future = submit(() => {
        log("Task submitted", "compute");
        return 21 * 2;
      }).then((value) => {
        log("Worker finished", `compute: ${value}`);
        return value + 1;
      });

      const value = await future.get();
      sendJson(response, 200, {
        endpoint: "/compute",
        result: value,
      });
      return;
    }

    if (url.pathname === "/timeout") {
      const future = delayedTask("timeout-task", 3000, "finished");

      try {
        const value = await future.get(1000);
        sendJson(response, 200, {
          endpoint: "/timeout",
          result: value,
        });
      } catch (err) {
        if (err instanceof TimeoutError) {
          sendJson(response, 504, {
            endpoint: "/timeout",
            error: err.message,
          });
        } else {
          throw err;
        }
      }
      return;
    }

    if (url.pathname === "/race") {
      const start = performance.now();

      const fast = delayedTask("race-fast", 1000, "fast task won");
      const slow = delayedTask("race-slow", 3000, "slow task won");

      const winner = CustomFuture.race([fast, slow]);
      const value = await winner.get();

      const elapsedMs = Math.round(performance.now() - start);
      log("Worker finished", `race outcome=${value}, elapsed=${elapsedMs}ms`);

      sendJson(response, 200, {
        endpoint: "/race",
        winner: value,
        elapsedMs,
      });
      return;
    }

    if (url.pathname === "/all") {
      const start = performance.now();

      const tasks = [
        delayedTask("all-task-1", 1000, "A"),
        delayedTask("all-task-2", 2000, "B"),
        delayedTask("all-task-3", 1500, "C"),
      ];

      const values = await CustomFuture.all(tasks).get();
      const elapsedMs = Math.round(performance.now() - start);

      sendJson(response, 200, {
        endpoint: "/all",
        results: values,
        elapsedMs,
        note: "Tasks run concurrently; total time is approximately the slowest task.",
      });
      return;
    }

    sendJson(response, 404, {
      error: "Not Found",
      endpoints: ["/compute", "/timeout", "/race", "/all"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("Error", message);
    sendJson(response, 500, { error: message });
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(PORT, () => {
  log("Server", `HTTP server listening on http://localhost:${PORT}`);
});
