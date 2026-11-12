import type { Card, Transaction, Vivid } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { z } from 'zod';
import { isUuid, listOption } from './arguments';
import { requireClient } from './client';
import { toTimestamp } from './output';
import { fetchAll } from './pagination';
import {
  hasPeriod,
  historyWindowStart,
  inPeriod,
  momentLabel,
  parsePeriod,
  type Period,
} from './period';
import { pickAccount, pickCard, resolveAccountIds } from './resolve';
import { withStore } from './store';

/** Filters shared by `transactions:list` and `transactions:summary`. */
export const transactionFilterOptions = {
  account: z
    .array(z.string())
    .optional()
    .describe(
      'Only transactions of this account, by ID or name (e.g. Reserve). Repeat it or pass a comma-separated list. Cannot be combined with --account-type.',
    ),
  accountType: z
    .array(z.string())
    .optional()
    .describe(
      'Only transactions of accounts of this type: current or other. Repeat it or pass a comma-separated list. Note: the API currently answers this filter with an internal error (500); prefer --account.',
    ),
  type: z
    .array(z.string())
    .optional()
    .describe(
      'Only transactions of this type: card_payment, card_refund, atm, transfer, exchange, fee or other. Repeat it or pass a comma-separated list.',
    ),
  since: z
    .string()
    .optional()
    .describe(
      'Only transactions that happened at or after this moment: a relative age (7d, 2w), a date (YYYY-MM-DD, midnight UTC) or an RFC 3339 timestamp.',
    ),
  until: z
    .string()
    .optional()
    .describe(
      'Only transactions that happened before this moment; a plain date includes that whole day (UTC). Same formats as --since.',
    ),
  month: z
    .string()
    .optional()
    .describe(
      'Only transactions that happened in this calendar month (YYYY-MM, UTC). Cannot be combined with --since/--until.',
    ),
  card: z
    .string()
    .optional()
    .describe(
      'Only transactions made with this card, by ID, name or last four digits.',
    ),
  merchant: z
    .string()
    .optional()
    .describe(
      'Only transactions whose merchant name contains this text (case-insensitive).',
    ),
  local: z
    .boolean()
    .default(false)
    .describe(
      'Read from the local database (see `vivid db:sync`) instead of the API: no requests, and history older than 90 days.',
    ),
};

export interface TransactionFilters {
  account?: string[] | undefined;
  accountType?: string[] | undefined;
  type?: string[] | undefined;
  state?: string | undefined;
  updatedFrom?: string | undefined;
  updatedTo?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  month?: string | undefined;
  card?: string | undefined;
  merchant?: string | undefined;
  local?: boolean | undefined;
}

export interface TransactionSet {
  transactions: Transaction[];
  /** Account names by ID, as far as they were known without an extra request. */
  accountNames: Map<string, string>;
  /** Card names by ID, as far as they were known without an extra request. */
  cardNames: Map<string, string>;
  period: Period;
}

/** Matches a transaction's card against an ID, or last four digits. */
type CardMatcher = (transaction: Transaction) => boolean;

function cardMatcher(card: Card | { last4: string }): CardMatcher {
  return 'last4' in card
    ? (transaction) => transaction.card?.last_4 === card.last4
    : (transaction) => transaction.card?.id === card.id;
}

function applyFilters(
  transactions: Transaction[],
  period: Period,
  matchCard: CardMatcher | undefined,
  merchant: string | undefined,
): Transaction[] {
  const wanted = merchant?.trim().toLowerCase();
  return transactions.filter(
    (transaction) =>
      inPeriod(transaction, period) &&
      (matchCard === undefined || matchCard(transaction)) &&
      (!wanted ||
        (transaction.merchant?.name ?? '').toLowerCase().includes(wanted)),
  );
}

function rejectBothAccountFilters(accounts: string[], types: string[]): void {
  if (accounts.length > 0 && types.length > 0) {
    consola.error('Pass either --account or --account-type, not both.');
    process.exit(1);
  }
}

/**
 * Collects transactions from the API or the local database and applies the
 * filters the API cannot: the payment period, the card and the merchant.
 */
export async function queryTransactions(
  filters: TransactionFilters,
  options: { limit?: number | undefined; now?: Date } = {},
): Promise<TransactionSet> {
  const accountTargets = listOption(filters.account);
  const accountTypes = listOption(filters.accountType);
  rejectBothAccountFilters(accountTargets, accountTypes);
  const types = listOption(filters.type);
  const period = parsePeriod(filters, options.now);
  const result = filters.local
    ? await queryLocal(filters, { accountTargets, accountTypes, types, period })
    : await queryApi(filters, {
        accountTargets,
        accountTypes,
        types,
        period,
        limit: options.limit,
        now: options.now ?? new Date(),
      });
  return {
    ...result,
    transactions:
      options.limit === undefined
        ? result.transactions
        : result.transactions.slice(0, options.limit),
  };
}

interface Resolved {
  accountTargets: string[];
  accountTypes: string[];
  types: string[];
  period: Period;
}

