import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireClient } from '../../client';
import { accountIban, printJson, printTable } from '../../output';

export default defineCommand({
  description: 'List your payment accounts.',
  options: defineOptions(
    z.object({
      includeClosed: z
        .boolean()
        .default(false)
        .describe('Include closed accounts. Defaults to open accounts only.'),
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const client = await requireClient();
    // Not paged: the route returns every account at once.
    const accounts = await client.accounts.list({
      includeClosed: options.includeClosed,
    });
    if (options.json) {
      printJson(accounts);
      return;
    }
    if (accounts.length === 0) {
      consola.info('No accounts found.');
      return;
    }
    printTable(
      accounts.map((account) => ({
        id: account.id,
        name: account.name,
        iban: accountIban(account),
        currency: account.currency,
        state: account.state,
        available: account.balance?.available ?? '',
        pending: account.balance?.pending ?? '',
      })),
    );
  },
});
