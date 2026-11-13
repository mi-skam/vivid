import type { Transaction } from '@mi-skam/vivid-sdk';
import { categoryOf } from './categories';
import { formatCents, toCents } from './money';
import { occurredAt } from './period';

export const SUMMARY_GROUPS = [
  'merchant',
  'category',
  'card',
  'account',
  'type',
  'month',
] as const;
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

export interface SummaryRow {
  currency: string;
  group: string;
  count: number;
  /**
   * Money spent: card payments, ATM, fees and transfers sent to other banks —
   * every debit that is not a movement between own accounts.
   */
  out: string;
  /** Card refunds, kept apart so `out` stays what was actually charged. */
  refunds: string;
  /** Money received, such as transfers from other banks; never card refunds. */
  in: string;
  /**
   * Net of money moved between own accounts: exchanges, and transfers whose
   * group is in {@link SummaryContext.internalGroups}.
   */
  transfers: string;
  net: string;
}

interface Totals {
  count: number;
  out: bigint;
  refunds: bigint;
  in: bigint;
  transfers: bigint;
}

export interface SummaryContext {
  accountNames: Map<string, string>;
  cardNames: Map<string, string>;
  /**
   * Group IDs of transfers between own accounts (`internalGroupIds` in
   * `src/query.ts`). A transfer outside it is money sent or received.
   */
  internalGroups: Set<string>;
}

/** Moves money between own accounts rather than spending or earning it. */
function isInternal(
  transaction: Transaction,
  context: SummaryContext,
): boolean {
  return (
    transaction.type === 'exchange' ||
    (transaction.type === 'transfer' &&
      context.internalGroups.has(transaction.group_id))
  );
}

function groupKey(
  transaction: Transaction,
  by: SummaryGroup,
  context: SummaryContext,
): string {
  switch (by) {
    case 'merchant':
      return transaction.merchant?.name || '(no merchant)';
    case 'category':
      return (
        categoryOf(transaction.merchant?.category_code) ??
        `(${transaction.type})`
      );
    case 'card': {
      const card = transaction.card;
      if (!card || (!card.id && !card.last_4)) {
        return '(no card)';
      }
      const name = card.id ? context.cardNames.get(card.id) : undefined;
      const digits = card.last_4 ? `…${card.last_4}` : (card.id ?? '');
      return name ? `${name} (${digits})` : digits;
    }
    case 'account':
      return (
        context.accountNames.get(transaction.account_id) ||
        transaction.account_id
      );
    case 'type':
      return transaction.type;
    case 'month':
      return new Date(occurredAt(transaction)).toISOString().slice(0, 7);
  }
}

function add(
  totals: Totals,
  transaction: Transaction,
  context: SummaryContext,
): void {
  const cents = toCents(transaction.amount);
  totals.count += 1;
  if (isInternal(transaction, context)) {
    totals.transfers += cents;
  } else if (transaction.type === 'card_refund') {
    totals.refunds += cents;
  } else if (cents < 0n) {
    totals.out += cents;
  } else {
    totals.in += cents;
  }
}

function row(currency: string, group: string, totals: Totals): SummaryRow {
  return {
    currency,
    group,
    count: totals.count,
    out: formatCents(totals.out),
    refunds: formatCents(totals.refunds),
    in: formatCents(totals.in),
    transfers: formatCents(totals.transfers),
    net: formatCents(
      totals.out + totals.refunds + totals.in + totals.transfers,
    ),
  };
}

const empty = (): Totals => ({
  count: 0,
  out: 0n,
  refunds: 0n,
  in: 0n,
  transfers: 0n,
});

/**
 * Groups transactions per currency — amounts in different currencies are
 * never added up — and sorts each currency's groups by money spent, largest
 * first; months are sorted newest first. With `withTotals`, every currency
 * ends with a `TOTAL` row.
 */
export function summarize(
  transactions: Transaction[],
  by: SummaryGroup,
  context: SummaryContext,
  options: { withTotals?: boolean } = {},
): SummaryRow[] {
  const byCurrency = new Map<string, Map<string, Totals>>();
  for (const transaction of transactions) {
    const groups =
      byCurrency.get(transaction.currency) ?? new Map<string, Totals>();
    byCurrency.set(transaction.currency, groups);
    const key = groupKey(transaction, by, context);
    const totals = groups.get(key) ?? empty();
    groups.set(key, totals);
    add(totals, transaction, context);
  }
  const rows: SummaryRow[] = [];
  for (const currency of [...byCurrency.keys()].sort()) {
    const groups = byCurrency.get(currency) as Map<string, Totals>;
    const entries = [...groups.entries()].sort(([a, x], [b, y]) =>
      by === 'month'
        ? b.localeCompare(a)
        : x.out === y.out
          ? a.localeCompare(b)
          : x.out < y.out
            ? -1
            : 1,
    );
    const total = empty();
    for (const [group, totals] of entries) {
      rows.push(row(currency, group, totals));
      total.count += totals.count;
      total.out += totals.out;
      total.refunds += totals.refunds;
      total.in += totals.in;
      total.transfers += totals.transfers;
    }
    if (options.withTotals) {
      rows.push(row(currency, 'TOTAL', total));
    }
  }
  return rows;
}
