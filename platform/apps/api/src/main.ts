import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { annotateActiveSpan } from '@preneura/observability';
import { AppModule } from './app.module.js';
import { validateApiRuntimeConfig } from './config/runtime-config.js';
import {
  registerHttpSecurity,
  resolveApiBodyLimit,
  resolveTrustProxy,
} from './security/http-security.js';

async function bootstrap(): Promise<void> {
  validateApiRuntimeConfig();

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
    trustProxy: resolveTrustProxy(),
    bodyLimit: resolveApiBodyLimit(),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  registerHttpSecurity(adapter.getInstance());
  adapter.getInstance().addHook('onRequest', async (request) => {
    annotateActiveSpan({
      'preneura.request_id': request.id,
      'http.request.method': request.method,
      'url.path': request.url,
    });
  });

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
}

void bootstrap();
