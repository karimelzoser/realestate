import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  annotateActiveSpan,
  createLogger,
  recordHttpRequest,
  resolveCorrelationId,
} from '@preneura/observability';
import { AppModule } from './app.module.js';
import { validateApiRuntimeConfig } from './config/runtime-config.js';
import {
  registerHttpSecurity,
  resolveApiBodyLimit,
  resolveTrustProxy,
} from './security/http-security.js';

async function bootstrap(): Promise<void> {
  validateApiRuntimeConfig();

  const logger = createLogger('preneura-api');
  const requestStartedAt = new WeakMap<object, number>();
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    disableRequestLogging: true,
    trustProxy: resolveTrustProxy(),
    bodyLimit: resolveApiBodyLimit(),
    requestIdHeader: false,
    genReqId: (request) => resolveCorrelationId(request.headers['x-request-id']),
  });
  const fastify = adapter.getInstance();

  fastify.addHook('onRequest', (request, reply, done) => {
    requestStartedAt.set(request, performance.now());
    reply.header('x-request-id', request.id);
    annotateActiveSpan({ 'preneura.request.id': request.id });
    done();
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    const startedAt = requestStartedAt.get(request) ?? performance.now();
    const durationMs = Math.max(0, performance.now() - startedAt);
    const route = request.routeOptions.url || 'unmatched';
    recordHttpRequest({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs,
    });
    logger.info({
      event: 'http.request.completed',
      requestId: request.id,
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: Math.round(durationMs),
    });
    done();
  });

  registerHttpSecurity(fastify);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  const cookieSigningSecret = process.env.COOKIE_SIGNING_SECRET;

  await app.register(cookie, cookieSigningSecret ? { secret: cookieSigningSecret } : {});

  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4100);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ event: 'api.started', port });
}

void bootstrap();
