// 3. Dead letters: a job that keeps failing ends up in the failed set, with its reason and stack,
// where it waits until someone fixes the cause and retries it.
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { freshQueue, waitFor } from '../src/helpers.js';
import { brokenUntilFixed } from '../src/work.js';

const { name, queue, cleanup } = freshQueue('dead-letter');
const worker = new Worker(name, brokenUntilFixed, { connection });
await worker.waitUntilReady();

const job = await queue.add(
  'charge',
  { orderId: 'A-1001', fixed: false },
  { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
);
await waitFor(async () => (await job.getState()) === 'failed');
let failed = await queue.getJob(job.id);
console.log('After 3 attempts:');
console.log(`  state ${await failed.getState()}, attemptsMade ${failed.attemptsMade}`);
console.log(`  failedReason: ${failed.failedReason}`);
console.log(`  stack traces kept: ${failed.stacktrace.length}`);
console.log(
  `  queue counts: ${JSON.stringify(await queue.getJobCounts('waiting', 'active', 'completed', 'failed'))}`,
);

// The cause is fixed (here: the data), then the failed job is retried by hand
await failed.updateData({ ...failed.data, fixed: true });
await failed.retry('failed');
await waitFor(async () => (await job.getState()) === 'completed');
failed = await queue.getJob(job.id);
console.log('\nAfter fixing the cause and calling job.retry("failed"):');
console.log(`  state ${await failed.getState()}, result ${JSON.stringify(failed.returnvalue)}`);
console.log(
  `  queue counts: ${JSON.stringify(await queue.getJobCounts('waiting', 'active', 'completed', 'failed'))}`,
);
await cleanup(worker);
