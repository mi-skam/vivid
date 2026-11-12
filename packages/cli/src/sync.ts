import {
  VividError,
  type Card,
  type Transaction,
  type Vivid,
} from '@mi-skam/vivid-sdk';
import { fetchAll } from './pagination';
import { historyWindowStart } from './period';
import type { Store } from './store';

/**
 * How far before the newest `updated_at` already stored an incremental sync
 * starts again. Records that become visible slightly late are still caught;
 * re-fetching a few known ones costs nothing because the upsert ignores them.
 */
export const SYNC_OVERLAP_MS = 60 * 60 * 1000;

export interface SyncResult {
  accounts: number;
  /** `null` when the key may not read cards. */
  cards: number | null;
  fetched: number;
  inserted: number;
  updated: number;
  requests: number;
  /** Accounts synced for the first time; their full 90 days were fetched. */
  newAccounts: number;
  /**
   * Set when the last sync is older than the API's history window: changes
   * made in between to transactions that have since left the window are lost.
   */
  gap: { from: string; to: string } | null;
}

/**
 * Brings the store up to date. Accounts synced before only fetch records
 * changed since the stored watermark; new accounts fetch the full 90 days.
 * Everything is written in one database transaction.
 */
export async function syncStore(
  client: Vivid,
  store: Store,
  now: Date = new Date(),
): Promise<SyncResult> {
  let requests = 0;
  const accounts = await client.accounts.list();
  requests += 1;

  let cards: Card[] | null;
  try {
    cards = await fetchAll(async (page) => {
      requests += 1;
      const response = await client.cards.list(page);
      return { items: response.cards, nextCursor: response.next_cursor };
    });
  } catch (error) {
    if (error instanceof VividError && error.hasCode('scope_denied')) {
      cards = null;
    } else {
      throw error;
    }
  }

  const known = store.historyFrom();
  const watermark = store.getMeta('watermark');
  const newIds = accounts.filter((a) => !known.has(a.id)).map((a) => a.id);
  const knownIds = accounts.filter((a) => known.has(a.id)).map((a) => a.id);

  const fetchChanges = (accountIds: string[], updatedFrom?: string) =>
    fetchAll(async (page) => {
      requests += 1;
      const response = await client.transactions.list({
        accountIds,
        ...(updatedFrom === undefined ? {} : { updatedFrom }),
        ...page,
      });
      return {
        items: response.transactions,
        nextCursor: response.next_cursor,
      };
    });

  const transactions: Transaction[] = [];
  if (newIds.length > 0) {
    transactions.push(...(await fetchChanges(newIds)));
  }
  if (knownIds.length > 0) {
    const from =
      watermark === null
        ? undefined
        : new Date(Date.parse(watermark) - SYNC_OVERLAP_MS).toISOString();
    transactions.push(...(await fetchChanges(knownIds, from)));
  }

  const windowStart = historyWindowStart(now);
  const gap =
    watermark !== null &&
    knownIds.length > 0 &&
    Date.parse(watermark) < windowStart.getTime()
      ? { from: watermark, to: windowStart.toISOString() }
      : null;

  const newWatermark = transactions.reduce<string | null>(
    (max, transaction) => {
      const updatedAt = new Date(transaction.updated_at).toISOString();
      return max === null || updatedAt > max ? updatedAt : max;
    },
    watermark,
  );

  const written = store.transaction(() => {
    store.upsertAccounts(accounts, now);
    if (cards !== null) {
      store.upsertCards(cards, now);
    }
    const result = store.upsertTransactions(transactions, now);
    store.setHistoryFrom(newIds, windowStart);
    if (newWatermark !== null) {
      store.setMeta('watermark', newWatermark);
    }
    store.setMeta('last_sync', now.toISOString());
    return result;
  });

  return {
    accounts: accounts.length,
    cards: cards === null ? null : cards.length,
    fetched: transactions.length,
    inserted: written.inserted,
    updated: written.updated,
    requests,
    newAccounts: newIds.length,
    gap,
  };
}
