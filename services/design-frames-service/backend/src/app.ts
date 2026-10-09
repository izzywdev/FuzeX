// app.ts — assembles the isolated Express app. SEPARATE from ../server.js;
// mountable/runnable alongside it (docs/postgres-tier.md step 3).

import express, { type NextFunction, type Request, type Response } from 'express';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { ClientConfig, QueryConfig } from 'pg';
import { requestLogger } from './lib/logger';
import { getPool } from './lib/db';
import { DATA_DIR, getFrame } from './lib/fileStore';
import { requireAuthForWrites } from './middleware/auth';
import { errorHandler } from './lib/errors';
import { projectsRouter } from './routes/projects';
import { featuresRouter } from './routes/features';
import { discussionsRouter, featureDiscussionsRouter } from './routes/discussions';
import { generationsRouter } from './routes/generations';
import { artifactBundlesRouter, artifactBundlePreviewRouter } from './routes/artifactBundles';

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
  // Liveness above stays independent of external dependencies. Readiness must
  // fail if the schema or durable content volume is unavailable, so Kubernetes
  // stops routing reviews to a process that cannot retain their evidence.
  app.get('/ready', async (_req, res) => {
    try {
      // pg supports query_timeout per query at runtime, while @types/pg
      // currently declares it only on ClientConfig.
      const readinessQuery: QueryConfig & Pick<ClientConfig, 'query_timeout'> = {
        text: 'SELECT id FROM design_frames.project LIMIT 0',
        query_timeout: 2000,
      };
      await Promise.all([
        getPool().query(readinessQuery),
        mkdir(DATA_DIR, { recursive: true }).then(() => access(DATA_DIR, constants.R_OK | constants.W_OK)),
      ]);
      res.status(200).json({ status: 'ready' });
    } catch {
      // Connection strings and filesystem paths never leave the health boundary.
      res.status(503).json({ status: 'not ready' });
    }
  });

  // Serve a hosted preview only through the content store's slug/file
  // validation. Exposing DATA_DIR through express.static would leak internal
  // revision artifacts and bypass traversal protections. The MFE renders this
  // endpoint in a sandboxed iframe; this policy adds defense in depth.
  app.get('/site/:slug/:file', async (req, res, next) => {
    try {
      const html = await getFrame(req.params.slug, decodeURIComponent(req.params.file));
      res
        .status(200)
        .type('html')
        .setHeader(
          'Content-Security-Policy',
          "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data: https:; base-uri 'none'; form-action 'none'"
        )
        .send(html);
    } catch (error) {
      next(error);
    }
  });

  app.use(requireAuthForWrites);

  app.use('/api/v1/features', featureDiscussionsRouter); // GET /:slug/discussions convenience, matched first
  app.use('/api/v1/features', generationsRouter);
  app.use('/api/v1/features', featuresRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/projects/:id/artifact-bundles', artifactBundlesRouter);
  app.use('/api/v1/artifact-bundles', artifactBundlePreviewRouter);
  app.use('/api/v1/discussions', discussionsRouter);

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'not found' }));
  app.use(errorHandler);

  return app;
}
