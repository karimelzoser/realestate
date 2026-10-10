import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const explicitlyDisabled = process.env.OTEL_SDK_DISABLED === 'true';
const production = process.env.NODE_ENV === 'production';

if (production && explicitlyDisabled) throw new Error('OTEL_SDK_DISABLED must not disable production telemetry.');
if (production && !endpoint) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT is required in production.');

if (endpoint) {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL.'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  if (production && local) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must not target localhost in production.');
  if (url.username || url.password) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must not embed credentials.');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must use https or http.');
  if (production && url.protocol === 'http:' && process.env.OTEL_EXPORTER_OTLP_INSECURE !== 'true') {
    throw new Error('HTTP OTLP requires OTEL_EXPORTER_OTLP_INSECURE=true in production.');
  }
}

let sdk: NodeSDK | null = null;
let shutdownPromise: Promise<void> | null = null;

if (!explicitlyDisabled && endpoint) {
  process.env.OTEL_SERVICE_NAME ??= process.env.PRENEURA_SERVICE_NAME ?? process.env.npm_package_name ?? 'preneura-runtime';
  process.env.OTEL_TRACES_EXPORTER ??= 'otlp';
  process.env.OTEL_METRICS_EXPORTER ??= 'otlp';
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??= 'http/protobuf';
  process.env.OTEL_METRIC_EXPORT_INTERVAL ??= '15000';
  process.env.OTEL_LOG_LEVEL ??= 'error';

  sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

export async function shutdownObservability(): Promise<void> {
  if (!sdk) return;
  if (shutdownPromise) return shutdownPromise;

  const activeSdk = sdk;
  sdk = null;
  shutdownPromise = activeSdk.shutdown().finally(() => {
    shutdownPromise = null;
  });
  return shutdownPromise;
}

process.once('SIGTERM', () => void shutdownObservability());
process.once('SIGINT', () => void shutdownObservability());
