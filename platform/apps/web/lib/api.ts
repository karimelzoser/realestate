const configuredApiBase = process.env.NEXT_PUBLIC_API_URL;
if (!configuredApiBase) {
  throw new Error('NEXT_PUBLIC_API_URL is required.');
}

export const apiBase = configuredApiBase.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requiredAssurance?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    let code: string | undefined;
    let requiredAssurance: string | undefined;
    try {
      const payload = await response.json() as {
        message?: string | string[];
        error?: string;
        requiredAssurance?: string;
      };
      if (Array.isArray(payload.message)) message = payload.message.join(' ');
      else if (typeof payload.message === 'string') message = payload.message;
      if (typeof payload.error === 'string') code = payload.error;
      if (typeof payload.requiredAssurance === 'string') {
        requiredAssurance = payload.requiredAssurance;
      }
    } catch {
      // Keep the status-based fallback when the response is not JSON.
    }
    throw new ApiError(message, response.status, code, requiredAssurance);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function eventStreamUrl(path: string): string {
  return `${apiBase}${path}`;
}
