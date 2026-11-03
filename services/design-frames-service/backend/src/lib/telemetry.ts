// telemetry.ts — OpenTelemetry bootstrap (observability standard P25/P27).
// Imported FIRST by index.ts so instrumentation patches http/express/pg before
// they load. Endpoint, protocol and sampling come from OTEL_* env
// (OTEL_EXPORTER_OTLP_ENDPOINT etc.); nothing is hardcoded here.

import { initTelemetry } from '@izzywdev/fuzefront-telemetry';

export const telemetry = initTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? process.env.SERVICE_NAME ?? 'design-frames-service-pg',
  serviceVersion: process.env.npm_package_version,
});
