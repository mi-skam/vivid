import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { listOption } from '../../arguments';
import { requireClient } from '../../client';
import {
  amountLabel,
  merchantLabel,
  originalAmountLabel,
  printJson,
  printTable,
  toTimestamp,
} from '../../output';
import { fetchAll } from '../../pagination';
import { resolveAccountIds } from '../../resolve';

export default defineCommand({
  description:
    'List transactions of the last 90 days, newest first. Defaults to every visible payment account.',
  options: defineOptions(
    z.object({
      account: z
        .array(z.string())
        .optional()
        .describe(
          'Only show transactions of this account, by ID or name (e.g. Reserve). Repeat it or pass a comma-separated list. Cannot be combined with --account-type.',
        ),
      accountType: z
        .array(z.string())
        .optional()
        .describe(
          'Only show transactions of accounts of this type: current or other. Repeat it or pass a comma-separated list. Note: the API currently answers this filter with an internal error (500); prefer --account.',
        ),
      type: z
        .array(z.string())
        .optional()
        .describe(
          'Only show transactions of this type: card_payment, card_refund, atm, transfer, exchange, fee or other. Repeat it or pass a comma-separated list.',
        ),
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
          'Only show transactions changed at or after this moment (RFC 3339, or YYYY-MM-DD for midnight UTC).',
        ),
      updatedTo: z
        .string()
        .optional()
        .describe(
          'Only show transactions changed before this moment (RFC 3339, or YYYY-MM-DD for midnight UTC).',
        ),
      limit: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'The maximum number of transactions to return. Defaults to all of them.',
        ),
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const accountTargets = listOption(options.account);
    const accountTypes = listOption(options.accountType);
    if (accountTargets.length > 0 && accountTypes.length > 0) {
      consola.error('Pass either --account or --account-type, not both.');
      process.exit(1);
    }
    const types = listOption(options.type);
    const client = await requireClient();
    // The API needs exactly one of account_ids or account_types. Without a
    // filter, ask for every visible open account by ID: `account_types`
    // currently fails with 500 internal_error on the live API.
    const accountIds =
      accountTargets.length > 0
        ? await resolveAccountIds(client, accountTargets)
        : accountTypes.length > 0
          ? []
          : (await client.accounts.list()).map((account) => account.id);
    if (accountIds.length === 0 && accountTypes.length === 0) {
      if (options.json) {
        printJson([]);
      } else {
        consola.info('No transactions found.');
      }
      return;
    }
    const transactions = await fetchAll(
      async (page) => {
        const response = await client.transactions.list({
          ...(accountIds.length > 0 ? { accountIds } : { accountTypes }),
          types: types.length > 0 ? types : undefined,
          state: options.state,
          updatedFrom: toTimestamp(options.updatedFrom),
          updatedTo: toTimestamp(options.updatedTo),
          ...page,
        });
        return {
          items: response.transactions,
          nextCursor: response.next_cursor,
        };
      },
      { limit: options.limit },
    );
    if (options.json) {
      printJson(transactions);
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
