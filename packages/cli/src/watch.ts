import type { Transaction } from '@mi-skam/vivid-sdk';

/**
 * Each poll asks for records changed since the newest `updated_at` seen,
 * minus this overlap, so a record that becomes visible slightly late is not
 * missed. Records seen before are recognised and not reported twice.
 */
export const WATCH_OVERLAP_MS = 5 * 60 * 1000;

export interface WatchEvent {
  kind: 'new' | 'updated';
  transaction: Transaction;
  /** The version seen before, for `updated`. */
  previous?: Transaction;
}

export interface WatchOptions {
  /** Fetches every record of the watched accounts changed at or after `updatedFrom`. */
  fetchChanges: (updatedFrom: string) => Promise<Transaction[]>;
  intervalMs: number;
  signal: AbortSignal;
  onEvent: (event: WatchEvent) => void;
  /** Called with every poll's records, e.g. to save them locally. */
  onPoll?: (transactions: Transaction[]) => void | Promise<void>;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Polls until `signal` aborts. The first poll only records what already
 * exists, so only changes made after the start are reported.
 */
export async function watchTransactions(options: WatchOptions): Promise<void> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? abortableSleep;
  const seen = new Map<string, Transaction>();
  let newest = now().getTime();
  let first = true;
  while (!options.signal.aborted) {
    const updatedFrom = new Date(newest - WATCH_OVERLAP_MS).toISOString();
    const transactions = await options.fetchChanges(updatedFrom);
    if (options.signal.aborted) {
      return;
    }
    await options.onPoll?.(transactions);
    // Oldest change first, so events read in the order they happened.
    const ordered = [...transactions].sort(
      (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at),
    );
    for (const transaction of ordered) {
      const updatedAt = Date.parse(transaction.updated_at);
      newest = Math.max(newest, updatedAt);
      const previous = seen.get(transaction.id);
      if (previous && Date.parse(previous.updated_at) >= updatedAt) {
        continue;
      }
      seen.set(transaction.id, transaction);
      if (!first) {
        options.onEvent(
          previous
            ? { kind: 'updated', transaction, previous }
            : { kind: 'new', transaction },
        );
      }
    }
    first = false;
    await sleep(options.intervalMs, options.signal);
  }
}
