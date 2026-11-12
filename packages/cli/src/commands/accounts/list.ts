import type { Account } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireClient } from '../../client';
import { formatOptions, outputFormat, printCsv } from '../../format';
import { formatCents, toCents } from '../../money';
import { accountIban, printJson, printTable } from '../../output';

const COLUMNS = [
  'id',
  'name',
  'iban',
  'currency',
  'state',
  'available',
  'pending',
];

/**
 * One `TOTAL` row per currency. Accounts whose balance the key may not see
 * are counted, not taken as zero, so a total never looks complete when it is
 * not.
 */
export function totalRows(accounts: Account[]): Array<Record<string, string>> {
  const totals = new Map<
    string,
    { available: bigint; pending: bigint; hidden: number; count: number }
  >();
  for (const account of accounts) {
    const total = totals.get(account.currency) ?? {
      available: 0n,
      pending: 0n,
      hidden: 0,
      count: 0,
    };
    totals.set(account.currency, total);
    total.count += 1;
    if (account.balance === null) {
      total.hidden += 1;
      continue;
    }
    total.available += toCents(account.balance.available);
    total.pending += toCents(account.balance.pending ?? '0');
  }
  return [...totals.entries()]
    .filter(([, total]) => total.count > 1)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      id: '',
      name: 'TOTAL',
      iban: total.hidden > 0 ? `${total.hidden} balance(s) hidden` : '',
      currency,
      state: '',
      available: formatCents(total.available),
      pending: formatCents(total.pending),
    }));
}

export default defineCommand({
  description:
    'List your payment accounts, with a total per currency when there are several.',
  options: defineOptions(
    z.object({
      includeClosed: z
        .boolean()
        .default(false)
        .describe('Include closed accounts. Defaults to open accounts only.'),
      ...formatOptions,
    }),
  ),
  action: async (options) => {
    const format = outputFormat(options);
    const client = await requireClient();
    // Not paged: the route returns every account at once.
    const accounts = await client.accounts.list({
      includeClosed: options.includeClosed,
    });
    if (format === 'json') {
      printJson(accounts);
      return;
    }
    const rows = accounts.map((account) => ({
      id: account.id,
      name: account.name,
      iban: accountIban(account),
      currency: account.currency,
      state: account.state,
      available: account.balance?.available ?? '',
      pending: account.balance?.pending ?? '',
    }));
    if (format === 'csv') {
      printCsv(rows, {
        columns: COLUMNS,
        locale: options.csvLocale,
        amountColumns: ['available', 'pending'],
      });
      return;
    }
    if (accounts.length === 0) {
      consola.info('No accounts found.');
      return;
    }
    printTable([...rows, ...totalRows(accounts)]);
  },
});
