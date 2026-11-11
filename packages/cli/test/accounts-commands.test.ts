import { consola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import get from '../src/commands/accounts/get';
import list from '../src/commands/accounts/list';
import { ACCOUNT_ID, account } from './fixtures';
import {
  BASE_PATH,
  captureLog,
  jsonResponse,
  lastRequest,
  mockExit,
  requests,
} from './helpers';

const fetchMock = vi.fn();

describe('account commands', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists accounts as a table', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accounts: [account] }));
    const output = captureLog();

    await list.action({ includeClosed: false, json: false }, undefined);

    const { url, init, body } = lastRequest(fetchMock);
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/accounts/current/list`);
    expect(body).toEqual({ include_closed: false });
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(
      /^@mi-skam\/vivid\//,
    );
    const text = output();
    expect(text).toMatch(
      /ID\s+NAME\s+IBAN\s+CURRENCY\s+STATE\s+AVAILABLE\s+PENDING/,
    );
    expect(text).toContain('DE89370400440532013000');
    expect(text).toContain('1234.56');
  });

  it('sends include_closed and prints an empty balance when hidden', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [{ ...account, state: 'archived', balance: null }],
      }),
    );
    const output = captureLog();

    await list.action({ includeClosed: true, json: false }, undefined);

    expect(lastRequest(fetchMock).body).toEqual({ include_closed: true });
    expect(output()).toContain('archived');
  });

  it('prints accounts as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accounts: [account] }));
    const output = captureLog();

    await list.action({ includeClosed: false, json: true }, undefined);

    expect(JSON.parse(output())).toEqual([account]);
  });

  it('reports an empty list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accounts: [] }));
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action({ includeClosed: false, json: false }, undefined);

    expect(info).toHaveBeenCalledWith('No accounts found.');
  });

  it('shows a single account', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ account }));
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await get.action({ json: false }, [ACCOUNT_ID]);

    const { url, body } = lastRequest(fetchMock);
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/accounts/current/get`);
    expect(body).toEqual({ id: ACCOUNT_ID });
    expect(info).toHaveBeenCalledWith('Name: ACME GmbH');
    expect(info).toHaveBeenCalledWith('Available: 1234.56 EUR');
  });

  it('shows an account by name after one case-insensitive lookup', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ accounts: [account] }))
      .mockResolvedValueOnce(jsonResponse({ account }));
    vi.spyOn(consola, 'info').mockImplementation(() => {});

    await get.action({ json: false }, ['acme gmbh']);

    const [lookup, fetched] = requests(fetchMock);
    expect(lookup?.url.pathname).toBe(
      `${BASE_PATH}/api/v1/accounts/current/list`,
    );
    expect(lookup?.body).toEqual({ include_closed: true });
    expect(fetched?.body).toEqual({ id: ACCOUNT_ID });
  });

  it('exits with the available names when no account matches', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [account] }));
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(get.action({ json: false }, ['Nope'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(error).toHaveBeenCalledWith(
      'No account named "Nope". Available: ACME GmbH.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
