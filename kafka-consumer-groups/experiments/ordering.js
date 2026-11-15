// 4. Ordering: 20 orders, each with 300 numbered updates (6,000 messages), consumed by 3 members that each
// process up to 3 partitions at once. With the order id as the message key, all updates of an order go to one
// partition, which Kafka delivers in order. Without a key, an order's updates are spread over partitions.
import { createConsumer, createTopic, deleteTopic, kafka, uniqueGroup } from '../src/kafka.js';
import { waitFor } from '../src/helpers.js';

const ORDERS = 20;
const UPDATES = 300;

async function run(keyed) {
  const topic = await createTopic('ordering', 6);
  const group = uniqueGroup('ordering');
  const producer = kafka.producer();
  await producer.connect();
  // Updates interleaved across orders, in sequence: order 0 update 1, order 1 update 1, ..., order 0 update 2, ...
  const all = [];
  for (let seq = 1; seq <= UPDATES; seq++) {
    for (let order = 0; order < ORDERS; order++) {
      all.push({
        ...(keyed ? { key: `order-${order}` } : {}),
        value: JSON.stringify({ order, seq }),
      });
    }
  }
  for (let i = 0; i < all.length; i += 500)
    await producer.send({ topic, messages: all.slice(i, i + 500) });
  await producer.disconnect();

  const lastSeq = new Map();
  let processed = 0;
  let outOfOrder = 0;
  const consumers = Array.from({ length: 3 }, () => createConsumer(group, 'eager'));
  await Promise.all(
    consumers.map(async (consumer) => {
      await consumer.connect();
      await consumer.subscribe({ topics: [topic] });
      consumer.run({
        partitionsConsumedConcurrently: 3,
        eachMessage: async ({ message }) => {
          const { order, seq } = JSON.parse(message.value);
          await new Promise((resolve) => setImmediate(resolve)); // a little async work, as a real handler would do
          if (seq < (lastSeq.get(order) ?? 0)) outOfOrder++;
          lastSeq.set(order, Math.max(seq, lastSeq.get(order) ?? 0));
          processed++;
        },
      });
    }),
  );
  await waitFor(() => processed === ORDERS * UPDATES, { timeoutMs: 120_000 });
  await Promise.all(consumers.map((c) => c.disconnect()));
  await deleteTopic(topic);
  return { processed, outOfOrder };
}

console.log(
  `${ORDERS} orders x ${UPDATES} updates on 6 partitions; 3 consumers, each processing up to 3 partitions concurrently.\n`,
);
console.log(
  'message key        processed   updates that arrived after a later update of the same order',
);
for (const keyed of [true, false]) {
  const { processed, outOfOrder } = await run(keyed);
  console.log(
    `${(keyed ? 'order id' : 'none').padEnd(18)} ${String(processed).padStart(9)}   ${outOfOrder}`,
  );
}
