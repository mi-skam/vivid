import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireTargetArgument, targetArgument } from '../../arguments';
import { requireClient } from '../../client';
import { amountLabel, printJson } from '../../output';
import { resolveCardId } from '../../resolve';

export default defineCommand({
  description: 'Show a single card and its limits.',
  args: z.tuple([
    targetArgument
      .optional()
      .describe(
        'The card ID (UUID), card name or last four digits. If omitted, you will be prompted.',
      ),
  ]),
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options, [targetId]) => {
    const client = await requireClient();
    const cardId = await resolveCardId(
      client,
      await requireTargetArgument({
        value: targetId,
        requirement:
          'a card ID, name or last four digits as a positional argument',
        question: 'Enter the card ID, name or last four digits:',
      }),
    );
    const card = await client.cards.get({ cardId });
    if (options.json) {
      printJson(card);
      return;
    }
    consola.info(`ID: ${card.id}`);
    consola.info(`Name: ${card.name || '-'}`);
    consola.info(`Last 4: ${card.last_4 ?? '-'}`);
    consola.info(`Type: ${card.type}`);
    consola.info(`State: ${card.state}`);
    consola.info(`Account: ${card.account_id ?? '-'}`);
    if (!card.limits_visible) {
      consola.info('Limits: not visible to the key');
    } else if (card.limits.length === 0) {
      consola.info('Limits: none');
    }
    for (const limit of card.limits) {
      const used = limit.used === null ? '' : `, used ${limit.used}`;
      consola.info(
        `Limit: ${limit.type} ${limit.renewal ?? 'once'} ${amountLabel(limit.size, limit.currency)}${used}`,
      );
    }
  },
});
