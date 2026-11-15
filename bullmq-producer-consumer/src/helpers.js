import { Queue } from 'bullmq';
import { connection } from './connection.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A queue with a unique name, so runs never see each other's jobs. Call cleanup() when done. */
export function freshQueue(label, options = {}) {
  const name = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const queue = new Queue(name, { connection, ...options });
  return {
    name,
    queue,
    async cleanup(...workers) {
      await Promise.all(workers.map((worker) => worker.close()));
      await queue.obliterate({ force: true });
      await queue.close();
    },
  };
}

/** Poll until check() returns a truthy value, or fail after timeoutMs. */
export async function waitFor(check, { timeoutMs = 60_000, everyMs = 20 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(everyMs);
  }
  throw new Error(`Timed out after ${timeoutMs} ms`);
}
