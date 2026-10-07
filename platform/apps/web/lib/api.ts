export const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!headers.has('x-request-id')) headers.set('x-request-id', createRequestId());

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const payload = await response.json() as { message?: string | string[] };
      if (Array.isArray(payload.message)) message = payload.message.join(' ');
      else if (typeof payload.message === 'string') message = payload.message;
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function eventStreamUrl(path: string): string {
  return `${apiBase}${path}`;
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
