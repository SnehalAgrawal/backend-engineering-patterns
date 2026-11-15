// 5. Crash recovery: a worker process is killed (SIGKILL) one second into a 10-second job.
// Its lock stops being renewed; once it expires, a stalled-job check moves the job back to waiting
// and another worker processes it. Only one worker runs that check per interval (a Redis key with a
// TTL of the checking worker's stalledInterval), so the killed worker's settings matter too.
import { fork } from 'node:child_process';
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { freshQueue, sleep, waitFor } from '../src/helpers.js';

const LOCK_MS = 2000;
const CHECK_MS = 1000;
const crashingWorker = new URL('./crash-worker.js', import.meta.url).pathname;

async function trial(killedWorkerSettings) {
  const { name, queue, cleanup } = freshQueue('crash');
  const job = await queue.add('report', { seconds: 10 });

  const child = fork(crashingWorker, [name, killedWorkerSettings], { stdio: 'ignore' });
  await waitFor(async () => (await job.getState()) === 'active');
  await sleep(1000);
  child.kill('SIGKILL');
  const killedAt = Date.now();

  let recoveredAt;
  const rescuer = new Worker(
    name,
    async () => {
      recoveredAt ??= Date.now();
      return 'done';
    },
    { connection, lockDuration: LOCK_MS, stalledInterval: CHECK_MS },
  );
  await waitFor(async () => (await job.getState()) === 'completed', {
    timeoutMs: 60_000,
    everyMs: 50,
  });
  const finished = await queue.getJob(job.id);
  await cleanup(rescuer);
  return { ms: recoveredAt - killedAt, stalledCounter: finished.stalledCounter };
}

console.log(
  `Rescuing worker: lockDuration ${LOCK_MS} ms, stalledInterval ${CHECK_MS} ms. Job: 10 s; the first worker is killed after 1 s.\n`,
);
for (const [label, settings, trials] of [
  [
    `A. killed worker with the same settings (${LOCK_MS}/${CHECK_MS} ms)`,
    `${LOCK_MS},${CHECK_MS}`,
    3,
  ],
  ['B. killed worker on BullMQ defaults (30000/30000 ms)', 'defaults', 2],
  [
    `C. killed worker with the same lock (${LOCK_MS} ms) but the default stalledInterval (30000 ms)`,
    `${LOCK_MS},`,
    2,
  ],
]) {
  console.log(label);
  for (let i = 1; i <= trials; i++) {
    const { ms, stalledCounter } = await trial(settings);
    console.log(
      `  trial ${i}: job picked up again ${ms} ms after the kill (stalledCounter ${stalledCounter})`,
    );
  }
}
