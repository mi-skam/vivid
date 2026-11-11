import { vi } from 'vitest';
import { HttpClient } from '../src/http-client';

export const TEST_API_KEY = 'vivid_sk_v1_test';
export const BASE_URL = 'https://api.prime.vivid.money/sme-integration';

export function createMockFetch(
  payload: unknown,
  init?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  },
) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        statusText: init?.statusText ?? 'OK',
        headers: { 'Content-Type': 'application/json', ...init?.headers },
      }),
  );
}

export function createHttpClient(fetch: typeof globalThis.fetch): HttpClient {
  return new HttpClient({ apiKey: TEST_API_KEY, fetch });
}

export function lastRequest(fetch: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit;
  body: unknown;
} {
  const call = fetch.mock.calls.at(-1);
  if (!call) {
    throw new Error('No fetch call recorded.');
  }
  const init = call[1] as RequestInit;
  return {
    url: call[0] as string,
    init,
    body: JSON.parse(init.body as string),
  };
}
