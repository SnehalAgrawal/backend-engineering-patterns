// 2. What a rebalance costs, per protocol. 12 partitions, a producer sending 200 messages/s, 3 consumers.
// A 4th consumer joins, then leaves cleanly. Around each event we measure:
// - settle time: from the event until the assignment stopped changing
// - longest pause: the longest stretch in which no member of the group processed a message
// - worst latency: the highest send-to-process latency of any message, against steady state (p99)
// - who paid: how many partitions had a gap of more than 250 ms, and how many messages took more than 500 ms
import {
  PROTOCOLS,
  createConsumer,
  createTopic,
  deleteTopic,
  groupMemberCount,
  kafka,
  uniqueGroup,
} from '../src/kafka.js';
import { percentile, sleep, waitFor, waitForStableAssignment } from '../src/helpers.js';

const PARTITIONS = 12;
const RATE = 200; // messages per second
const STABLE_MS = 6000; // longer than one heartbeat under either protocol
const protocols = process.argv[2] ? [process.argv[2]] : PROTOCOLS;

async function measure(protocol) {
  const topic = await createTopic('rebalance', PARTITIONS);
  const group = uniqueGroup(`rebalance-${protocol}`);
  const processed = []; // { at, latency, partition }

  const producer = kafka.producer();
  await producer.connect();
  let seq = 0;
  const sending = setInterval(() => {
    // Partitions in strict rotation: every partition gets a message about every 60 ms, so a gap of
    // 250 ms or more on a partition comes from the rebalance, not from uneven traffic
    const messages = Array.from({ length: RATE / 50 }, () => ({
      partition: seq % PARTITIONS,
      value: JSON.stringify({ seq: seq++, sentAt: Date.now() }),
    }));
    producer.send({ topic, messages }).catch(() => {});
  }, 20);

  const start = async () => {
    const consumer = createConsumer(group, protocol);
    await consumer.connect();
    await consumer.subscribe({ topics: [topic] });
    consumer.run({
      eachMessage: async ({ partition, message }) => {
        const now = Date.now();
        processed.push({ at: now, latency: now - JSON.parse(message.value).sentAt, partition });
      },
    });
    return consumer;
  };

  const members = await Promise.all([start(), start(), start()]);
  await waitFor(async () => (await groupMemberCount(group)) === 3, { everyMs: 250 });
  await waitForStableAssignment(members, PARTITIONS, { stableMs: STABLE_MS });
  await sleep(3000);
  const baseline = processed.filter((p) => p.at > Date.now() - 8000).map((p) => p.latency);

  const window = async (
    label,
    action,
    expectedMembers,
    activeMembers,
    membersBefore = activeMembers().filter(Boolean),
  ) => {
    const before = JSON.stringify(membersBefore.map((c) => c.assignment().length));
    const eventAt = Date.now();
    await action();
    await waitFor(async () => (await groupMemberCount(group)) === expectedMembers, {
      everyMs: 100,
    });
    await waitForStableAssignment(activeMembers(), PARTITIONS, { stableMs: STABLE_MS });
    const settledAt = Date.now() - STABLE_MS;
    await sleep(2000);
    const inWindow = processed.filter((p) => p.at >= eventAt && p.at <= settledAt + 2000);
    let longestPause = 0;
    let previous = eventAt;
    for (const p of inWindow) {
      longestPause = Math.max(longestPause, p.at - previous);
      previous = p.at;
    }
    // Per partition: the longest gap between messages processed in the window (starting from the event)
    const lastSeen = new Map();
    const partitionGap = new Map();
    for (const p of inWindow) {
      const gap = p.at - (lastSeen.get(p.partition) ?? eventAt);
      partitionGap.set(p.partition, Math.max(partitionGap.get(p.partition) ?? 0, gap));
      lastSeen.set(p.partition, p.at);
    }
    return {
      label,
      partitionsDelayed: [...partitionGap.values()].filter((gap) => gap > 250).length,
      slowMessages: inWindow.filter((p) => p.latency > 500).length,
      messages: inWindow.length,
      settleMs: settledAt - eventAt,
      longestPauseMs: longestPause,
      worstLatencyMs: Math.max(...inWindow.map((p) => p.latency)),
      partitions: `${before} -> ${JSON.stringify(activeMembers().map((c) => c.assignment().length))}`,
    };
  };

  let fourth;
  const results = [];
  results.push(
    await window(
      'a 4th member joins',
      async () => {
        fourth = await start();
      },
      4,
      () => [...members, fourth],
    ),
  );
  results.push(
    await window(
      'the 4th member leaves',
      async () => fourth.disconnect(),
      3,
      () => members,
      [...members, fourth],
    ),
  );

  clearInterval(sending);
  await Promise.all(members.map((c) => c.disconnect()));
  await producer.disconnect();
  await deleteTopic(topic);
  return { baselineP50: percentile(baseline, 50), baselineP99: percentile(baseline, 99), results };
}

console.log(
  `${PARTITIONS} partitions, ${RATE} messages/s, 3 consumers; one more joins, then leaves.\n`,
);
for (const protocol of protocols) {
  const { baselineP50, baselineP99, results } = await measure(protocol);
  console.log(`${protocol}: steady-state latency p50 ${baselineP50} ms, p99 ${baselineP99} ms`);
  for (const r of results) {
    console.log(
      `  ${r.label.padEnd(22)} settled after ${String(r.settleMs).padStart(5)} ms | longest pause ${String(r.longestPauseMs).padStart(5)} ms | ` +
        `worst latency ${String(r.worstLatencyMs).padStart(5)} ms | partitions with a gap > 250 ms: ${String(r.partitionsDelayed).padStart(2)} of ${PARTITIONS} | ` +
        `messages > 500 ms: ${r.slowMessages} of ${r.messages} | partitions per member ${r.partitions}`,
    );
  }
}
