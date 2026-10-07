import type { FastifyInstance } from 'fastify';

const DEFAULT_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const MIN_BODY_LIMIT_BYTES = 64 * 1024;
const MAX_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

type TrustProxyResolver = false | ((address: string, hop: number) => boolean);

export function resolveApiBodyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.API_BODY_LIMIT_BYTES?.trim();
  if (!raw) return DEFAULT_BODY_LIMIT_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_BODY_LIMIT_BYTES || parsed > MAX_BODY_LIMIT_BYTES) {
    throw new Error(
      `API_BODY_LIMIT_BYTES must be an integer between ${MIN_BODY_LIMIT_BYTES} and ${MAX_BODY_LIMIT_BYTES}.`,
    );
  }
  return parsed;
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): TrustProxyResolver {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return false;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 1 and 10.');
  }
  return (_address: string, hop: number): boolean => hop < parsed;
}

export function registerHttpSecurity(instance: FastifyInstance): void {
  instance.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  instance.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    reply.header('x-dns-prefetch-control', 'off');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}
