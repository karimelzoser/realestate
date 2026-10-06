const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const explicitlyDisabled = process.env.OTEL_SDK_DISABLED === 'true';

if (!explicitlyDisabled && endpoint) {
  process.env.OTEL_SERVICE_NAME ??= process.env.PRENEURA_SERVICE_NAME ?? process.env.npm_package_name ?? 'preneura-runtime';
  process.env.OTEL_TRACES_EXPORTER ??= 'otlp';
  process.env.OTEL_METRICS_EXPORTER ??= 'otlp';
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??= 'http/protobuf';
  process.env.OTEL_METRIC_EXPORT_INTERVAL ??= '15000';
  process.env.OTEL_LOG_LEVEL ??= 'error';
  await import('@opentelemetry/auto-instrumentations-node/register');
}
