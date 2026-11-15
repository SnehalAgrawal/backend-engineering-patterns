// 2. Retries with exponential backoff: a job that fails three times, then succeeds.
// attempts: 5, backoff: exponential with delay 200 ms -> BullMQ waits 200, 400, 800 ms before retries 1, 2, 3.
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { freshQueue, waitFor } from '../src/helpers.js';
import { flaky } from '../src/work.js';

const DELAY = 200;
const { name, queue, cleanup } = freshQueue('retries');
const starts = [];
const worker = new Worker(
  name,
  async (job) => {
    starts.push(Date.now());
    return flaky(job);
  },
  { connection },
);
await worker.waitUntilReady();

const job = await queue.add(
  'charge',
  { failTimes: 3 },
  { attempts: 5, backoff: { type: 'exponential', delay: DELAY } },
);
await waitFor(async () => ['completed', 'failed'].includes(await job.getState()));
const finished = await queue.getJob(job.id);

console.log(
  `Job ${finished.id}: ${await finished.getState()} after ${finished.attemptsMade} attempts, result ${JSON.stringify(finished.returnvalue)}\n`,
);
console.log('attempt   started after previous   expected backoff');
starts.forEach((t, i) => {
  const gap = i === 0 ? '-' : `${t - starts[i - 1]} ms`;
  const expected = i === 0 ? '-' : `${DELAY * 2 ** (i - 1)} ms`;
  console.log(`${String(i + 1).padStart(7)} ${gap.padStart(24)} ${expected.padStart(18)}`);
});
await cleanup(worker);
