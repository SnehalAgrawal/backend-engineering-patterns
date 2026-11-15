// Behaviour checks for CI: what a queue must guarantee, asserted with bounds rather than exact timings.
// Needs Redis (docker compose up -d, or REDIS_HOST/REDIS_PORT).
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { after, test } from 'node:test';
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { freshQueue, sleep, waitFor } from '../src/helpers.js';
import { brokenUntilFixed, flaky, ioBound } from '../src/work.js';

const open = [];
const setup = (label, processor, workerOptions = {}) => {
  const q = freshQueue(label);
  const worker = new Worker(q.name, processor, { connection, ...workerOptions });
  open.push(() => q.cleanup(worker));
  return { ...q, worker };
};
after(async () => Promise.all(open.map((close) => close())));

test('a failing job is retried with exponential backoff until it succeeds', async () => {
  const starts = [];
  const { queue } = setup('t-retries', async (job) => {
    starts.push(Date.now());
    return flaky(job);
  });
  const job = await queue.add(
    'x',
    { failTimes: 2 },
    { attempts: 3, backoff: { type: 'exponential', delay: 100 } },
  );
  await waitFor(async () => (await job.getState()) === 'completed');
  const done = await queue.getJob(job.id);
  assert.equal(done.attemptsMade, 3);
  assert.deepEqual(done.returnvalue, { succeededOnAttempt: 3 });
  assert.ok(
    starts[1] - starts[0] >= 100,
    `first retry after ${starts[1] - starts[0]} ms, expected >= 100`,
  );
  assert.ok(
    starts[2] - starts[1] >= 200,
    `second retry after ${starts[2] - starts[1]} ms, expected >= 200`,
  );
});

test('a job that keeps failing lands in the failed set, and can be retried once fixed', async () => {
  const { queue } = setup('t-dead-letter', brokenUntilFixed);
  const job = await queue.add(
    'x',
    { orderId: 'T-1', fixed: false },
    { attempts: 2, backoff: { type: 'fixed', delay: 50 } },
  );
  await waitFor(async () => (await job.getState()) === 'failed');
  const failed = await queue.getJob(job.id);
  assert.equal(failed.attemptsMade, 2);
  assert.match(failed.failedReason, /invalid payment method/);

  await failed.updateData({ ...failed.data, fixed: true });
  await failed.retry('failed');
  await waitFor(async () => (await job.getState()) === 'completed');
  assert.deepEqual((await queue.getJob(job.id)).returnvalue, { charged: 'T-1' });
});

test('the same jobId submitted concurrently is processed once', async () => {
  let processed = 0;
  const { queue } = setup('t-jobid', async () => processed++);
  await Promise.all(Array.from({ length: 5 }, () => queue.add('x', {}, { jobId: 'same' })));
  await waitFor(async () => (await queue.getJobCounts('completed')).completed === 1);
  await queue.add('x', {}, { jobId: 'same' }); // still in the completed set: ignored
  await sleep(300);
  assert.equal(processed, 1);
});

test('with removeOnComplete, a later resubmission of the same jobId runs again', async () => {
  let processed = 0;
  const { queue } = setup('t-jobid-removed', async () => processed++);
  await queue.add('x', {}, { jobId: 'same', removeOnComplete: true });
  await waitFor(() => processed === 1);
  await sleep(100);
  await queue.add('x', {}, { jobId: 'same', removeOnComplete: true });
  await waitFor(() => processed === 2);
  assert.equal(processed, 2);
});

test('concurrency runs I/O-bound jobs in parallel', async () => {
  let done = 0;
  const { queue, worker } = setup(
    't-concurrency',
    async (job) => {
      await ioBound(job);
      done++;
    },
    { concurrency: 5, autorun: false },
  );
  await queue.addBulk(Array.from({ length: 10 }, () => ({ name: 'x', data: { ms: 100 } })));
  const started = Date.now();
  worker.run();
  await waitFor(() => done === 10);
  const wall = Date.now() - started;
  assert.ok(
    wall < 700,
    `10 jobs of 100 ms at concurrency 5 took ${wall} ms; one at a time takes 1000 ms`,
  );
});

test("a killed worker's job is picked up by another worker after its lock expires", async () => {
  const q = freshQueue('t-crash');
  open.push(() => q.cleanup());
  const job = await q.queue.add('x', { seconds: 10 });

  // The first worker runs in a child process with the same settings as the rescuer, and is killed mid-job
  const child = fork(
    new URL('../experiments/crash-worker.js', import.meta.url).pathname,
    [q.name, '1000,500'],
    { stdio: 'ignore' },
  );
  await waitFor(async () => (await job.getState()) === 'active');
  child.kill('SIGKILL');

  // Started only now, so it cannot take the job before the first worker does
  const rescuer = new Worker(q.name, async () => 'recovered', {
    connection,
    lockDuration: 1000,
    stalledInterval: 500,
  });
  open.push(() => rescuer.close());
  await waitFor(async () => (await job.getState()) === 'completed', { timeoutMs: 15_000 });
  const done = await q.queue.getJob(job.id);
  assert.equal(done.returnvalue, 'recovered');
  assert.equal(done.stalledCounter, 1);
});
