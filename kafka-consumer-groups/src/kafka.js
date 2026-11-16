// Kafka client setup with Confluent's client (librdkafka) through its KafkaJS-compatible API.
import confluent from '@confluentinc/kafka-javascript';
import { waitFor } from './helpers.js';

const { Kafka, PartitionAssigners, logLevel } = confluent.KafkaJS;
export const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9192').split(',');
export const kafka = new Kafka({ kafkaJS: { brokers: BROKERS, logLevel: logLevel.ERROR } });

/**
 * The three ways a consumer group can rebalance:
 * - eager:       classic protocol, round-robin; every member gives up all partitions on each rebalance
 * - cooperative: classic protocol, cooperative-sticky; only the partitions that move are revoked
 * - consumer:    Kafka 4's consumer protocol (KIP-848); the broker assigns partitions incrementally
 */
export const PROTOCOLS = ['eager', 'cooperative', 'consumer'];

export function createConsumer(groupId, protocol = 'eager', options = {}) {
  const kafkaJS = { groupId, fromBeginning: true, ...options };
  if (protocol === 'consumer') return kafka.consumer({ 'group.protocol': 'consumer', kafkaJS });
  const assigner =
    protocol === 'cooperative'
      ? PartitionAssigners.cooperativeSticky
      : PartitionAssigners.roundRobin;
  return kafka.consumer({ kafkaJS: { ...kafkaJS, partitionAssigners: [assigner] } });
}

/** A new topic with a unique name and the given number of partitions. */
export async function createTopic(label, numPartitions) {
  const topic = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({ topics: [{ topic, numPartitions, replicationFactor: 1 }] });
  await admin.disconnect();
  return topic;
}

export async function deleteTopic(topic) {
  const admin = kafka.admin();
  await admin.connect();
  await admin.deleteTopics({ topics: [topic] });
  await admin.disconnect();
}

export const uniqueGroup = (label) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Wait until the broker's group coordinator is ready: a throwaway consumer joins a throwaway group and
 * gets its partition. On a fresh broker, the first group request creates __consumer_offsets, and until its
 * partitions are loaded, describeGroups returns a per-group error. In client 1.11.0 the native code then
 * reads a NULL string and the process crashes with SIGSEGV instead of rejecting
 * (confluentinc/confluent-kafka-javascript#531). A consumer's join retries that error safely.
 *
 * A consumer that subscribes before the new topic reaches its metadata gets no partition until the next
 * metadata refresh (minutes), so each attempt uses a fresh consumer and gives up after `perAttemptMs`.
 * Admin metadata calls are avoided on purpose: they may share describeGroups' unguarded error path.
 */
export async function waitForGroupCoordinator({ attempts = 6, perAttemptMs = 10_000 } = {}) {
  const topic = await createTopic('warm-up', 1);
  try {
    for (let attempt = 1; ; attempt++) {
      const consumer = createConsumer(uniqueGroup('warm-up'));
      try {
        await consumer.connect();
        await consumer.subscribe({ topics: [topic] });
        consumer.run({ eachMessage: async () => {} });
        await waitFor(() => consumer.assignment().length > 0, {
          everyMs: 100,
          timeoutMs: perAttemptMs,
        });
        return attempt;
      } catch (error) {
        if (attempt >= attempts) throw error;
      } finally {
        await consumer.disconnect();
      }
    }
  } finally {
    await deleteTopic(topic);
  }
}

let coordinatorReady;

/** Number of members the broker currently counts in a consumer group. */
export async function groupMemberCount(groupId) {
  // Once per process, before the first describeGroups; a failed warm-up is not cached, so the next call retries
  coordinatorReady ??= waitForGroupCoordinator().catch((error) => {
    coordinatorReady = undefined;
    throw error;
  });
  await coordinatorReady;
  const admin = kafka.admin();
  await admin.connect();
  try {
    const { groups } = await admin.describeGroups([groupId]);
    return groups[0]?.members?.length ?? 0;
  } finally {
    await admin.disconnect();
  }
}
