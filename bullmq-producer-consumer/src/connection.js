// Redis connection for every queue and worker. BullMQ 6 loads ioredis (an optional peer dependency) for plain options.
export const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6380),
  // Workers block on Redis while waiting for jobs; ioredis must not give up on those calls
  maxRetriesPerRequest: null,
};
