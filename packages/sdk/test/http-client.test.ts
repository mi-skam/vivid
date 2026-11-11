import { afterEach, describe, expect, it, vi } from 'vitest';
import { VividError } from '../src/errors';
import { HttpClient } from '../src/http-client';
import {
  BASE_URL,
  createHttpClient,
  createMockFetch,
  lastRequest,
} from './helpers';

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function createResponse(
  payload: unknown,
  init: {
    status: number;
    statusText: string;
    headers?: Record<string, string>;
  },
): Response {
  return new Response(JSON.stringify(payload), {
    status: init.status,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

const errorEnvelope = {
  trace_id: 'trace-1',
  errors: [{ code: 'internal_error', message: 'boom' }],
};

describe('HttpClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('requests', () => {
    it('posts JSON with the trimmed raw key and no bearer prefix', async () => {
      const fetch = createMockFetch({ status: 'ok' });
      const client = new HttpClient({ apiKey: '  vivid_sk_v1_abc  ', fetch });

      await client.request({ path: '/api/v1/ping' });

      const { url, init, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/ping`);
      expect(init.method).toBe('POST');
      expect(headersOf(init)).toEqual({
        Authorization: 'vivid_sk_v1_abc',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': '@mi-skam/vivid-sdk',
      });
      expect(body).toEqual({});
    });

    it('drops undefined fields from the body', async () => {
      const fetch = createMockFetch({});
      const client = createHttpClient(fetch);

      await client.request({
        path: '/api/v1/cards/list',
        body: { limit: 5, cursor: undefined },
      });

      expect(lastRequest(fetch).init.body).toBe('{"limit":5}');
    });

    it('honors a custom base URL and user agent', async () => {
      const fetch = createMockFetch({});
      const client = new HttpClient({
        apiKey: 'k',
        baseUrl: 'http://localhost:8080/',
        userAgent: 'test-agent',
        fetch,
      });

      await client.request({ path: '/api/v1/ping' });

      const { url, init } = lastRequest(fetch);
      expect(url).toBe('http://localhost:8080/api/v1/ping');
      expect(headersOf(init)['User-Agent']).toBe('test-agent');
    });
  });

  describe('response handling', () => {
    it('returns the parsed body', async () => {
      const fetch = createMockFetch({ status: 'ok' });

      const result = await createHttpClient(fetch).request({
        path: '/api/v1/ping',
      });

      expect(result).toEqual({ status: 'ok' });
    });

    it('returns undefined for empty bodies', async () => {
      const fetch = vi.fn(async () => new Response(''));

      const result = await createHttpClient(fetch).request({ path: '/x' });

      expect(result).toBeUndefined();
    });
  });

  describe('errors', () => {
    it('parses the error envelope into a VividError', async () => {
      const fetch = createMockFetch(
        {
          trace_id: 'trace-123',
          errors: [
            {
              code: 'invalid_request',
              message: 'account_ids[0] must be a UUID',
            },
            { code: 'invalid_request', message: 'limit must be positive' },
          ],
        },
        {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'X-Trace-Id': 'trace-header' },
        },
      );

      const error = await createHttpClient(fetch)
        .request({ path: '/api/v1/transactions/list' })
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(VividError);
      expect(error).toMatchObject({
        name: 'VividError',
        status: 400,
        statusText: 'Bad Request',
        traceId: 'trace-123',
        code: 'invalid_request',
        codes: ['invalid_request', 'invalid_request'],
        messages: ['account_ids[0] must be a UUID', 'limit must be positive'],
        message: 'account_ids[0] must be a UUID; limit must be positive',
      });
      expect((error as VividError).hasCode('invalid_request')).toBe(true);
      expect((error as VividError).hasCode('scope_denied')).toBe(false);
    });

    it('falls back to the X-Trace-Id header and status for other bodies', async () => {
      const fetch = vi.fn(
        async () =>
          new Response('', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'X-Trace-Id': 'trace-header' },
          }),
      );

      const error = (await createHttpClient(fetch)
        .request({ path: '/x' })
        .catch((error: unknown) => error)) as VividError;

      expect(error.traceId).toBe('trace-header');
      expect(error.codes).toEqual([]);
      expect(error.code).toBeUndefined();
      expect(error.message).toBe('Vivid API error: 404 Not Found');
    });

    it('keeps unknown codes as generic errors of their status', async () => {
      const fetch = createMockFetch(
        { trace_id: 't', errors: [{ code: 'brand_new_code', message: 'New' }] },
        { status: 403, statusText: 'Forbidden' },
      );

      const error = (await createHttpClient(fetch)
        .request({ path: '/x' })
        .catch((error: unknown) => error)) as VividError;

      expect(error.status).toBe(403);
      expect(error.code).toBe('brand_new_code');
      expect(error.message).toBe('New');
    });

    it.each([400, 401, 403, 404, 415])(
      'does not retry a %i',
      async (status) => {
        const fetch = createMockFetch(errorEnvelope, {
          status,
          statusText: 'Error',
        });

        await expect(
          createHttpClient(fetch).request({ path: '/x' }),
        ).rejects.toMatchObject({ status });
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('retries', () => {
    it('retries a POST on a server error, since every route is read-only', async () => {
      vi.useFakeTimers();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          createResponse(errorEnvelope, {
            status: 503,
            statusText: 'Service Unavailable',
          }),
        )
        .mockResolvedValueOnce(
          createResponse({ status: 'ok' }, { status: 200, statusText: 'OK' }),
        );

      const promise = createHttpClient(fetch).request({ path: '/api/v1/ping' });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await promise).toEqual({ status: 'ok' });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((fetch.mock.calls[1]?.[1] as RequestInit).method).toBe('POST');
    });

    it('waits for Retry-After on a 429', async () => {
      vi.useFakeTimers();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          createResponse(
            {
              trace_id: 't',
              errors: [{ code: 'rate_limited', message: 'slow down' }],
            },
            {
              status: 429,
              statusText: 'Too Many Requests',
              headers: { 'Retry-After': '7' },
            },
          ),
        )
        .mockResolvedValueOnce(
          createResponse({ status: 'ok' }, { status: 200, statusText: 'OK' }),
        );

      const promise = createHttpClient(fetch).request({ path: '/api/v1/ping' });
      await vi.advanceTimersByTimeAsync(6_999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(await promise).toEqual({ status: 'ok' });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('retries network errors', async () => {
      vi.useFakeTimers();
      const fetch = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(
          createResponse({ status: 'ok' }, { status: 200, statusText: 'OK' }),
        );

      const promise = createHttpClient(fetch).request({ path: '/api/v1/ping' });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(await promise).toEqual({ status: 'ok' });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('gives up after three retries with the last error', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () =>
        createResponse(errorEnvelope, {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'X-Trace-Id': 'trace-1' },
        }),
      );

      const promise = createHttpClient(fetch)
        .request({ path: '/api/v1/ping' })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(await promise).toMatchObject({
        status: 500,
        code: 'internal_error',
        traceId: 'trace-1',
      });
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it.each([
      [0, 1],
      [1, 2],
    ])('honors maxRetries %i (%i attempts)', async (maxRetries, attempts) => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () =>
        createResponse(errorEnvelope, {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      );

      const promise = new HttpClient({
        apiKey: 'vivid_sk_v1_test',
        baseUrl: BASE_URL,
        maxRetries,
        fetch,
      })
        .request({ path: '/api/v1/ping' })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(await promise).toMatchObject({ status: 500 });
      expect(fetch).toHaveBeenCalledTimes(attempts);
    });

    it('rethrows a network error once retries are exhausted', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });

      const promise = createHttpClient(fetch)
        .request({ path: '/api/v1/ping' })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(await promise).toBeInstanceOf(TypeError);
      expect(fetch).toHaveBeenCalledTimes(4);
    });
  });
});
