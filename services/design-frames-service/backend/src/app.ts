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

  // CORS — the Fuze family serves this API SAME-ORIGIN (FuzeFront's
  // no-cross-origin-base rule), so no CORS header is needed by default. When a
  // deployment genuinely needs cross-origin access, ALLOWED_ORIGINS (a literal,
  // comma-separated allowlist) is the ONLY way to grant it. The request Origin
  // is never reflected blindly — the header value is taken from the matched
  // allowlist entry, not from req.headers (CWE-942 CORS misconfiguration).
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqOrigin = req.headers['origin'];
    const allowed =
      typeof reqOrigin === 'string' ? allowedOrigins.find((o) => o === reqOrigin) : undefined;
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', allowed);
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