async function queryApi(
  filters: TransactionFilters,
  resolved: Resolved & { limit: number | undefined; now: Date },
): Promise<TransactionSet> {
  const { accountTargets, accountTypes, types, period } = resolved;
  const windowStart = historyWindowStart(resolved.now);
  if (period.from !== undefined && period.from < windowStart) {
    consola.warn(
      `The API only serves transactions from ${momentLabel(windowStart)} on; older ones are missing. Keep them with \`vivid db:sync\` and read them with --local.`,
    );
  }
  const client = await requireClient();
  const accountNames = new Map<string, string>();
  // The API needs exactly one of account_ids or account_types. Without a
  // filter, ask for every visible open account by ID: `account_types`
  // currently fails with 500 internal_error on the live API.
  let accountIds: string[] = [];
  if (accountTargets.length > 0) {
    accountIds = await resolveAccountIds(client, accountTargets);
  } else if (accountTypes.length === 0) {
    const accounts = await client.accounts.list();
    for (const account of accounts) {
      accountNames.set(account.id, account.name);
    }
    accountIds = accounts.map((account) => account.id);
  }
  const cardNames = new Map<string, string>();
  const matchCard = await apiCardMatcher(client, filters.card, cardNames);
  if (accountIds.length === 0 && accountTypes.length === 0) {
    return { transactions: [], accountNames, cardNames, period };
  }
  const clientSide =
    hasPeriod(period) || matchCard !== undefined || Boolean(filters.merchant);
  const transactions = await fetchAll(
    async (page) => {
      const response = await client.transactions.list({
        ...(accountIds.length > 0 ? { accountIds } : { accountTypes }),
        types: types.length > 0 ? types : undefined,
        state: filters.state,
        updatedFrom: toTimestamp(filters.updatedFrom),
        updatedTo: toTimestamp(filters.updatedTo),
        ...page,
      });
      return {
        items: response.transactions,
        nextCursor: response.next_cursor,
      };
    },
    // Client-side filters need every record before the limit applies.
    { limit: clientSide ? undefined : resolved.limit },
  );
  return {
    transactions: applyFilters(
      transactions,
      period,
      matchCard,
      filters.merchant,
    ),
    accountNames,
    cardNames,
    period,
  };
}

/**
 * Four digits are matched against the transaction's card without a request;
 * a UUID is matched by ID; a name needs one card lookup.
 */
async function apiCardMatcher(
  client: Vivid,
  target: string | undefined,
  cardNames: Map<string, string>,
): Promise<CardMatcher | undefined> {
  if (target === undefined) {
    return undefined;
  }
  const trimmed = target.trim();
  if (/^\d{4}$/.test(trimmed)) {
    return cardMatcher({ last4: trimmed });
  }
  if (isUuid(trimmed)) {
    return (transaction) =>
      transaction.card?.id?.toLowerCase() === trimmed.toLowerCase();
  }
  const cards = await fetchAll(async (page) => {
    const response = await client.cards.list(page);
    return { items: response.cards, nextCursor: response.next_cursor };
  });
  const card = pickCard(cards, trimmed);
  cardNames.set(card.id, card.name);
  return cardMatcher(card);
}

async function queryLocal(
  filters: TransactionFilters,
  resolved: Resolved,
): Promise<TransactionSet> {
  const { accountTargets, accountTypes, types, period } = resolved;
  return withStore({ create: false }, (store) => {
    const accounts = store.accounts();
    const cards = store.cards();
    const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
    const cardNames = new Map(cards.map((c) => [c.id, c.name]));
    const accountIds = accountTargets.map(
      (target) => pickAccount(accounts, target).id,
    );
    let matchCard: CardMatcher | undefined;
    if (filters.card !== undefined) {
      const trimmed = filters.card.trim();
      matchCard =
        /^\d{4}$/.test(trimmed) &&
        !cards.some((card) => card.name.toLowerCase() === trimmed.toLowerCase())
          ? cardMatcher({ last4: trimmed })
          : cardMatcher(pickCard(cards, trimmed));
    }
    const historyFrom = [...store.historyFrom().entries()]
      .filter(([id]) => accountIds.length === 0 || accountIds.includes(id))
      .map(([, from]) => from)
      .sort()[0];
    if (
      historyFrom !== undefined &&
      period.from !== undefined &&
      period.from.toISOString() < historyFrom
    ) {
      consola.warn(
        `The local database is complete from ${momentLabel(new Date(historyFrom))} on; earlier transactions may be missing.`,
      );
    }
    const transactions = store.transactions({
      ...(accountIds.length > 0 ? { accountIds } : {}),
      ...(accountTypes.length > 0 ? { accountTypes } : {}),
      ...(types.length > 0 ? { types } : {}),
      ...(filters.state === undefined ? {} : { state: filters.state }),
      ...(filters.updatedFrom === undefined
        ? {}
        : { updatedFrom: toTimestamp(filters.updatedFrom) as string }),
      ...(filters.updatedTo === undefined
        ? {}
        : { updatedTo: toTimestamp(filters.updatedTo) as string }),
      ...(period.from === undefined ? {} : { from: period.from }),
      ...(period.to === undefined ? {} : { to: period.to }),
    });
    return {
      transactions: applyFilters(
        transactions,
        period,
        matchCard,
        filters.merchant,
      ),
      accountNames,
      cardNames,
      period,
    };
  });
}
