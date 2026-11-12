import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireClient } from '../../client';
import { printJson } from '../../output';
import { momentLabel } from '../../period';
import { withStore } from '../../store';
import { syncStore } from '../../sync';

export default defineCommand({
  description:
    'Copy accounts, cards and transactions into the local database. The first run fetches the last 90 days; later runs fetch only what changed. Transactions stay after they leave the API’s 90-day window, so run it at least every 90 days to keep a complete history.',
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const client = await requireClient();
    const { result, path } = await withStore(
      { create: true },
      async (store) => ({
        result: await syncStore(client, store),
        path: store.path,
      }),
    );
    if (options.json) {
      printJson({ path, ...result });
      return;
    }
    if (result.gap) {
      consola.warn(
        `The previous sync was before the API's 90-day window (${momentLabel(new Date(result.gap.from))}). Changes made in between to transactions from before ${momentLabel(new Date(result.gap.to))} could not be fetched.`,
      );
    }
    if (result.cards === null) {
      consola.info('Cards skipped: the API key has no cards:read permission.');
    }
    const cards = result.cards === null ? '' : `, ${result.cards} cards`;
    consola.success(
      `Synced ${result.accounts} accounts${cards} and ${result.fetched} transaction records (${result.inserted} new, ${result.updated} updated) with ${result.requests} requests.`,
    );
    consola.info(`Database: ${path}`);
  },
});
