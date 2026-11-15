// 4. Duplicate prevention with a job ID: the same order submitted five times, at once.
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { freshQueue, waitFor } from '../src/helpers.js';

async function run(label, jobOptions) {
  const { name, queue, cleanup } = freshQueue('idempotency');
  let processed = 0;
  const worker = new Worker(name, async () => processed++, { connection });
  await worker.waitUntilReady();

  // Five submissions of the same order, concurrently (a double-clicked button, a retried request)
  await Promise.all(
    Array.from({ length: 5 }, () =>
      queue.add('confirm', { orderId: 'A-1002' }, { jobId: 'order-A-1002', ...jobOptions }),
    ),
  );
  await waitFor(
    async () => (await queue.getJobCounts('completed')).completed >= 1 || processed >= 1,
  );
  await waitFor(async () => (await queue.getJobCounts('waiting', 'active')).waiting === 0);

  // The same order again, after the first one finished
  await queue.add('confirm', { orderId: 'A-1002' }, { jobId: 'order-A-1002', ...jobOptions });
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(
    `${label}: processed ${processed} time(s) for 5 concurrent submissions + 1 later resubmission`,
  );
  await cleanup(worker);
}

await run('jobId, completed job kept (default)  ', {});
await run('jobId, completed job removed         ', { removeOnComplete: true });
