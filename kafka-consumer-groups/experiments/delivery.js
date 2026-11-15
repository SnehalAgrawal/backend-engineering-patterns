// 3. At-least-once delivery: a consumer is killed (SIGKILL) halfway through 6,000 messages, then a new one
// in the same group finishes the job. Messages processed after the last committed offset are processed again.
// Commit modes: "auto" (the default, every 5 s) and "each" (commit after every message).
import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTopic, deleteTopic, kafka, uniqueGroup } from '../src/kafka.js';
import { sleep, waitFor } from '../src/helpers.js';

const TOTAL = 6000;
const worker = new URL('./delivery-worker.js', import.meta.url).pathname;
const lines = (file) =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];

async function run(mode) {
  const topic = await createTopic('delivery', 6);
  const group = uniqueGroup(`delivery-${mode}`);
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'delivery-')), 'processed.txt');

  const producer = kafka.producer();
  await producer.connect();
  for (let i = 0; i < TOTAL; i += 500) {
    await producer.send({
      topic,
      messages: Array.from({ length: 500 }, (_, j) => ({ value: String(i + j) })),
    });
  }
  await producer.disconnect();

  const first = fork(worker, [topic, group, mode, out], { stdio: 'ignore' });
  await waitFor(() => lines(out).length >= TOTAL / 2, { everyMs: 5, timeoutMs: 120_000 });
  first.kill('SIGKILL');
  const killedAt = Date.now();
  const beforeCrash = lines(out).length;
  await sleep(500);

  const second = fork(worker, [topic, group, mode, out], { stdio: 'ignore' });
  // The killed member never said goodbye: its partitions move only once the broker gives up on it
  await waitFor(() => lines(out).length > beforeCrash, { everyMs: 20, timeoutMs: 120_000 });
  const resumedAfterMs = Date.now() - killedAt;
  await waitFor(() => new Set(lines(out)).size === TOTAL, { timeoutMs: 120_000 });
  await sleep(3000); // let it finish anything in flight
  second.kill('SIGTERM');
  await deleteTopic(topic);

  const all = lines(out);
  return { beforeCrash, resumedAfterMs, processed: all.length, unique: new Set(all).size };
}

console.log(
  `${TOTAL} messages on 6 partitions; the consumer is killed after processing about half, then a new one finishes.\n`,
);
console.log(
  'commit mode                 processed before kill   resumed after kill   total processed   distinct   duplicates   lost',
);
for (const [mode, label] of [
  ['auto', 'auto-commit every 5 s'],
  ['each', 'commitOffsets per message'],
]) {
  const r = await run(mode);
  console.log(
    `${label.padEnd(27)} ${String(r.beforeCrash).padStart(21)} ${`${(r.resumedAfterMs / 1000).toFixed(1)} s`.padStart(20)} ${String(r.processed).padStart(17)} ${String(r.unique).padStart(10)} ` +
      `${String(r.processed - r.unique).padStart(12)} ${String(TOTAL - r.unique).padStart(6)}`,
  );
}
