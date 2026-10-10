import { randomUUID } from 'node:crypto';
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import pino, { type Logger } from 'pino';

const REDACT_PATHS = [
  'authorization','cookie','set-cookie','password','secret','token','otp','nationalId','national_id','phone','email','destination','contact','contactValue','accessToken','clientSecret',
  'req.headers.authorization','req.headers.cookie','req.headers["set-cookie"]','res.headers["set-cookie"]',
  '*.authorization','*.cookie','*.password','*.secret','*.token','*.otp','*.nationalId','*.national_id','*.phone','*.email','*.destination',
];

const meter = metrics.getMeter('preneura-runtime', '1.0.0');
const tracer = trace.getTracer('preneura-runtime', '1.0.0');

const httpRequests = meter.createCounter('preneura.api.http.requests', {
  description: 'Completed PRENEURA API requests.',
  unit: '{request}',
});
const httpDuration = meter.createHistogram('preneura.api.http.duration', {
  description: 'PRENEURA API request duration.',
  unit: 'ms',
});
const readinessFailures = meter.createCounter('preneura.api.readiness.failures', {
  description: 'Failed API readiness checks.',
  unit: '{failure}',
});
const workerLoopDuration = meter.createHistogram('preneura.worker.loop.duration', {
  description: 'Worker loop execution duration.',
  unit: 'ms',
});
const workerLoopProcessed = meter.createCounter('preneura.worker.loop.processed', {
  description: 'Records processed by worker loops.',
  unit: '{record}',
});
const workerLoopFailures = meter.createCounter('preneura.worker.loop.failures', {
  description: 'Failed worker loop executions.',
  unit: '{failure}',
});
const workerLoopRuns = meter.createCounter('preneura.worker.loop.runs', {
  description: 'Worker loop executions, including empty successful runs.',
  unit: '{run}',
});

export function createLogger(service: string, bindings: Record<string, unknown> = {}): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service, environment: process.env.NODE_ENV ?? 'development', ...bindings },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const context = span.spanContext();
      return context.traceId && context.spanId ? { traceId: context.traceId, spanId: context.spanId } : {};
    },
  });
}

export function createRequestId(): string {
  return randomUUID();
}

export function annotateActiveSpan(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  for (const [key, value] of Object.entries(attributes)) span.setAttribute(key, value);
}

export async function withRuntimeSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  operation: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setAttribute('error.type', error instanceof Error ? error.name : 'UnknownError');
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'runtime operation failed' });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function recordHttpRequest(input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const attributes = {
    'http.request.method': input.method,
    'http.route': input.route,
    'http.response.status_code_class': `${Math.floor(input.statusCode / 100)}xx`,
  };
  httpRequests.add(1, attributes);
  httpDuration.record(input.durationMs, attributes);
}

export function recordReadinessFailure(code: string): void {
  readinessFailures.add(1, { 'preneura.readiness.code': boundedLabel(code) });
}

export function recordWorkerLoop(input: {
  loop: string;
  durationMs: number;
  processed: number;
  success: boolean;
}): void {
  const attributes = { 'preneura.worker.loop': boundedLabel(input.loop) };
  workerLoopRuns.add(1, attributes);
  workerLoopDuration.record(input.durationMs, attributes);
  if (input.processed > 0) workerLoopProcessed.add(input.processed, attributes);
  if (!input.success) workerLoopFailures.add(1, attributes);
}

export function safeErrorType(error: unknown): string {
  return error instanceof Error ? boundedLabel(error.name || 'Error') : 'UnknownError';
}

function boundedLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80) || 'unknown';
}
