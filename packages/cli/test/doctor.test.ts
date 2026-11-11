import { consola } from 'consola';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import doctor from '../src/commands/doctor';
import { ACCOUNT_ID, account } from './fixtures';
import { captureLog, errorResponse, jsonResponse, requests } from './helpers';

const fetchMock = vi.fn();

/** Answers each route with the given response factory, defaulting to success. */
function serve(overrides: Record<string, () => Response> = {}): void {
  const defaults: Record<string, () => Response> = {
    '/api/v1/ping': () => jsonResponse({ status: 'ok' }),
    '/api/v1/accounts/current/list': () => jsonResponse({ accounts: [] }),
    '/api/v1/transactions/list': () =>
      jsonResponse({ transactions: [], next_cursor: null }),
    '/api/v1/cards/list': () => jsonResponse({ cards: [], next_cursor: null }),
  };
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname.replace('/sme-integration', '');
    const respond = overrides[path] ?? defaults[path];
    if (!respond) throw new Error(`Unexpected request: ${path}`);
    return respond();
  });
}

describe('doctor', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('XDG_CONFIG_HOME', await mkdtemp(join(tmpdir(), 'vivid-cli-')));
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_test');
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a missing key and fails without calling the API', async () => {
    vi.stubEnv('VIVID_API_KEY', '');
    const output = captureLog();

    await doctor.action({ json: true }, undefined);

    expect(JSON.parse(output())).toMatchObject({
      keySource: 'none',
      ping: null,
      apiError: null,
      permissions: {},
    });
    expect(process.exitCode).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes each permission with a minimal read', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({ accounts: [account] }),
    });
    const output = captureLog();

    await doctor.action({ json: true }, undefined);

    expect(JSON.parse(output())).toMatchObject({
      keySource: 'environment',
      ping: 'ok',
      apiError: null,
      permissions: {
        'accounts:read': { status: 'granted', error: null },
        'transactions:read': { status: 'granted', error: null },
        'cards:read': { status: 'granted', error: null },
      },
    });
    const bodies = requests(fetchMock).map((request) => [
      request.url.pathname,
      request.body,
    ]);
    expect(bodies).toEqual([
      ['/sme-integration/api/v1/ping', {}],
      ['/sme-integration/api/v1/accounts/current/list', {}],
      // transactions:read is probed through an explicit account, because
      // account_types answers 500 on the live API.
      ['/sme-integration/api/v1/accounts/current/list', {}],
      [
        '/sme-integration/api/v1/transactions/list',
        { account_ids: [ACCOUNT_ID], limit: 1 },
      ],
      ['/sme-integration/api/v1/cards/list', { limit: 1 }],
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports transactions:read as unknown without a visible account', async () => {
    serve();
    const output = captureLog();

    await doctor.action({ json: true }, undefined);

    expect(JSON.parse(output()).permissions['transactions:read']).toEqual({
      status: 'unknown',
      error: null,
    });
    expect(
      requests(fetchMock).some((request) =>
        request.url.pathname.endsWith('/transactions/list'),
      ),
    ).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not report transactions:read as denied when only accounts:read is', async () => {
    serve({
      '/api/v1/accounts/current/list': () => errorResponse(403, 'scope_denied'),
    });
    const output = captureLog();

    await doctor.action({ json: true }, undefined);

    expect(JSON.parse(output()).permissions).toMatchObject({
      'accounts:read': { status: 'denied', error: null },
      'transactions:read': { status: 'unknown', error: null },
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('treats scope_denied as a permission that was not granted', async () => {
    serve({ '/api/v1/cards/list': () => errorResponse(403, 'scope_denied') });
    const success = vi.spyOn(consola, 'success').mockImplementation(() => {});
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await doctor.action({ json: false }, undefined);

    expect(success).toHaveBeenCalledWith('accounts:read: granted');
    expect(info).toHaveBeenCalledWith('cards:read: not granted');
    expect(process.exitCode).toBeUndefined();
  });

  it('fails when a probe errors for another reason', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        errorResponse(403, 'entity_inactive'),
    });
    const output = captureLog();

    await doctor.action({ json: true }, undefined);

    expect(JSON.parse(output()).permissions['accounts:read']).toEqual({
      status: 'error',
      error:
        'Your company cannot use the Vivid API right now. Contact Vivid support.',
    });
    expect(process.exitCode).toBe(1);
  });

  it('skips the probes and fails when ping fails', async () => {
    serve({ '/api/v1/ping': () => errorResponse(401, 'key_expired') });
    const output = captureLog();

    await doctor.action({ json: true }, undefined);

    const report = JSON.parse(output());
    expect(report.apiError).toContain('expired');
    expect(report.permissions).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
});
