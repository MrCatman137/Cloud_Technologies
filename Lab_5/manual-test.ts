import { withRetry } from './src/retry.js';
import { TimeoutError, withTimeout } from './src/timeout.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function heading(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function run(): Promise<void> {
  heading('Case 1: fast task');
  const fastResult = await withTimeout(async () => {
    await wait(25);
    return 'fast task completed';
  }, 100);
  console.log(`[OK] ${fastResult}`);

  heading('Case 2: slow task and cancellation');
  let sideEffectActive = true;
  try {
    await withTimeout(
      (signal) =>
        new Promise<void>((resolve) => {
          const interval = setInterval(() => console.log('  slow task still running'), 20);
          signal?.addEventListener('abort', () => {
            clearInterval(interval);
            sideEffectActive = false;
            console.log('  side effect cancelled by AbortSignal');
            resolve();
          });
        }),
      60,
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.log(`[TIMEOUT] ${error.message}`);
    } else {
      throw error;
    }
  }
  console.log(`[CHECK] side effect active: ${sideEffectActive}`);

  heading('Case 3: retrying a slow task with a timeout per attempt');
  let attempts = 0;
  try {
    await withRetry(
      (attempt) => {
        attempts = attempt;
        console.log(`  attempt ${attempt}: running (60 ms timeout)`);
        return withTimeout(() => new Promise<string>(() => undefined), 60);
      },
      { retries: 2, delayMs: 10 },
    );
  } catch (error) {
    console.log(`[STOPPED] ${error instanceof TimeoutError ? error.message : String(error)}`);
    console.log(`[CHECK] bounded attempts: ${attempts}`);
  }
}

run().catch((error: unknown) => {
  console.error('[ERROR]', error);
  process.exitCode = 1;
});