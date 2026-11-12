import { VividError, type Vivid } from '@mi-skam/vivid-sdk';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, databasePath } from '../src/store';
import { SYNC_OVERLAP_MS, syncStore } from '../src/sync';
import {
  WATCH_OVERLAP_MS,
  watchTransactions,
  type WatchEvent,
} from '../src/watch';
import { ACCOUNT_ID, account, card, tx } from './fixtures';

const OTHER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vivid-store-'));
  store = await Store.open({
    create: true,
    path: join(dir, 'nested', 'vivid.db'),
  });
});

afterEach(() => {
  store.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('database path', () => {
  it('prefers VIVID_DB, then XDG_DATA_HOME', () => {
    vi.stubEnv('VIVID_DB', '/tmp/custom.db');
    expect(databasePath()).toBe('/tmp/custom.db');
    vi.stubEnv('VIVID_DB', '');
    vi.stubEnv('XDG_DATA_HOME', '/data');
    expect(databasePath()).toBe('/data/vivid/vivid.db');
  });
});

describe('Store', () => {
  it('creates the file readable only by its owner', async () => {
    expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it('refuses to create a database for read commands', async () => {
    await expect(
      Store.open({ create: false, path: join(dir, 'missing.db') }),
    ).rejects.toThrow('Run `vivid db:sync` first');
  });

  it('inserts, replaces newer versions and ignores older ones', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    const first = tx({
      id: id(1),
      state: 'pending',
      updated_at: '2026-11-01T10:00:00Z',
    });
    expect(store.upsertTransactions([first], now)).toEqual({
      inserted: 1,
      updated: 0,
    });
    const settled = {
      ...first,
      state: 'completed',
      updated_at: '2026-11-02T10:00:00Z',
    };
    expect(store.upsertTransactions([settled], now)).toEqual({
      inserted: 0,
      updated: 1,
    });
    expect(store.upsertTransactions([first], now)).toEqual({
      inserted: 0,
      updated: 0,
    });
    expect(store.transactions()).toEqual([settled]);
  });

  it('queries by account, type, state and payment period, newest first', () => {
    const now = new Date();
    store.upsertTransactions(
      [
        tx({ id: id(1), show_at: '2025-03-01T00:00:00Z' }),
        tx({ id: id(2), show_at: '2025-03-15T00:00:00Z', type: 'fee' }),
        tx({
          id: id(3),
          show_at: '2025-04-01T00:00:00Z',
          account_id: OTHER_ACCOUNT_ID,
        }),
        tx({
          id: id(4),
          show_at: '2025-03-20T00:00:00.500Z',
          state: 'declined',
        }),
      ],
      now,
    );
    const ids = (query: Parameters<Store['transactions']>[0]) =>
      store.transactions(query).map((t) => t.id);
    expect(ids({})).toEqual([id(3), id(4), id(2), id(1)]);
    expect(ids({ accountIds: [OTHER_ACCOUNT_ID] })).toEqual([id(3)]);
    expect(ids({ types: ['fee'] })).toEqual([id(2)]);
    expect(ids({ state: 'declined' })).toEqual([id(4)]);
    expect(
      ids({
        from: new Date('2025-03-02T00:00:00Z'),
        to: new Date('2025-04-01T00:00:00Z'),
      }),
    ).toEqual([id(4), id(2)]);
  });

  it('reports what it holds', async () => {
    store.upsertAccounts([account as never], new Date());
    store.upsertCards([card as never], new Date());
    store.upsertTransactions([tx()], new Date());
    store.setHistoryFrom([ACCOUNT_ID], new Date('2025-01-01T00:00:00Z'));
    store.setMeta('last_sync', '2026-11-12T00:00:00.000Z');
    expect(await store.info()).toMatchObject({
      accounts: 1,
      cards: 1,
      transactions: 1,
      oldest: '2025-03-01T09:00:00.000Z',
      newest: '2025-03-01T09:00:00.000Z',
      historyFrom: '2025-01-01T00:00:00.000Z',
      lastSync: '2026-11-12T00:00:00.000Z',
    });
  });
});

/** A client double: each route answers from the given queue of pages. */
function fakeClient(pages: {
  accounts?: unknown[];
  cards?: () => Promise<unknown>;
  transactions?: Array<{ transactions: unknown[]; next_cursor: string | null }>;
}) {
  const transactionsList = vi.fn(
    async () =>
      pages.transactions?.shift() ?? { transactions: [], next_cursor: null },
  );
  return {
    client: {
      accounts: { list: vi.fn(async () => pages.accounts ?? [account]) },
      cards: {
        list: vi.fn(
          pages.cards ?? (async () => ({ cards: [card], next_cursor: null })),
        ),
      },
      transactions: { list: transactionsList },
    } as unknown as Vivid,
    transactionsList,
  };
}

describe('syncStore', () => {
  const now = new Date('2026-11-12T12:00:00Z');

  it('fetches the full 90 days on the first run, then only changes', async () => {
    const first = fakeClient({
      transactions: [
        {
          transactions: [tx({ id: id(1), updated_at: '2026-11-10T08:00:00Z' })],
          next_cursor: 'c1',
        },
        {
          transactions: [tx({ id: id(2), updated_at: '2026-11-11T08:00:00Z' })],
          next_cursor: null,
        },
      ],
    });
    const result = await syncStore(first.client, store, now);
    expect(result).toMatchObject({
      accounts: 1,
      cards: 1,
      fetched: 2,
      inserted: 2,
      updated: 0,
      requests: 4,
      newAccounts: 1,
      gap: null,
    });
    expect(first.transactionsList.mock.calls[0]?.[0]).toEqual({
      accountIds: [ACCOUNT_ID],
      limit: 500,
    });
    expect(store.historyFrom().get(ACCOUNT_ID)).toBe(
      '2026-08-14T00:00:00.000Z',
    );

    const second = fakeClient({
      transactions: [
        {
          transactions: [
            tx({
              id: id(2),
              state: 'pending',
              updated_at: '2026-11-12T09:00:00Z',
            }),
          ],
          next_cursor: null,
        },
      ],
    });
    const again = await syncStore(second.client, store, now);
    expect(second.transactionsList.mock.calls[0]?.[0]).toEqual({
      accountIds: [ACCOUNT_ID],
      updatedFrom: new Date(
        Date.parse('2026-11-11T08:00:00Z') - SYNC_OVERLAP_MS,
      ).toISOString(),
      limit: 500,
    });
    expect(again).toMatchObject({
      fetched: 1,
      inserted: 0,
      updated: 1,
      newAccounts: 0,
    });
    expect(store.getMeta('watermark')).toBe('2026-11-12T09:00:00.000Z');
  });

  it('keeps transactions that have left the API window', async () => {
    store.upsertTransactions(
      [tx({ id: id(9), show_at: '2025-01-01T00:00:00Z' })],
      now,
    );
    await syncStore(fakeClient({}).client, store, now);
    expect(store.transactions().map((t) => t.id)).toContain(id(9));
  });

  it('fetches a new account in full while known ones stay incremental', async () => {
    await syncStore(
      fakeClient({
        transactions: [
          {
            transactions: [tx({ updated_at: '2026-11-01T00:00:00Z' })],
            next_cursor: null,
          },
        ],
      }).client,
      store,
      now,
    );
    const next = fakeClient({
      accounts: [
        account,
        { ...account, id: OTHER_ACCOUNT_ID, name: 'Reserve' },
      ],
    });
    const result = await syncStore(next.client, store, now);
    expect(result.newAccounts).toBe(1);
    const [full, incremental] = next.transactionsList.mock.calls.map(
      (call) => call[0] as Record<string, unknown>,
    );
    expect(full).toEqual({ accountIds: [OTHER_ACCOUNT_ID], limit: 500 });
    expect(incremental).toMatchObject({ accountIds: [ACCOUNT_ID] });
    expect(incremental?.['updatedFrom']).toBeDefined();
  });

  it('skips cards without permission and warns about a gap after 90 days', async () => {
    store.setHistoryFrom([ACCOUNT_ID], new Date('2026-01-01T00:00:00Z'));
    store.setMeta('watermark', '2026-02-01T00:00:00.000Z');
    const denied = new VividError({
      status: 403,
      statusText: 'Forbidden',
      body: { errors: [{ code: 'scope_denied', message: 'no' }] },
      headers: new Headers(),
    } as never);
    const result = await syncStore(
      fakeClient({ cards: async () => Promise.reject(denied) }).client,
      store,
      now,
    );
    expect(result.cards).toBeNull();
    expect(result.gap).toEqual({
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-08-14T00:00:00.000Z',
    });
  });
});

describe('watchTransactions', () => {
  it('stays silent on the first poll, then reports new and changed records once', async () => {
    const start = new Date('2026-11-12T12:00:00Z');
    const polls = [
      [tx({ id: id(1), state: 'pending', updated_at: '2026-11-12T11:58:00Z' })],
      [
        tx({
          id: id(1),
          state: 'completed',
          updated_at: '2026-11-12T12:01:00Z',
        }),
        tx({ id: id(2), updated_at: '2026-11-12T12:00:30Z' }),
      ],
      // The same records again, as the overlap returns them: no new events.
      [
        tx({
          id: id(1),
          state: 'completed',
          updated_at: '2026-11-12T12:01:00Z',
        }),
      ],
    ];
    const controller = new AbortController();
    const fetchChanges = vi.fn(async () => {
      const next = polls.shift();
      if (polls.length === 0) controller.abort();
      return next ?? [];
    });
    const events: WatchEvent[] = [];
    const saved: number[] = [];
    await watchTransactions({
      fetchChanges,
      intervalMs: 60_000,
      signal: controller.signal,
      now: () => start,
      sleep: async () => {},
      onPoll: (records) => {
        saved.push(records.length);
      },
      onEvent: (event) => events.push(event),
    });
    expect(fetchChanges.mock.calls[0]?.[0]).toBe(
      new Date(start.getTime() - WATCH_OVERLAP_MS).toISOString(),
    );
    expect(fetchChanges.mock.calls[1]?.[0]).toBe(
      new Date(start.getTime() - WATCH_OVERLAP_MS).toISOString(),
    );
    expect(
      events.map((e) => [e.kind, e.transaction.id, e.previous?.state]),
    ).toEqual([
      ['new', id(2), undefined],
      ['updated', id(1), 'pending'],
    ]);
    expect(saved).toEqual([1, 2]);
  });
});
