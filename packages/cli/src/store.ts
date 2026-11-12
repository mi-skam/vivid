import type { Account, Card, Transaction } from '@mi-skam/vivid-sdk';
import { existsSync } from 'node:fs';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as Sqlite from 'node:sqlite';
import { occurredAt } from './period';

/**
 * The local transaction database. It keeps every transaction ever synced, so
 * history reaches back further than the API's 90 days, and lets list and
 * summary commands answer without a request. It holds live banking data and
 * is created with mode 0600 outside the repository.
 */
export function databasePath(): string {
  const explicit = process.env['VIVID_DB']?.trim();
  if (explicit) {
    return explicit;
  }
  const xdgDataHome = process.env['XDG_DATA_HOME'];
  const base = xdgDataHome ? xdgDataHome : join(homedir(), '.local', 'share');
  return join(base, 'vivid', 'vivid.db');
}

const SCHEMA_V1 = `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );
  CREATE INDEX transactions_occurred_at ON transactions (occurred_at);
  CREATE INDEX transactions_account ON transactions (account_id, occurred_at);
  -- history_from: from when on the store holds every transaction of the account.
  CREATE TABLE account_sync (
    account_id TEXT PRIMARY KEY,
    history_from TEXT NOT NULL
  );
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Every version of a transaction the store has seen, keyed by its
 * `updated_at`. A version is recorded when a sync (or `watch --save`) sees
 * it, so changes that happen and are superseded between two syncs are not
 * in the log. Existing rows become their own first version.
 */
const SCHEMA_V2 = `
  CREATE TABLE transaction_versions (
    transaction_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    state TEXT NOT NULL,
    amount TEXT NOT NULL,
    data TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (transaction_id, updated_at)
  );
  CREATE INDEX transaction_versions_updated_at ON transaction_versions (updated_at);
  INSERT INTO transaction_versions
    (transaction_id, updated_at, state, amount, data, recorded_at)
  SELECT id, updated_at, state, json_extract(data, '$.amount'), data, synced_at
  FROM transactions;
