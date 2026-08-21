// app.ts — assembles the isolated Express app. SEPARATE from ../server.js;
// mountable/runnable alongside it (docs/postgres-tier.md step 3).

import express, { type NextFunction, type Request, type Response } from 'express';
import { requestLogger } from './lib/logger';
import { requireAuthForWrites } from './middleware/auth';
import { errorHandler } from './lib/errors';
import { projectsRouter } from './routes/projects';
import { featuresRouter } from './routes/features';
import { discussionsRouter, featureDiscussionsRouter } from './routes/discussions';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // CORS — mirrors ../server.js's convention (reflect Origin; reads are
  // public, writes still require the bearer token below).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers['origin'];
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => res.status(200).json({ status: 'healthy', timestamp: Date.now() }));

  app.use(requireAuthForWrites);

  app.use('/api/v1/features', featureDiscussionsRouter); // GET /:slug/discussions convenience, matched first
  app.use('/api/v1/features', featuresRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/discussions', discussionsRouter);

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler);

  return app;
}
