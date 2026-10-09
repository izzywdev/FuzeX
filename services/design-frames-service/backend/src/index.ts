#!/usr/bin/env node
// index.ts — bootstrap for the isolated Postgres lifecycle tier. Listens on
// its OWN port (DESIGN_FRAMES_PG_PORT, default 4410) — deliberately
// different from ../server.js's DESIGN_FRAMES_PORT (4400) so both can run
// side by side during rollout (docs/postgres-tier.md "Migration path").

import { createApp } from './app';
import { logger } from './lib/logger';
import { closePool } from './lib/db';
import { startOutboxRelay } from './events/outboxRelay';
import { startLifecycleConsumer, type LifecycleConsumer } from './events/lifecycle';

const PORT = parseInt(process.env.DESIGN_FRAMES_PG_PORT || '', 10) || 4410;
const HOST = process.env.DESIGN_FRAMES_HOST || '0.0.0.0';

export function start() {
  const app = createApp();
  let stopOutboxRelay: (() => Promise<void>) | null = null;
  void startOutboxRelay().then((stop) => { stopOutboxRelay = stop; }).catch((err) => logger.error({ err }, 'FuzeX event outbox relay failed to start'));
  const server = app.listen(PORT, HOST, () => {
    logger.info({ port: PORT, host: HOST }, 'design-frames-service (Postgres lifecycle tier) listening');
  });

  let lifecycle: LifecycleConsumer | null = null;
  startLifecycleConsumer()
    .then((consumer) => {
      lifecycle = consumer;
      logger.info({ enabled: Boolean(consumer) }, 'FuzeFront lifecycle event consumer startup complete');
    })
    .catch((err) => logger.error({ err }, 'failed to start FuzeFront lifecycle event consumer'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      Promise.all([Promise.resolve(stopOutboxRelay?.()), Promise.resolve(lifecycle?.disconnect())])
        .catch((err) => logger.error({ err }, 'error stopping FuzeX event relays'))
        .then(() => closePool())
        .catch((err) => logger.error({ err }, 'error closing pg pool'))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  start();
}
