import { vi } from 'vitest';

export const BASE_PATH = '/sme-integration';

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Trace-Id': 'trace-1' },
  });
}

export function errorResponse(status: number, code: string): Response {
  return jsonResponse(
    { trace_id: 'trace-1', errors: [{ code, message: `${code} message` }] },
    status,
  );
}

export interface RecordedRequest {
  url: URL;
  init: RequestInit;
  body: Record<string, unknown>;
}

export function requests(
  fetchMock: ReturnType<typeof vi.fn>,
): RecordedRequest[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: new URL(url as string),
    init: init as RequestInit,
    body: JSON.parse((init as RequestInit).body as string),
  }));
}

export function lastRequest(
  fetchMock: ReturnType<typeof vi.fn>,
): RecordedRequest {
  const request = requests(fetchMock).at(-1);
  if (!request) {
    throw new Error('No fetch call recorded.');
  }
  return request;
}

/** Makes `process.exit` throw so a test can assert on it. */
export function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as (code?: number) => never);
}

/** Collects everything printed with `console.log`. */
export function captureLog() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => log.mock.calls.flat().join('\n');
}
