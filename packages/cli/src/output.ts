import type { Account, Transaction } from '@mi-skam/vivid-sdk';

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function printTable(rows: Array<Record<string, string>>): void {
  const first = rows[0];
  if (!first) {
    return;
  }
  const columns = Object.keys(first);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (values: string[]): string =>
    values.map((value, index) => value.padEnd(widths[index] ?? 0)).join('  ');
  console.log(line(columns.map((column) => column.toUpperCase())));
  for (const row of rows) {
    console.log(line(columns.map((column) => row[column] ?? '')));
  }
}

/** Formats an amount with its currency, or `''` when the amount is unknown. */
export function amountLabel(
  amount: string | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) {
    return '';
  }
  return currency ? `${amount} ${currency}` : amount;
}

/** The first IBAN of an account, preferring local details. */
export function accountIban(account: Account): string {
  const details = [...account.account_details].sort(
    (a, b) => Number(b.type === 'local') - Number(a.type === 'local'),
  );
  return details.find((detail) => detail.iban)?.iban ?? '';
}

/** The original amount of a transaction when it was made in another currency. */
export function originalAmountLabel(transaction: Transaction): string {
  if (
    transaction.original_amount === null ||
    transaction.original_currency === transaction.currency
  ) {
    return '';
  }
  return amountLabel(
    transaction.original_amount,
    transaction.original_currency,
  );
}

/** The merchant name of a transaction, if one was reported. */
export function merchantLabel(transaction: Transaction): string {
  return transaction.merchant?.name ?? '';
}

/**
 * Accepts RFC 3339 timestamps as-is and expands a plain `YYYY-MM-DD` date to
 * midnight UTC, which is how the API counts days.
 */
export function toTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
}
