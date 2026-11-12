import { consola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ping from '../src/commands/ping';
import {
  BASE_PATH,
  captureLog,
  errorResponse,
  jsonResponse,
  lastRequest,
  mockExit,
} from './helpers';

const fetchMock = vi.fn();

describe('ping', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts an empty body to the ping route and reports success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    const success = vi.spyOn(consola, 'success').mockImplementation(() => {});

    await ping.action({ json: false }, undefined);

    const request = lastRequest(fetchMock);
    expect(request.url.pathname).toBe(`${BASE_PATH}/api/v1/ping`);
    expect(request.init.method).toBe('POST');
    expect(request.body).toEqual({});
    expect(success).toHaveBeenCalledWith(
      'API connection succeeded (ping: ok).',
    );
  });

  it('prints the API response unchanged with --json', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    const output = captureLog();

    await ping.action({ json: true }, undefined);

    expect(JSON.parse(output())).toEqual({ status: 'ok' });
  });

  it('throws the API error for a rejected key', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'invalid_key'));

    await expect(ping.action({ json: false }, undefined)).rejects.toMatchObject(
      {
        status: 401,
        code: 'invalid_key',
      },
    );
  });

  it('exits 1 without calling the API when no key is set', async () => {
    vi.stubEnv('VIVID_API_KEY', '');
    vi.stubEnv('XDG_CONFIG_HOME', '/nonexistent-vivid-test');
    vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(ping.action({ json: false }, undefined)).rejects.toThrow(
      'process.exit(1)',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
