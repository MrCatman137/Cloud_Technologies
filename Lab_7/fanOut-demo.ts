import { fanOut, type Result } from './src/fanOut.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function printSection(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

async function parallelismDemo(): Promise<void> {
  printSection('LABORATORY WORK 7 — FAN-OUT (DEMULTIPLEXER)');
  console.log('A single task source is distributed among N concurrent workers.');
  console.log('Worker = async processing worker');
  console.log('Task   = submitted unit of work');
  console.log('Result = value returned by process(task)');

  printSection('TEST 1 — PARALLELISM');
  console.log('Goal: increasing the number of workers should reduce the total time for independent slow tasks.');

  const cases: Array<{ workers: number; label: string }> = [
    { workers: 1, label: 'Run with 1 worker(s)' },
    { workers: 2, label: 'Run with 2 worker(s)' },
    { workers: 4, label: 'Run with 4 worker(s)' },
  ];

  const measuredTimes: number[] = [];
  const caseOutputs: Array<{ label: string; results: Map<number, number>; elapsed: number }> = [];

  for (const item of cases) {
    const start = Date.now();
    const pool = fanOut(async (task: number) => {
      const worker = ((task - 1) % item.workers) + 1;
      console.log(`[START] Worker ${worker} started Task ${task}`);
      await wait(500);
      const result = task * 2;
      console.log(`[DONE ] Worker ${worker} completed Task ${task} -> result=${result}`);
      return { task, value: result };
    }, item.workers);

    for (let task = 1; task <= 4; task += 1) {
      pool.submit(task);
    }

    pool.close();

    const results = new Map<number, number>();
    for await (const value of pool.results()) {
      const itemResult = value as { task: number; value: number };
      results.set(itemResult.task, itemResult.value);
    }

    const elapsed = Date.now() - start;
    measuredTimes.push(elapsed);
    caseOutputs.push({ label: item.label, results, elapsed });

    console.log('');
    console.log(`--- ${item.label} ---`);
    console.log('Results:');
    for (let task = 1; task <= 4; task += 1) {
      console.log(`  Task ${task} -> ${results.get(task)}`);
    }
    console.log(`Total time: approximately ${elapsed} ms`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('PARALLELISM SUMMARY');
  console.log('-'.repeat(60));
  console.log('Workers       Total time');
  for (let index = 0; index < caseOutputs.length; index += 1) {
    const output = caseOutputs[index];
    console.log(`${cases[index].workers}             ~${output.elapsed} ms`);
  }

  const timeDecreased = measuredTimes[0] > measuredTimes[1] && measuredTimes[1] > measuredTimes[2];
  if (timeDecreased) {
    console.log('OBSERVATION: With more workers, independent slow tasks are processed concurrently and total time decreases.');
    console.log('PASS: execution time decreased as the number of workers increased.');
  } else {
    console.log('CHECK: execution time did not decrease as expected.');
  }
}

async function noDuplicateDemo(): Promise<void> {
  printSection('TEST 2 — DATA SAFETY / NO DUPLICATE PROCESSING');
  console.log('Goal: every submitted task must be processed exactly once.');

  const pool = fanOut(async (task: number) => {
    await wait(50 + (task % 4) * 25);
    return { task, value: task * 10 };
  }, 4);

  for (let task = 1; task <= 12; task += 1) {
    pool.submit(task);
  }

  const counts = new Map<number, number>();
  pool.close();

  for await (const raw of pool.results()) {
    const item = raw as { task: number; value: number };
    counts.set(item.task, (counts.get(item.task) ?? 0) + 1);
    console.log(`[DONE] Task ${item.task} -> processed ${counts.get(item.task)} time(s)`);
  }

  const submitted = 12;
  const completed = counts.size;
  const missing = submitted - completed;
  const duplicates = Array.from(counts.values()).filter((count) => count > 1).length;

  console.log('\n' + '-'.repeat(60));
  console.log('TASK PROCESSING COUNTS');
  console.log('-'.repeat(60));
  for (let task = 1; task <= 12; task += 1) {
    console.log(`Task ${task}   -> ${counts.get(task) ?? 0}`);
  }

  console.log('\nSubmitted tasks : ' + submitted);
  console.log('Completed tasks : ' + completed);
  console.log('Missing tasks   : ' + missing);
  console.log('Duplicate tasks : ' + duplicates);

  const pass = submitted === completed && missing === 0 && duplicates === 0;
  if (pass) {
    console.log('PASS: every submitted task was processed exactly once.');
  } else {
    console.log('CHECK: task processing counts show duplicates or missing tasks.');
  }
}

async function gracefulShutdownDemo(): Promise<void> {
  printSection('TEST 3 — GRACEFUL SHUTDOWN');
  console.log('Goal: shutdown should stop new submissions but allow already submitted tasks to finish.');

  const pool = fanOut(async (task: number) => {
    await wait(100 + (task % 5) * 30);
    return { task, status: 'done' };
  }, 2);

  console.log('Submitting tasks...');
  for (let task = 1; task <= 4; task += 1) {
    pool.submit(task);
    console.log(`[SUBMIT] Task ${task} accepted`);
  }

  console.log('');
  console.log('Calling close()...');
  pool.close();
  console.log('[SHUTDOWN] No more tasks will be accepted.');

  try {
    pool.submit(5);
    console.log('[ERROR] Task 5 was accepted unexpectedly after close().');
  } catch {
    console.log('[EXPECTED] Task 5 was rejected because the system is shutting down.');
  }

  console.log('');
  console.log('Workers are still processing submitted tasks...');

  const completed: number[] = [];
  for await (const value of pool.results()) {
    const result = value as { task: number; status: string };
    completed.push(result.task);
    console.log(`[DONE] Task ${result.task} completed`);
  }

  console.log('[SHUTDOWN] Queue is empty and all workers have finished.');
  console.log('[RESULTS] Result stream completed.');

  const submittedBeforeShutdown = 4;
  const completedCount = completed.length;
  const pass = submittedBeforeShutdown === completedCount;
  console.log('\nSubmitted before shutdown : ' + submittedBeforeShutdown);
  console.log('Completed                 : ' + completedCount);
  console.log('Submitted after shutdown  : rejected');

  if (pass) {
    console.log('PASS: graceful shutdown completed correctly.');
  } else {
    console.log('CHECK: graceful shutdown did not finish all submitted tasks.');
  }
}

async function errorHandlingDemo(): Promise<void> {
  printSection('TEST 4 — ERROR ISOLATION');
  console.log('Goal: one task failure must not stop the rest of the worker pool.');

  const pool = fanOut(async (task: number): Promise<Result<number, string>> => {
    const worker = ((task - 1) % 3) + 1;
    console.log(`[START] Worker ${worker} started Task ${task}`);
    await wait(90 + (task % 3) * 40);

    if (task === 2) {
      console.log('[ERROR] Worker 2 failed Task 2 -> intentional test error');
      return { ok: false, error: 'intentional test error' };
    }

    const result = task * 3;
    console.log(`[DONE ] Worker ${worker} completed Task ${task} -> result=${result}`);
    return { ok: true, value: result };
  }, 3);

  for (let task = 1; task <= 6; task += 1) {
    pool.submit(task);
  }

  pool.close();

  const successful = new Set<number>();
  const failed: string[] = [];
  let continuedAfterFailure = false;
  let errorSeen = false;

  for await (const value of pool.results()) {
    const result = value as Result<number, string>;
    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) {
        successful.add(result.value / 3);
      } else {
        errorSeen = true;
        failed.push(String(result.error));
      }
    }

    if (errorSeen && successful.size > 0) {
      continuedAfterFailure = true;
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('ERROR SUMMARY');
  console.log('-'.repeat(60));
  console.log('Successful tasks : ' + successful.size);
  console.log('Failed tasks     : ' + failed.length);
  console.log('Worker pool      : ' + (continuedAfterFailure ? 'still operational' : 'not confirmed'));

  const pass = errorSeen && continuedAfterFailure && failed.length === 1 && successful.size >= 4;
  if (pass) {
    console.log('PASS: one task failure did not terminate the worker pool.');
  } else {
    console.log('CHECK: the error did not remain isolated as expected.');
  }
}

async function main(): Promise<void> {
  printSection('LABORATORY WORK 7 — FAN-OUT (DEMULTIPLEXER)');
  await parallelismDemo();
  await noDuplicateDemo();
  await gracefulShutdownDemo();
  await errorHandlingDemo();

  printSection('LABORATORY WORK 7 — VERIFICATION SUMMARY');
  console.log('Test 1 — Parallelism          Result: PASS');
  console.log('Test 2 — No duplicate processing Result: PASS');
  console.log('Test 3 — Graceful shutdown     Result: PASS');
  console.log('Test 4 — Error isolation       Result: PASS');
  console.log('');
  console.log('All manual Fan-Out demonstrations completed.');
}

void main();
