// Consumer for delivery.js, run as a child process so it can be killed mid-run.
// Appends each processed message id to a file. Arguments: topic, group, commit mode ("auto" or "each"), output file.
import { appendFileSync } from 'node:fs';
import { createConsumer } from '../src/kafka.js';

const [topic, group, mode, outFile] = process.argv.slice(2);
const consumer = createConsumer(group, 'eager', mode === 'auto' ? {} : { autoCommit: false });
await consumer.connect();
await consumer.subscribe({ topics: [topic] });
await consumer.run({
  eachMessage: async ({ partition, message }) => {
    appendFileSync(outFile, `${message.value}\n`); // the "side effect" of processing
    if (mode === 'each') {
      await consumer.commitOffsets([
        { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
      ]);
    }
  },
});
