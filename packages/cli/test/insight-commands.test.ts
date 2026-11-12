import { consola } from 'consola';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import accountsList from '../src/commands/accounts/list';
import cardsList, { limitsLabel } from '../src/commands/cards/list';
import dbInfo from '../src/commands/db/info';
import dbSync from '../src/commands/db/sync';
import list from '../src/commands/transactions/list';
import summary from '../src/commands/transactions/summary';
import { ACCOUNT_ID, account, card, transaction, tx } from './fixtures';
import { captureLog, jsonResponse, requests } from './helpers';

const fetchMock = vi.fn();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Answers each route from a handler; unknown routes fail the test. */
function serve(routes: Record<string, () => Response>): void {
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname.replace('/sme-integration', '');
    const respond = routes[path];
    if (!respond) throw new Error(`Unexpected request: ${path}`);
    return respond();
  });
}

const march = [
  tx({ id: id(1), amount: '-10.00', show_at: '2025-03-05T10:00:00Z' }),
  tx({
    id: id(2),
    amount: '-2.50',
    show_at: '2025-02-27T10:00:00Z',
    // Changed in March, happened in February: must not count for March.
    updated_at: '2025-03-03T10:00:00Z',
  }),
  tx({
    id: id(3),
    amount: '-99.00',
    show_at: '2025-03-06T10:00:00Z',
    merchant: { ...transaction.merchant, name: '-SUM(A1)' },
    card: { id: id(299), last_4: '1111' },
  }),
  tx({
    id: id(4),
    amount: '-5.00',
    state: 'pending',
    show_at: '2025-03-07T10:00:00Z',
  }),
];

describe('insight commands', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_test');
    vi.stubEnv(
      'VIVID_DB',
      join(await mkdtemp(join(tmpdir(), 'vivid-db-')), 'vivid.db'),
    );
    vi.spyOn(consola, 'info').mockImplementation(() => {});
    vi.spyOn(consola, 'success').mockImplementation(() => {});
    vi.spyOn(consola, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('filters a month by payment date, card digits and merchant, and writes CSV', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({ accounts: [account] }),
      '/api/v1/transactions/list': () =>
        jsonResponse({ transactions: march, next_cursor: null }),
    });
    const output = captureLog();

    await list.action(
      {
        json: false,
        format: 'csv',
        month: '2025-03',
        card: '1111',
        merchant: 'sum',
      } as never,
      undefined,
    );

    // Four-digit card filters need no card lookup.
    expect(requests(fetchMock).map((r) => r.url.pathname)).toEqual([
      '/sme-integration/api/v1/accounts/current/list',
      '/sme-integration/api/v1/transactions/list',
    ]);
    // The whole window is fetched; the month is applied by the CLI.
    expect(requests(fetchMock)[1]?.body).toEqual({
      account_ids: [ACCOUNT_ID],
      limit: 500,
    });
    expect(output().split('\n')).toEqual([
      'id,date,account,type,state,amount,currency,original_amount,original_currency,merchant,city,country,mcc,category,card_last4',
      `${id(3)},2025-03-06T10:00:00Z,ACME GmbH,card_payment,completed,-99.00,EUR,-13.00,USD,'-SUM(A1),Berlin,DE,5734,Software & IT,1111`,
    ]);
  });

  it('warns when the period reaches before the 90-day window', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({ accounts: [account] }),
      '/api/v1/transactions/list': () =>
        jsonResponse({ transactions: [], next_cursor: null }),
    });
    await list.action({ json: true, since: '2020-01-01' } as never, undefined);
    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining('vivid db:sync'),
    );
  });

  it('summarises completed transactions of a month per merchant', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({ accounts: [account] }),
      '/api/v1/transactions/list': () =>
        jsonResponse({ transactions: march, next_cursor: null }),
    });
    const output = captureLog();

    await summary.action(
      { json: true, month: '2025-03', by: 'merchant' } as never,
      undefined,
    );

    expect(JSON.parse(output())).toEqual([
      expect.objectContaining({ group: '-SUM(A1)', count: 1, out: '-99.00' }),
      expect.objectContaining({ group: 'ACME CLOUD', count: 1, out: '-10.00' }),
    ]);
  });

  it('syncs once and then answers --local without any request', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({ accounts: [account] }),
      '/api/v1/cards/list': () =>
        jsonResponse({ cards: [card], next_cursor: null }),
      '/api/v1/transactions/list': () =>
        jsonResponse({ transactions: march, next_cursor: null }),
    });
    const synced = captureLog();
    await dbSync.action({ json: true }, undefined);
    expect(JSON.parse(synced())).toMatchObject({ inserted: 4, requests: 3 });

    fetchMock.mockReset();
    vi.spyOn(console, 'log').mockClear();
    const output = captureLog();
    await summary.action(
      { json: true, local: true, by: 'card', includePending: true } as never,
      undefined,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(output())).toEqual([
      expect.objectContaining({ group: '…1111', out: '-99.00' }),
      expect.objectContaining({
        group: 'ACME Travel (…4242)',
        count: 3,
        out: '-17.50',
      }),
    ]);
  });

  it('shows what the database holds', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({ accounts: [account] }),
      '/api/v1/cards/list': () =>
        jsonResponse({ cards: [], next_cursor: null }),
      '/api/v1/transactions/list': () =>
        jsonResponse({ transactions: [transaction], next_cursor: null }),
    });
    await dbSync.action({ json: false }, undefined);
    const output = captureLog();
    await dbInfo.action({ json: true }, undefined);
    expect(JSON.parse(output())).toMatchObject({
      accounts: 1,
      cards: 0,
      transactions: 1,
    });
  });

  it('fails clearly when --local has no database yet', async () => {
    await expect(
      list.action({ json: true, local: true } as never, undefined),
    ).rejects.toThrow('Run `vivid db:sync` first');
  });

  it('adds a total per currency and counts hidden balances', async () => {
    serve({
      '/api/v1/accounts/current/list': () =>
        jsonResponse({
          accounts: [
            account,
            {
              ...account,
              id: id(2),
              name: 'Reserve',
              balance: { available: '0.44', pending: null },
            },
            { ...account, id: id(3), name: 'Hidden', balance: null },
          ],
        }),
    });
    const output = captureLog();
    await accountsList.action({ json: false } as never, undefined);
    const total = output().split('\n').at(-1) ?? '';
    expect(total).toMatch(
      /TOTAL\s+1 balance\(s\) hidden\s+EUR\s+1235\.00\s+10\.00/,
    );
  });

  it('shows how much of each card limit is used', async () => {
    const nearlyUsed = {
      ...card,
      limits: [
        { ...card.limits[0], used: '850.00' },
        {
          type: 'single_operation',
          renewal: null,
          size: '500.00',
          used: null,
          currency: 'EUR',
        },
      ],
    };
    expect(limitsLabel(nearlyUsed as never)).toBe(
      'spending/monthly 850.00/1000.00 EUR (85%) !; single_operation 500.00 EUR',
    );
    expect(
      limitsLabel({ ...card, limits: [], limits_visible: false } as never),
    ).toBe('hidden');

    serve({
      '/api/v1/cards/list': () =>
        jsonResponse({ cards: [card], next_cursor: null }),
    });
    const output = captureLog();
    await cardsList.action({ json: false, format: 'csv' } as never, undefined);
    expect(output()).toContain('spending/monthly 12.50/1000.00 EUR (1%)');
  });
});
