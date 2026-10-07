import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  currentTelemetryIdentity,
  initializeObservability,
  shutdownObservability,
} from '@preneura/observability';

initializeObservability('preneura-api');

async function bootstrap(): Promise<void> {
  const [
    { default: cookie },
    { default: helmet },
    { default: rateLimit },
    { NestFactory },
    { FastifyAdapter },
    { AppModule },
    { validateApiRuntimeConfig },
  ] = await Promise.all([
    import('@fastify/cookie'),
    import('@fastify/helmet'),
    import('@fastify/rate-limit'),
    import('@nestjs/core'),
    import('@nestjs/platform-fastify'),
    import('./app.module.js'),
    import('./config/runtime-config.js'),
  ]);

  validateApiRuntimeConfig();

  const logger =
    process.env.NODE_ENV === 'test'
      ? false
      : {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers.set-cookie',
              'headers.authorization',
              'headers.cookie',
            ],
            censor: '[REDACTED]',
          },
          mixin: () => currentTelemetryIdentity(),
        };

  const adapter = new FastifyAdapter({
    logger,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: (request) => {
      const supplied = request.headers['x-request-id'];
      return typeof supplied === 'string' && isSafeRequestId(supplied) ? supplied : randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  const cookieSigningSecret = process.env.COOKIE_SIGNING_SECRET;
  const fastify = app.getHttpAdapter().getInstance();
  const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOriginSet = new Set(allowedOrigins);

  await app.register(cookie, cookieSigningSecret ? { secret: cookieSigningSecret } : {});
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: parsePositiveInteger(process.env.API_RATE_LIMIT_PER_MINUTE, 300),
    timeWindow: '1 minute',
    allowList: (request) => request.url.startsWith('/v1/health'),
  });

  fastify.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('cache-control', 'no-store');

    if (!isUnsafeMethod(request.method)) return;
    const sessionCookieName =
      process.env.SESSION_COOKIE_NAME ??
      (process.env.NODE_ENV === 'production' ? '__Host-preneura_session' : 'preneura_session');
    if (!request.cookies[sessionCookieName]) return;

    const origin = request.headers.origin;
    if (!origin || !allowedOriginSet.has(origin)) {
      reply.code(403).send({ statusCode: 403, message: 'Request origin is not allowed.' });
    }
  });

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  fastify.addHook('onClose', async () => shutdownObservability());

  const port = Number(process.env.PORT ?? 4100);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  await app.listen({ port, host: '0.0.0.0' });
}

function isUnsafeMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function isSafeRequestId(value: string): boolean {
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

void bootstrap();
