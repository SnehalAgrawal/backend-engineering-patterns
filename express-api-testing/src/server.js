import mongoose from 'mongoose';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://localhost:27018/express_api';

await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 5000 });
const server = createApp().listen(port, () => {
  console.log(`API on http://localhost:${port} (docs: /api/docs, MongoDB: ${mongoUrl})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  });
}
