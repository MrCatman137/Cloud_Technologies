import { fanIn, type Result } from './src/fanIn.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isResult<T>(value: T | Result<T, Error>): value is Result<T, Error> {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

function compactValue(value: unknown): string {
  return String(value);
}

async function* delayedStream<T>(label: string, values: T[], delays: number[]): AsyncGenerator<T> {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const delay = delays[index] ?? 0;
    await wait(delay);
    yield value;
  }
}

async function* errorStream(): AsyncGenerator<Result<string, Error>> {
  yield { ok: true, value: 'A1' };
  await wait(65);
  yield { ok: true, value: 'A2' };
  await wait(25);
  throw new Error('stream A failed');
}

async function* stableStreamB(): AsyncGenerator<Result<string, Error>> {
  for (const value of ['B1', 'B2', 'B3', 'B4']) {
    await wait(value === 'B1' ? 20 : value === 'B2' ? 50 : value === 'B3' ? 35 : 30);
    yield { ok: true, value };
  }
}

async function demoTwoStreams(): Promise<void> {
  console.log('\n=== Test 1: Two streams ===');
  const streamA = delayedStream('A', ['A1', 'A2', 'A3'], [50, 120, 80]);
  const streamB = delayedStream('B', ['B1', 'B2', 'B3'], [10, 40, 100]);

  const merged: string[] = [];
  for await (const value of fanIn([streamA, streamB])) {
    merged.push(compactValue(value));
  }

  const aTimeline = 'A:   --A1----A2----A3';
  const bTimeline = 'B:   B1----B2----B3';
  const outTimeline = `OUT: ${merged.join('-')}`;

  console.log(aTimeline);
  console.log(bTimeline);
  console.log(outTimeline);
  console.log('Fan-In completed for two streams.');
}

async function demoThreeStreams(): Promise<void> {
  console.log('\n=== Test 2: Three streams ===');
  const streamA = delayedStream('A', ['A1', 'A2', 'A3'], [60, 110, 90]);
  const streamB = delayedStream('B', ['B1', 'B2', 'B3'], [30, 70, 50]);
  const streamC = delayedStream('C', ['C1', 'C2', 'C3'], [20, 90, 140]);

  const merged: string[] = [];
  for await (const value of fanIn([streamA, streamB, streamC])) {
    merged.push(compactValue(value));
  }

  console.log('A:   --A1----A2----A3');
  console.log('B:   B1----B2----B3');
  console.log('C:   C1----C2----C3');
  console.log(`OUT: ${merged.join('-')}`);
  console.log('Fan-In completed for three streams.');
}

async function demoCompletion(): Promise<void> {
  console.log('\n=== Test 3: Completion behavior ===');

  const streamA = delayedStream('A', ['A1', 'A2'], [30, 70]);
  const streamB = delayedStream('B', ['B1', 'B2', 'B3', 'B4'], [10, 80, 40, 90]);
  const streamC = delayedStream('C', ['C1'], [200]);

  const merged: string[] = [];
  for await (const value of fanIn([streamA, streamB, streamC])) {
    merged.push(compactValue(value));
  }

  console.log('A:   --A1----A2');
  console.log('B:   B1----B2----B3----B4');
  console.log('C:   C1');
  console.log(`OUT: ${merged.join('-')}`);
  console.log('All inputs completed; fan-in closed.');
}

async function demoErrorIsolation(): Promise<void> {
  console.log('\n=== Test 4: Error isolation ===');

  const streamA = errorStream();
  const streamB = stableStreamB();

  const merged: string[] = [];
  for await (const value of fanIn([streamA, streamB])) {
    const result = value as Result<string, Error>;
    if (isResult(result)) {
      if (result.ok) {
        merged.push(result.value);
      } else {
        merged.push(`ERROR(${result.error.message})`);
      }
    } else {
      merged.push(compactValue(value));
    }
  }

  console.log('A:   A1----A2----ERROR');
  console.log('B:   B1----B2----B3----B4');
  console.log(`OUT: ${merged.join('-')}`);
  console.log('Fan-In finished after all streams ended, despite the error in A.');
}

async function main(): Promise<void> {
  console.log('Starting Fan-In demo...');
  await demoTwoStreams();
  await demoThreeStreams();
  await demoCompletion();
  await demoErrorIsolation();
}

void main();
