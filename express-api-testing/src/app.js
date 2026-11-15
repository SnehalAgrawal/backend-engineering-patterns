import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapi } from './docs/openapi.js';
import { errorHandler, notFound } from './errors.js';
import posts from './routes/posts.js';
import users from './routes/users.js';

/**
 * Build the Express app. No database connection and no listening port: tests import this directly,
 * and src/server.js does the connecting and listening.
 */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/users', users);
  app.use('/api/posts', posts);
  app.get('/api/docs.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
