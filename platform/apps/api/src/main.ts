import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { assertApiRuntimeConfiguration } from './runtime-config.js';

async function bootstrap(): Promise<void> {
  assertApiRuntimeConfiguration();

  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV !== 'test',
    trustProxy: true,
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
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
