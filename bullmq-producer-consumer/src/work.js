import { sleep } from './helpers.js';

/** I/O-bound work: waits, like a call to another service or a database. */
export async function ioBound(job) {
  await sleep(job.data.ms);
  return { waitedMs: job.data.ms };
}

/** Fails its first `failTimes` attempts, then succeeds: a dependency that recovers. */
export async function flaky(job) {
  if (job.attemptsMade < job.data.failTimes) {
    throw new Error(`temporary failure on attempt ${job.attemptsMade + 1}`);
  }
  return { succeededOnAttempt: job.attemptsMade + 1 };
}

/** Fails until the job data says the underlying problem is fixed. */
export async function brokenUntilFixed(job) {
  if (!job.data.fixed) throw new Error(`invalid payment method for order ${job.data.orderId}`);
  return { charged: job.data.orderId };
}
