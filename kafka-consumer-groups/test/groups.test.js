// Behaviour checks for CI against a real Kafka 4 broker (docker compose up -d, or KAFKA_BROKERS).
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createConsumer,
  createTopic,
  deleteTopic,
  groupMemberCount,
  kafka,
  uniqueGroup,
} from '../src/kafka.js';
import { sleep, waitFor, waitForStableAssignment } from '../src/helpers.js';

async function produce(topic, messages) {
  const producer = kafka.producer();
  await producer.connect();
  for (let i = 0; i < messages.length; i += 500)
    await producer.send({ topic, messages: messages.slice(i, i + 500) });
  await producer.disconnect();
}

async function startGroup(topic, group, members, protocol, eachMessage = async () => {}) {
  const consumers = Array.from({ length: members }, () => createConsumer(group, protocol));
  await Promise.all(
    consumers.map(async (c) => {
      await c.connect();
      await c.subscribe({ topics: [topic] });
      c.run({ eachMessage });
    }),
  );
  await waitFor(async () => (await groupMemberCount(group)) === members, { everyMs: 250 });
  return consumers;
}

test('with more members than partitions, the extra members get nothing', async () => {
  const topic = await createTopic('t-idle', 2);
  const consumers = await startGroup(topic, uniqueGroup('t-idle'), 3, 'eager');
  const assignment = await waitForStableAssignment(consumers, 2);
  assert.deepEqual(assignment.map((p) => p.length).sort(), [0, 1, 1]);
  await Promise.all(consumers.map((c) => c.disconnect()));
  await deleteTopic(topic);
});

test('the consumer protocol (KIP-848) shares partitions evenly', async () => {
  const topic = await createTopic('t-kip848', 4);
  const consumers = await startGroup(topic, uniqueGroup('t-kip848'), 2, 'consumer');
  const assignment = await waitForStableAssignment(consumers, 4, { stableMs: 6000 });
  assert.deepEqual(
    assignment.map((p) => p.length),
    [2, 2],
  );
  await Promise.all(consumers.map((c) => c.disconnect()));
  await deleteTopic(topic);
});

test('messages with the same key are processed in order, even with concurrent partitions', async () => {
  const topic = await createTopic('t-order', 6);
  const messages = [];
  for (let seq = 1; seq <= 100; seq++)
    for (let order = 0; order < 5; order++)
      messages.push({ key: `o${order}`, value: JSON.stringify({ order, seq }) });
  await produce(topic, messages);
  const last = new Map();
  let processed = 0;
  let outOfOrder = 0;
  const group = uniqueGroup('t-order');
  const consumers = Array.from({ length: 2 }, () => createConsumer(group, 'eager'));
  await Promise.all(
    consumers.map(async (c) => {
      await c.connect();
      await c.subscribe({ topics: [topic] });
      c.run({
        partitionsConsumedConcurrently: 3,
        eachMessage: async ({ message }) => {
          const { order, seq } = JSON.parse(message.value);
          await new Promise((resolve) => setImmediate(resolve));
          if (seq < (last.get(order) ?? 0)) outOfOrder++;
          last.set(order, Math.max(seq, last.get(order) ?? 0));
          processed++;
        },
      });
    }),
  );
  await waitFor(() => processed === messages.length);
  assert.equal(outOfOrder, 0);
  await Promise.all(consumers.map((c) => c.disconnect()));
  await deleteTopic(topic);
});

test('a consumer killed mid-run loses nothing: the group processes every message at least once', async () => {
  const topic = await createTopic('t-crash', 3);
  const group = uniqueGroup('t-crash');
  await produce(
    topic,
    Array.from({ length: 1500 }, (_, i) => ({ value: String(i) })),
  );
  const out = path.join(mkdtempSync(path.join(tmpdir(), 't-crash-')), 'processed.txt');
  const lines = () =>
    existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean) : [];
  const worker = new URL('../experiments/delivery-worker.js', import.meta.url).pathname;

  const first = fork(worker, [topic, group, 'auto', out], { stdio: 'ignore' });
  await waitFor(() => lines().length >= 700, { everyMs: 5 });
  first.kill('SIGKILL');
  const second = fork(worker, [topic, group, 'auto', out], { stdio: 'ignore' });
  await waitFor(() => new Set(lines()).size === 1500, { timeoutMs: 90_000 });
  second.kill('SIGTERM');
  await sleep(200);
  assert.equal(new Set(lines()).size, 1500);
  assert.ok(lines().length >= 1500);
  await deleteTopic(topic);
});
