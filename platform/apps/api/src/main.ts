import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import { validateApiRuntimeConfig } from './config/runtime-config.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

async function bootstrap(): Promise<void> {
  validateApiRuntimeConfig();

  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV !== 'test',
    trustProxy: true,
    genReqId: (request: FastifyRequest) => {
      const incoming = request.headers['x-request-id'];
      if (typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)) return incoming;
      return randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  const cookieSigningSecret = process.env.COOKIE_SIGNING_SECRET;

  fastify.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

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
