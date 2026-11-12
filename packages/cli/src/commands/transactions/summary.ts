import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { formatOptions, outputFormat, printCsv } from '../../format';
import { printJson, printTable } from '../../output';
import { momentLabel } from '../../period';
import { queryTransactions, transactionFilterOptions } from '../../query';
import { SUMMARY_GROUPS, summarize } from '../../summary';

const COLUMNS = [
  'currency',
  'group',
  'count',
  'out',
  'refunds',
  'in',
  'transfers',
  'net',
];
const AMOUNT_COLUMNS = ['out', 'refunds', 'in', 'transfers', 'net'];

export default defineCommand({
  description:
    'Sum up transactions per merchant, category, card, account, type or month, separately per currency. Counts completed transactions unless --include-pending is set; declined ones never count.',
  options: defineOptions(
    z.object({
      by: z
        .enum(SUMMARY_GROUPS)
        .default('merchant')
        .describe(
          'What to group by: merchant (default), category (merchant category code group), card, account, type or month.',
        ),
      includePending: z
        .boolean()
        .default(false)
        .describe(
          'Also count pending transactions, whose amount may still change.',
        ),
      ...transactionFilterOptions,
      ...formatOptions,
    }),
  ),
  action: async (options) => {
    const format = outputFormat(options);
    const states = new Set(
      options.includePending ? ['completed', 'pending'] : ['completed'],
    );
    const { transactions, accountNames, cardNames, period } =
      await queryTransactions(options);
    const counted = transactions.filter((t) => states.has(t.state));
    const rows = summarize(
      counted,
      options.by ?? 'merchant',
      { accountNames, cardNames },
      { withTotals: format === 'table' },
    );
    if (format === 'json') {
      printJson(rows);
      return;
    }
    const cells = rows.map((row) => ({ ...row, count: String(row.count) }));
    if (format === 'csv') {
      printCsv(cells, {
        columns: COLUMNS,
        locale: options.csvLocale,
        amountColumns: AMOUNT_COLUMNS,
      });
      return;
    }
    if (rows.length === 0) {
      consola.info('No transactions found.');
      return;
    }
    const range =
      period.from || period.to
        ? `${period.from ? momentLabel(period.from) : '…'} to ${period.to ? momentLabel(period.to) : 'now'}`
        : options.local
          ? 'everything stored locally'
          : 'the last 90 days';
    consola.info(
      `${counted.length} ${[...states].join(' and ')} transactions, ${range}. OUT is money spent; TRANSFERS (transfers and exchanges) stay out of it.`,
    );
    printTable(
      cells.map((row) =>
        Object.fromEntries(
          COLUMNS.map((column) => [
            column,
            row[column as keyof typeof row] as string,
          ]),
        ),
      ),
    );
  },
});
