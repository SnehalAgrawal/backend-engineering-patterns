// The worker that gets killed in crash-recovery.js: takes one job and works on it for job.data.seconds.
// Arguments: queue name, then "defaults" or "<lockDuration>,<stalledInterval>" in milliseconds
// (an empty value keeps BullMQ's default for that setting).
import { Worker } from 'bullmq';
import { connection } from '../src/connection.js';
import { sleep } from '../src/helpers.js';

const [queueName, settings] = process.argv.slice(2);
const options = {};
if (settings !== 'defaults') {
  const [lockDuration, stalledInterval] = settings.split(',');
  if (lockDuration) options.lockDuration = Number(lockDuration);
  if (stalledInterval) options.stalledInterval = Number(stalledInterval);
}
new Worker(queueName, async (job) => sleep(job.data.seconds * 1000), { connection, ...options });
