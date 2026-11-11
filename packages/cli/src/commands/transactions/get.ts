import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { idArgument, requireIdArgument } from '../../arguments';
import { requireClient } from '../../client';
import { amountLabel, originalAmountLabel, printJson } from '../../output';

export default defineCommand({
  description: 'Show a single transaction of the last 90 days.',
  args: z.tuple([
    idArgument
      .optional()
      .describe('The transaction ID (UUID). If omitted, you will be prompted.'),
  ]),
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options, [targetId]) => {
    const client = await requireClient();
    const transactionId = await requireIdArgument({
      value: targetId,
      requirement: 'a transaction ID as a positional argument',
      question: 'Enter the transaction ID:',
    });
    const transaction = await client.transactions.get({ transactionId });
    if (options.json) {
      printJson(transaction);
      return;
    }
    const merchant = transaction.merchant;
    consola.info(`ID: ${transaction.id}`);
    consola.info(`Date: ${transaction.show_at ?? '-'}`);
    consola.info(
      `Amount: ${amountLabel(transaction.amount, transaction.currency)}`,
    );
    consola.info(`Original amount: ${originalAmountLabel(transaction) || '-'}`);
    consola.info(`Type: ${transaction.type}`);
    consola.info(`State: ${transaction.state}`);
    consola.info(
      `Merchant: ${merchant?.name ?? '-'}${merchant?.city ? `, ${merchant.city}` : ''}${merchant?.country ? ` (${merchant.country})` : ''}`,
    );
    consola.info(
      `Card: ${transaction.card ? `${transaction.card.id ?? '-'} (…${transaction.card.last_4 ?? '????'})` : '-'}`,
    );
    consola.info(
      `Account: ${transaction.account_id} (${transaction.account_type})`,
    );
    consola.info(`Group: ${transaction.group_id}`);
    consola.info(`Created: ${transaction.created_at}`);
    consola.info(`Updated: ${transaction.updated_at}`);
  },
});
