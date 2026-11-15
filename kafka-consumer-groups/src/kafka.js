// Kafka client setup with Confluent's client (librdkafka) through its KafkaJS-compatible API.
import confluent from '@confluentinc/kafka-javascript';

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

/** Number of members the broker currently counts in a consumer group. */
export async function groupMemberCount(groupId) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const { groups } = await admin.describeGroups([groupId]);
    return groups[0]?.members?.length ?? 0;
  } finally {
    await admin.disconnect();
  }
}
