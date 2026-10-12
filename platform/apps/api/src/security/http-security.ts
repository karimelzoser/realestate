import type { FastifyInstance } from 'fastify';

export function safeRequestLog(request: unknown) {
  const record = request && typeof request === 'object'
    ? request as { id?: unknown; method?: unknown; url?: unknown }
    : {};
  return {
    id: typeof record.id === 'string' ? record.id : '',
    method: typeof record.method === 'string' ? record.method : 'UNKNOWN',
    url: typeof record.url === 'string' ? record.url.split('?')[0] ?? '/' : '/',
  };
}

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
  // Fastify provides the remote address plus hop index. Trust only the explicitly
  // configured proxy chain; the next hop is treated as the client boundary.
  return (_address: string, hop: number): boolean => hop < parsed;
}

export function trustedMutationOrigin(
  method: string,
  headers: { origin?: string | string[] | undefined; referer?: string | string[] | undefined; cookie?: string | undefined },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  const allowed = new Set((env.WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((value) => value.trim()));
  const cookieName = env.SESSION_COOKIE_NAME ?? 'preneura_session';
  const hasSessionCookie = headers.cookie?.split(';').some((part) => part.split('=',1)[0]?.trim() === cookieName) ?? false;
  if (headers.origin !== undefined) {
    if (typeof headers.origin !== 'string') return false;
    try {
      const url = new URL(headers.origin);
      return ['https:', 'http:'].includes(url.protocol) && url.origin === headers.origin && allowed.has(url.origin);
    } catch { return false; }
  }
  if (!hasSessionCookie) return true; // Provider/machine calls still require their own bearer/signature authorization.
  if (typeof headers.referer !== 'string') return false;
  try {
    const url = new URL(headers.referer);
    return !url.username && !url.password && ['https:', 'http:'].includes(url.protocol) && allowed.has(url.origin);
  } catch { return false; }
}

export function registerHttpSecurity(instance: FastifyInstance, env: NodeJS.ProcessEnv = process.env): void {
  instance.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    if (!trustedMutationOrigin(request.method, request.headers, env)) {
      await reply.code(403).send({ statusCode: 403, error: 'UNTRUSTED_ORIGIN', message: 'Request origin is not authorized.' });
    }
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
