import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { annotateActiveSpan, requestIdFromHeader } from '@preneura/observability';
import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { AppModule } from './app.module.js';
import { assertApiRuntimeConfiguration } from './runtime-config.js';

async function bootstrap(): Promise<void> {
  assertApiRuntimeConfiguration();

  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV === 'test'
      ? false
      : {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers.set-cookie',
              'authorization',
              'cookie',
              'password',
              'token',
              'otp',
              'nationalId',
              'phone',
              'email',
            ],
            censor: '[REDACTED]',
          },
        },
    trustProxy: true,
    genReqId: (request: IncomingMessage | Http2ServerRequest) =>
      requestIdFromHeader(request.headers['x-request-id']),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  const cookieSigningSecret = process.env.COOKIE_SIGNING_SECRET;

  await app.register(cookie, cookieSigningSecret ? { secret: cookieSigningSecret } : {});

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    annotateActiveSpan({ 'preneura.request_id': request.id });
    done();
  });

  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 4100);
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