`;

/** `MIGRATIONS[n]` brings a database from schema version `n` to `n + 1`. */
const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2];
const SCHEMA_VERSION = MIGRATIONS.length;

/** Timestamps are stored as `toISOString()` so text comparison is time order. */
function iso(value: string | Date): string {
  return (typeof value === 'string' ? new Date(value) : value).toISOString();
}

/**
 * `node:sqlite` is built into Node.js 22.13 and later. It is loaded only when
 * a command needs the database, and its "experimental" warning is not shown:
 * it is noise for CLI users.
 */
async function loadSqlite(): Promise<typeof Sqlite> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const message = typeof warning === 'string' ? warning : warning.message;
    if (/sqlite/i.test(message)) {
      return;
    }
    return (emitWarning as (...args: unknown[]) => void).call(
      process,
      warning,
      ...rest,
    );
  }) as typeof process.emitWarning;
  try {
    return await import('node:sqlite');
  } catch {
    throw new Error(
      `The local database needs Node.js 22.13 or later (this is ${process.version}).`,
    );
  } finally {
    process.emitWarning = emitWarning;
  }
}

export interface TransactionQuery {
  accountIds?: string[];
  accountTypes?: string[];
  types?: string[];
  state?: string;
  updatedFrom?: string;
  updatedTo?: string;
  from?: Date;
  to?: Date;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
}

export interface TransactionVersion {
  /** `updated_at` of this version, as stored (millisecond precision). */
  updatedAt: string;
  /** When the store first saw this version. */
  recordedAt: string;
  transaction: Transaction;
}

export interface StoreInfo {
  path: string;
  bytes: number;
  accounts: number;
  cards: number;
  transactions: number;
  /** Rows in the change log, one per seen version. */
  versions: number;
  oldest: string | null;
  newest: string | null;
  historyFrom: string | null;
  lastSync: string | null;
}

export class Store {
  private constructor(
    private readonly db: Sqlite.DatabaseSync,
    readonly path: string,
  ) {}

  /**
   * Opens the database. With `create: false` a missing database is an error
   * that points to `vivid db:sync`, so read commands never create an empty one.
   */
  static async open(
    options: { create: boolean; path?: string } = { create: false },
  ): Promise<Store> {
    const path = options.path ?? databasePath();
    const exists = existsSync(path);
    if (!exists && !options.create) {
      throw new Error(
        `No local database at ${path}. Run \`vivid db:sync\` first.`,
      );
    }
    if (!exists) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    }
    const { DatabaseSync } = await loadSqlite();
    const db = new DatabaseSync(path);
    if (!exists) {
      await chmod(path, 0o600);
    }
    const store = new Store(db, path);
    store.migrate();
    return store;
  }

  private migrate(): void {
    const { user_version: version } = this.db
      .prepare('PRAGMA user_version')
      .get() as { user_version: number };
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `The local database at ${this.path} was created by a newer vivid version. Update the CLI.`,
      );
    }
    if (version < SCHEMA_VERSION) {
      this.transaction(() => {
        for (const step of MIGRATIONS.slice(version)) {
          this.db.exec(step);
        }
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  }

  close(): void {
    this.db.close();
  }

  /** Runs `work` in one SQLite transaction: all of it is written or none. */
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  upsertAccounts(accounts: Account[], syncedAt: Date): void {
    const statement = this.db.prepare(
      `INSERT INTO accounts (id, name, data, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, data = excluded.data, synced_at = excluded.synced_at`,
    );
    for (const account of accounts) {
      statement.run(
        account.id,
        account.name,
        JSON.stringify(account),
        iso(syncedAt),
      );
    }
  }

  upsertCards(cards: Card[], syncedAt: Date): void {
    const statement = this.db.prepare(
      `INSERT INTO cards (id, data, synced_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, synced_at = excluded.synced_at`,
    );
    for (const card of cards) {
      statement.run(card.id, JSON.stringify(card), iso(syncedAt));
    }
  }

  /**
   * Inserts new transactions and replaces stored ones with a newer
   * `updated_at`. A transaction that leaves the API's 90-day window stays.
   * Every inserted or newer version is also added to the change log.
   */
  upsertTransactions(
    transactions: Transaction[],
    syncedAt: Date,
  ): UpsertResult {
    const existing = this.db.prepare(
      'SELECT updated_at FROM transactions WHERE id = ?',
    );
    const write = this.db.prepare(
      `INSERT INTO transactions
         (id, account_id, account_type, type, state, occurred_at, updated_at, data, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         account_id = excluded.account_id, account_type = excluded.account_type,
         type = excluded.type, state = excluded.state,
         occurred_at = excluded.occurred_at, updated_at = excluded.updated_at,
         data = excluded.data, synced_at = excluded.synced_at`,
    );
    const log = this.db.prepare(
      `INSERT OR IGNORE INTO transaction_versions
         (transaction_id, updated_at, state, amount, data, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result: UpsertResult = { inserted: 0, updated: 0 };
    for (const transaction of transactions) {
      const updatedAt = iso(transaction.updated_at);
      const stored = existing.get(transaction.id) as
        { updated_at: string } | undefined;
      if (stored && stored.updated_at >= updatedAt) {
        continue;
      }
      const data = JSON.stringify(transaction);
      write.run(
        transaction.id,
        transaction.account_id,
        transaction.account_type,
        transaction.type,
        transaction.state,
        iso(occurredAt(transaction)),
        updatedAt,
        data,
        iso(syncedAt),
      );
      log.run(
        transaction.id,
        updatedAt,
        transaction.state,
        transaction.amount,
        data,
        iso(syncedAt),
      );
      if (stored) {
        result.updated += 1;
      } else {
        result.inserted += 1;
      }
    }
    return result;
  }

  /**
   * Versions from the change log, newest change first. With a transaction ID,
   * every version of that transaction; otherwise the latest `limit` versions
   * of all transactions.
   */
  versions(
    query: { transactionId?: string; limit?: number } = {},
  ): TransactionVersion[] {
    const where =
      query.transactionId === undefined ? '' : 'WHERE transaction_id = ?';
    const limit =
      query.limit === undefined
        ? ''
        : `LIMIT ${Math.max(0, Math.floor(query.limit))}`;
    const params =
      query.transactionId === undefined ? [] : [query.transactionId];
    return (
      this.db
        .prepare(
          `SELECT updated_at, recorded_at, data FROM transaction_versions ${where}
           ORDER BY updated_at DESC, transaction_id DESC ${limit}`,
        )
        .all(...params) as Array<{
        updated_at: string;
        recorded_at: string;
        data: string;
      }>
    ).map((row) => ({
      updatedAt: row.updated_at,
      recordedAt: row.recorded_at,
      transaction: JSON.parse(row.data) as Transaction,
    }));
  }

  /** The version of a transaction stored before `updatedAt`, if any. */
  previousVersion(
    transactionId: string,
    updatedAt: string,
  ): Transaction | null {
    const row = this.db
      .prepare(
        `SELECT data FROM transaction_versions
         WHERE transaction_id = ? AND updated_at < ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(transactionId, updatedAt) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Transaction) : null;
  }

  accounts(): Account[] {
    return this.db
      .prepare('SELECT data FROM accounts ORDER BY name, id')
      .all()
      .map((row) => JSON.parse((row as { data: string }).data) as Account);
  }

  cards(): Card[] {
    return this.db
      .prepare('SELECT data FROM cards ORDER BY id')
      .all()
      .map((row) => JSON.parse((row as { data: string }).data) as Card);
  }

  /** Stored transactions matching every given filter, newest first. */
  transactions(query: TransactionQuery = {}): Transaction[] {
    const where: string[] = [];
    const params: string[] = [];
    const inList = (column: string, values: string[] | undefined) => {
      if (values && values.length > 0) {
        where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
        params.push(...values);
      }
    };
    const compare = (sql: string, value: string | Date | undefined) => {
      if (value !== undefined) {
        where.push(sql);
        params.push(iso(value));
      }
    };
    inList('account_id', query.accountIds);
    inList('account_type', query.accountTypes);
    inList('type', query.types);
    if (query.state !== undefined) {
      where.push('state = ?');
      params.push(query.state);
    }
    compare('updated_at >= ?', query.updatedFrom);
    compare('updated_at < ?', query.updatedTo);
    compare('occurred_at >= ?', query.from);
    compare('occurred_at < ?', query.to);
    const sql = `SELECT data FROM transactions${
      where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
    } ORDER BY occurred_at DESC, id DESC`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => JSON.parse((row as { data: string }).data) as Transaction);
  }

  /** From when on the store holds every transaction, per account. */
  historyFrom(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT account_id, history_from FROM account_sync')
      .all() as Array<{ account_id: string; history_from: string }>;
    return new Map(rows.map((row) => [row.account_id, row.history_from]));
  }

  setHistoryFrom(accountIds: string[], from: Date): void {
    const statement = this.db.prepare(
      `INSERT INTO account_sync (account_id, history_from) VALUES (?, ?)
       ON CONFLICT (account_id) DO NOTHING`,
    );
    for (const accountId of accountIds) {
      statement.run(accountId, iso(from));
    }
  }

  getMeta(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  async info(): Promise<StoreInfo> {
    const count = (table: string) =>
      (
        this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
          n: number;
        }
      ).n;
    const range = this.db
      .prepare(
        'SELECT MIN(occurred_at) AS oldest, MAX(occurred_at) AS newest FROM transactions',
      )
      .get() as { oldest: string | null; newest: string | null };
    const history = this.db
      .prepare('SELECT MIN(history_from) AS history_from FROM account_sync')
      .get() as { history_from: string | null };
    return {
      path: this.path,
      bytes: (await stat(this.path)).size,
      accounts: count('accounts'),
      cards: count('cards'),
      transactions: count('transactions'),
      versions: count('transaction_versions'),
      oldest: range.oldest,
      newest: range.newest,
      historyFrom: history.history_from,
      lastSync: this.getMeta('last_sync'),
    };
  }
}

/** Opens the store, runs `work` and always closes it again. */
export async function withStore<T>(
  options: { create: boolean },
  work: (store: Store) => Promise<T> | T,
): Promise<T> {
  const store = await Store.open(options);
  try {
    return await work(store);
  } finally {
    store.close();
  }
}
