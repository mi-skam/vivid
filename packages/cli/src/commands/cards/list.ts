import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireClient } from '../../client';
import { printJson, printTable } from '../../output';
import { fetchAll } from '../../pagination';

export default defineCommand({
  description: 'List your cards. Closed cards are never returned.',
  options: defineOptions(
    z.object({
      limit: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'The maximum number of cards to return. Defaults to all of them.',
        ),
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const client = await requireClient();
    const cards = await fetchAll(
      async (page) => {
        const response = await client.cards.list(page);
        return { items: response.cards, nextCursor: response.next_cursor };
      },
      { limit: options.limit },
    );
    if (options.json) {
      printJson(cards);
      return;
    }
    if (cards.length === 0) {
      consola.info('No cards found.');
      return;
    }
    printTable(
      cards.map((card) => ({
        id: card.id,
        name: card.name,
        last4: card.last_4 ?? '',
        type: card.type,
        state: card.state,
        account: card.account_id ?? '',
      })),
    );
  },
});
