import { throttle } from './throttle.js';

const startedAt = Date.now();

function log(message: string): void {
  console.log(`[+${String(Date.now() - startedAt).padStart(3, '0')}ms] ${message}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function windowDropDemo(): Promise<void> {
  console.log('\n1. Window limit + drop strategy');
  let executed = 0;
  const limited = throttle(
    (callNumber: number) => {
      executed += 1;
      log(`executed call ${callNumber}`);
    },
    { limit: 3, intervalMs: 1_000 },
    { trailing: false, overflowStrategy: 'drop' },
  );

  for (let callNumber = 1; callNumber <= 10; callNumber += 1) limited(callNumber);
  await wait(50);
  log(`result: ${executed} executed, ${10 - executed} dropped`);
}

async function leadingTrailingDemo(): Promise<void> {
  console.log('\n2. Leading versus trailing');
  const leadingOnly = throttle(
    (label: string) => log(`leading-only: ${label}`),
    { limit: 1, intervalMs: 300 },
    { leading: true, trailing: false },
  );
  leadingOnly('first');
  leadingOnly('dropped');
  await wait(350);

  const trailingOnly = throttle(
    (label: string) => log(`trailing-only: ${label}`),
    { limit: 1, intervalMs: 300 },
    { leading: false, trailing: true },
  );
  trailingOnly('first');
  trailingOnly('latest');
  await wait(350);
}

async function queueDemo(): Promise<void> {
  console.log('\n3. Queue strategy');
  const queued = throttle(
    (callNumber: number) => log(`FIFO execution ${callNumber}`),
    { limit: 2, intervalMs: 1_000 },
    { overflowStrategy: 'queue' },
  );
  for (let callNumber = 1; callNumber <= 6; callNumber += 1) queued(callNumber);
  await wait(2_100);
}

async function cancellationDemo(): Promise<void> {
  console.log('\n4. Cancellation');
  const cancellable = throttle(
    (label: string) => log(`should not appear after cancel: ${label}`),
    { limit: 1, intervalMs: 400 },
    { leading: false, trailing: true },
  );
  cancellable('scheduled');
  await wait(100);
  cancellable.cancel();
  log('cancelled pending call');
  await wait(450);
}

async function main(): Promise<void> {
  await windowDropDemo();
  await leadingTrailingDemo();
  await queueDemo();
  await cancellationDemo();
}

void main();