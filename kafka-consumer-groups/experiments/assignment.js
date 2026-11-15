// 1. How partitions are shared out: one topic with 6 partitions, consumer groups of 1, 2, 3, 6, and 8 members.
import {
  PROTOCOLS,
  createConsumer,
  createTopic,
  deleteTopic,
  groupMemberCount,
  uniqueGroup,
} from '../src/kafka.js';
import { waitFor, waitForStableAssignment } from '../src/helpers.js';

const PARTITIONS = 6;
const protocols = process.argv[2] ? [process.argv[2]] : ['eager', 'consumer'];

for (const protocol of protocols.filter((p) => PROTOCOLS.includes(p))) {
  console.log(`\n${protocol} protocol, topic with ${PARTITIONS} partitions`);
  console.log('members   partitions per member            idle members');
  for (const members of [1, 2, 3, 6, 8]) {
    const topic = await createTopic('assignment', PARTITIONS);
    const group = uniqueGroup('assignment');
    const consumers = Array.from({ length: members }, () => createConsumer(group, protocol));
    await Promise.all(
      consumers.map(async (consumer) => {
        await consumer.connect();
        await consumer.subscribe({ topics: [topic] });
        consumer.run({ eachMessage: async () => {} });
      }),
    );
    // Wait until the broker counts every member, then until the assignment stops changing
    await waitFor(async () => (await groupMemberCount(group)) === members, { everyMs: 250 });
    // 6 s without a change: longer than one heartbeat (5 s by default under the consumer protocol)
    const assignment = await waitForStableAssignment(consumers, PARTITIONS, { stableMs: 6000 });
    const counts = assignment.map((partitions) => partitions.length);
    console.log(
      `${String(members).padStart(7)}   ${JSON.stringify(assignment).padEnd(32)} ${counts.filter((n) => n === 0).length}`,
    );
    await Promise.all(consumers.map((c) => c.disconnect()));
    await deleteTopic(topic);
  }
}
