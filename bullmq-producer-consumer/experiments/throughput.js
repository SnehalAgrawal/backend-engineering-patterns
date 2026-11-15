// 1. Throughput vs worker concurrency, for I/O-bound jobs.
// 200 jobs that each wait 50 ms, processed by one worker at concurrency 1, 5, 20, and 50.
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { freshQueue, waitFor } from '../src/helpers.js';
import { ioBound } from '../src/work.js';

const JOBS = 200;
const WAIT_MS = 50;

console.log(`${JOBS} jobs, each waiting ${WAIT_MS} ms; one worker per run\n`);
console.log('concurrency   wall time   jobs/s   ideal time   overhead');
for (const concurrency of [1, 5, 20, 50]) {
  const { name, queue, cleanup } = freshQueue('throughput', {
    defaultJobOptions: { removeOnComplete: true },
  });
  let done = 0;
  const worker = new Worker(name, ioBound, { connection, concurrency, autorun: false });
  worker.on('completed', () => done++);
  await worker.waitUntilReady();
  await queue.addBulk(
    Array.from({ length: JOBS }, (_, i) => ({ name: 'wait', data: { ms: WAIT_MS, i } })),
  );

  const started = performance.now();
  worker.run();
  await waitFor(() => done === JOBS, { everyMs: 5 });
  const wall = performance.now() - started;
  const ideal = Math.ceil(JOBS / concurrency) * WAIT_MS;
  console.log(
    `${String(concurrency).padStart(11)} ${`${Math.round(wall)} ms`.padStart(11)} ${String(Math.round(JOBS / (wall / 1000))).padStart(8)} ` +
      `${`${ideal} ms`.padStart(12)} ${`${Math.round(((wall - ideal) / ideal) * 100)}%`.padStart(10)}`,
  );
  await cleanup(worker);
}
