import { consola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import get from '../src/commands/transactions/get';
import list from '../src/commands/transactions/list';
import { ACCOUNT_ID, TRANSACTION_ID, account, transaction } from './fixtures';
import {
  BASE_PATH,
  captureLog,
  errorResponse,
  jsonResponse,
  lastRequest,
  mockExit,
  requests,
} from './helpers';

const OTHER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const fetchMock = vi.fn();

const defaults = { json: false } as const;

const otherAccount = { ...account, id: OTHER_ACCOUNT_ID, name: 'Reserve' };

function accounts(list = [account]): Response {
  return jsonResponse({ accounts: list });
}

function page(ids: number[], nextCursor: string | null): Response {
  return jsonResponse({
    transactions: ids.map((id) => ({
      ...transaction,
      id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    })),
    next_cursor: nextCursor,
  });
}

describe('transaction commands', () => {
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

  it('defaults to every visible account by ID and prints a table', async () => {
    fetchMock
      .mockResolvedValueOnce(accounts([account, otherAccount]))
      .mockResolvedValueOnce(
        jsonResponse({ transactions: [transaction], next_cursor: null }),
      );
    const output = captureLog();

    await list.action(defaults, undefined);

    const [accountsRequest] = requests(fetchMock);
    expect(accountsRequest?.url.pathname).toBe(
      `${BASE_PATH}/api/v1/accounts/current/list`,
    );
    const { url, init, body } = lastRequest(fetchMock);
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/transactions/list`);
    // account_types answers 500 on the live API, so the default sends ids.
    expect(body).toEqual({
      account_ids: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
      limit: 500,
    });
    const text = output();
    expect(text).toMatch(
      /ID\s+DATE\s+AMOUNT\s+ORIGINAL\s+MERCHANT\s+TYPE\s+STATE/,
    );
    expect(text).toContain('2025-03-01T09:00:00Z');
    expect(text).toContain('-12.50 EUR');
    expect(text).toContain('-13.00 USD');
    expect(text).toContain('ACME CLOUD');
    expect(text).toContain('card_payment');
  });

  it('maps every filter and accepts repeated and comma-separated values', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ transactions: [], next_cursor: null }),
    );
    vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action(
      {
        account: [`${ACCOUNT_ID},${OTHER_ACCOUNT_ID}`],
        type: ['card_payment', 'fee,atm'],
        state: 'pending',
        updatedFrom: '2025-03-01',
        updatedTo: '2025-03-31T12:00:00Z',
        limit: 10,
        json: false,
      },
      undefined,
    );

    expect(lastRequest(fetchMock).body).toEqual({
      account_ids: [ACCOUNT_ID, OTHER_ACCOUNT_ID],
      types: ['card_payment', 'fee', 'atm'],
      state: 'pending',
      updated_from: '2025-03-01T00:00:00Z',
      updated_to: '2025-03-31T12:00:00Z',
      limit: 10,
    });
  });

  it('passes account types through', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ transactions: [], next_cursor: null }),
    );
    vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action(
      { accountType: ['current', 'other'], json: false },
      undefined,
    );

    expect(lastRequest(fetchMock).body).toMatchObject({
      account_types: ['current', 'other'],
    });
  });

  it('rejects --account combined with --account-type before any request', async () => {
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(
      list.action(
        { account: [ACCOUNT_ID], accountType: ['current'], json: false },
        undefined,
      ),
    ).rejects.toThrow('process.exit(1)');
    expect(error).toHaveBeenCalledWith(
      'Pass either --account or --account-type, not both.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves account names case-insensitively with one account lookup', async () => {
    fetchMock
      .mockResolvedValueOnce(accounts([account, otherAccount]))
      .mockResolvedValueOnce(
        jsonResponse({ transactions: [], next_cursor: null }),
      );
    vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action(
      { account: ['reserve', 'ACME GMBH', ACCOUNT_ID], json: false },
      undefined,
    );

    expect(requests(fetchMock)[0]?.body).toEqual({ include_closed: true });
    expect(lastRequest(fetchMock).body).toMatchObject({
      account_ids: [OTHER_ACCOUNT_ID, ACCOUNT_ID, ACCOUNT_ID],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not look up accounts when only IDs are given', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ transactions: [], next_cursor: null }),
    );
    vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action({ account: [ACCOUNT_ID], json: false }, undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exits with the available names when no account matches', async () => {
    fetchMock.mockResolvedValueOnce(accounts([account, otherAccount]));
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(
      list.action({ account: ['Nope'], json: false }, undefined),
    ).rejects.toThrow('process.exit(1)');
    expect(error).toHaveBeenCalledWith(
      'No account named "Nope". Available: ACME GmbH, Reserve.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exits when a name matches several accounts', async () => {
    fetchMock.mockResolvedValueOnce(
      accounts([account, { ...otherAccount, name: 'acme gmbh' }]),
    );
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(
      list.action({ account: ['ACME GmbH'], json: false }, undefined),
    ).rejects.toThrow('process.exit(1)');
    expect(error.mock.calls[0]?.[0]).toContain('matches 2 accounts');
  });

  it('follows next_cursor across short and empty pages until it is null', async () => {
    fetchMock
      .mockResolvedValueOnce(accounts())
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([], 'c2'))
      .mockResolvedValueOnce(page([3], null));
    const output = captureLog();

    await list.action({ json: true }, undefined);

    const sent = requests(fetchMock)
      .slice(1)
      .map((request) => request.body);
    expect(sent).toEqual([
      { account_ids: [ACCOUNT_ID], limit: 500 },
      { account_ids: [ACCOUNT_ID], limit: 500, cursor: 'c1' },
      { account_ids: [ACCOUNT_ID], limit: 500, cursor: 'c2' },
    ]);
    expect(JSON.parse(output())).toHaveLength(3);
  });

  it('stops paging once --limit rows are collected', async () => {
    fetchMock
      .mockResolvedValueOnce(accounts())
      .mockResolvedValueOnce(page([1, 2], 'c1'))
      .mockResolvedValueOnce(page([3, 4], 'c2'));
    const output = captureLog();

    await list.action({ limit: 3, json: true }, undefined);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      requests(fetchMock)
        .slice(1)
        .map((request) => request.body.limit),
    ).toEqual([3, 3]);
    expect(JSON.parse(output())).toHaveLength(3);
  });

  it('reports an empty result', async () => {
    fetchMock
      .mockResolvedValueOnce(accounts())
      .mockResolvedValueOnce(
        jsonResponse({ transactions: [], next_cursor: null }),
      );
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action(defaults, undefined);

    expect(info).toHaveBeenCalledWith('No transactions found.');
  });

  it('reports an empty result without asking for transactions when no account is visible', async () => {
    fetchMock.mockResolvedValueOnce(accounts([]));
    const output = captureLog();

    await list.action({ json: true }, undefined);

    expect(JSON.parse(output())).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prints a single transaction as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ transaction }));
    const output = captureLog();

    await get.action({ json: true }, [TRANSACTION_ID]);

    const { url, body } = lastRequest(fetchMock);
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/transactions/get`);
    expect(body).toEqual({ id: TRANSACTION_ID });
    expect(JSON.parse(output())).toEqual(transaction);
  });

  it('shows a single transaction', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ transaction }));
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await get.action({ json: false }, [TRANSACTION_ID]);

    expect(info).toHaveBeenCalledWith('Amount: -12.50 EUR');
    expect(info).toHaveBeenCalledWith('Original amount: -13.00 USD');
    expect(info).toHaveBeenCalledWith('Merchant: ACME CLOUD, Berlin (DE)');
  });

  it('surfaces outside_history_window as a VividError', async () => {
    fetchMock.mockResolvedValue(errorResponse(404, 'outside_history_window'));

    await expect(
      get.action({ json: false }, [TRANSACTION_ID]),
    ).rejects.toMatchObject({ status: 404, code: 'outside_history_window' });
  });
});
