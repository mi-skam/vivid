import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { categoryOf } from '../../categories';
import { formatOptions, outputFormat, printCsv } from '../../format';
import {
  amountLabel,
  merchantLabel,
  originalAmountLabel,
  printJson,
  printTable,
} from '../../output';
import { occurredAt } from '../../period';
import { queryTransactions, transactionFilterOptions } from '../../query';

const CSV_COLUMNS = [
  'id',
  'date',
  'account',
  'type',
  'state',
  'amount',
  'currency',
  'original_amount',
  'original_currency',
  'merchant',
  'city',
  'country',
  'mcc',
  'category',
  'card_last4',
];

export default defineCommand({
  description:
    'List transactions of the last 90 days, newest first. Defaults to every visible payment account. With --local, reads the local database instead.',
  options: defineOptions(
    z.object({
      ...transactionFilterOptions,
      state: z
        .string()
        .optional()
        .describe(
          'Only show transactions in this state: pending, completed or declined.',
        ),
      updatedFrom: z
        .string()
        .optional()
        .describe(
          'Only show transactions changed at or after this moment (RFC 3339, or YYYY-MM-DD for midnight UTC). For when a payment happened, use --since.',
        ),
      updatedTo: z
        .string()
        .optional()
        .describe(
          'Only show transactions changed before this moment (RFC 3339, or YYYY-MM-DD for midnight UTC). For when a payment happened, use --until.',
        ),
      limit: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'The maximum number of transactions to return. Defaults to all of them.',
        ),
      ...formatOptions,
    }),
  ),
  action: async (options) => {
    const format = outputFormat(options);
    const { transactions, accountNames } = await queryTransactions(options, {
      limit: options.limit,
    });
    if (format === 'json') {
      printJson(transactions);
      return;
    }
    if (format === 'csv') {
      printCsv(
        transactions.map((transaction) => ({
          id: transaction.id,
          date: occurredAt(transaction),
          account:
            accountNames.get(transaction.account_id) || transaction.account_id,
          type: transaction.type,
          state: transaction.state,
          amount: transaction.amount,
          currency: transaction.currency,
          original_amount:
            transaction.original_currency !== transaction.currency
              ? (transaction.original_amount ?? '')
              : '',
          original_currency:
            transaction.original_currency !== transaction.currency
              ? (transaction.original_currency ?? '')
              : '',
          merchant: transaction.merchant?.name ?? '',
          city: transaction.merchant?.city ?? '',
          country: transaction.merchant?.country ?? '',
          mcc: transaction.merchant?.category_code ?? '',
          category: categoryOf(transaction.merchant?.category_code) ?? '',
          card_last4: transaction.card?.last_4 ?? '',
        })),
        {
          columns: CSV_COLUMNS,
          locale: options.csvLocale,
          amountColumns: ['amount', 'original_amount'],
        },
      );
      return;
    }
    if (transactions.length === 0) {
      consola.info('No transactions found.');
      return;
    }
    printTable(
      transactions.map((transaction) => ({
        id: transaction.id,
        date: transaction.show_at ?? '',
        amount: amountLabel(transaction.amount, transaction.currency),
        original: originalAmountLabel(transaction),
        merchant: merchantLabel(transaction),
        type: transaction.type,
        state: transaction.state,
      })),
    );
  },
});
