import { context, isSpanContextValid, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;
let serviceName: string | undefined;

export interface TelemetryIdentity {
  traceId?: string;
  spanId?: string;
}

export function initializeObservability(name: string): void {
  if (sdk || process.env.OTEL_SDK_DISABLED === 'true') return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!endpoint) return;

  serviceName = name;
  process.env.OTEL_SERVICE_NAME ??= name;

  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: endpoint,
      timeoutMillis: parsePositiveInteger(process.env.OTEL_EXPORTER_OTLP_TIMEOUT_MS, 10_000),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

export async function shutdownObservability(): Promise<void> {
  const activeSdk = sdk;
  sdk = undefined;
  if (!activeSdk) return;
  await activeSdk.shutdown();
}

export function currentTelemetryIdentity(): TelemetryIdentity {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const spanContext = span.spanContext();
  if (!isSpanContextValid(spanContext)) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export async function withObservedSpan<T>(
  spanName: string,
  attributes: Attributes,
  task: () => Promise<T>,
): Promise<T> {
  if (!serviceName) return task();
  const tracer = trace.getTracer(serviceName);
  return tracer.startActiveSpan(spanName, { attributes }, async (span) => {
    try {
      const result = await task();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
