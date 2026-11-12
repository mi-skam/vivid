import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { printJson } from '../../output';
import { withStore } from '../../store';

export default defineCommand({
  description:
    'Show where the local database is, what it holds and when it was last synced. Makes no request.',
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const info = await withStore({ create: false }, (store) => store.info());
    if (options.json) {
      printJson(info);
      return;
    }
    consola.info(`Path: ${info.path} (${Math.ceil(info.bytes / 1024)} KiB)`);
    consola.info(`Accounts: ${info.accounts} · Cards: ${info.cards}`);
    consola.info(`Transactions: ${info.transactions}`);
    consola.info(
      `Payments from ${info.oldest ?? '-'} to ${info.newest ?? '-'}; complete from ${info.historyFrom ?? '-'} on.`,
    );
    consola.info(`Last sync: ${info.lastSync ?? 'never'}`);
  },
});
