import type { Card, CardLimit } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireClient } from '../../client';
import { formatOptions, outputFormat, printCsv } from '../../format';
import { toCents } from '../../money';
import { printJson, printTable } from '../../output';
import { fetchAll } from '../../pagination';

/** A limit counts as nearly used up from this share on. */
export const LIMIT_WARNING_PERCENT = 80;

const COLUMNS = ['id', 'name', 'last4', 'type', 'state', 'account', 'limits'];

/** Whole percent of a limit used, or `null` when the limit tracks no usage. */
export function usedPercent(limit: CardLimit): number | null {
  if (limit.used === null) {
    return null;
  }
  const size = toCents(limit.size);
  if (size <= 0n) {
    return null;
  }
  return Number((toCents(limit.used) * 100n) / size);
}

/**
 * `spending/monthly 12.50/1000.00 EUR (1%)` per limit, `; `-separated, with
 * ` !` after a limit at or above {@link LIMIT_WARNING_PERCENT}.
 */
export function limitsLabel(card: Card): string {
  if (!card.limits_visible) {
    return 'hidden';
  }
  return card.limits
    .map((limit) => {
      const name = limit.renewal
        ? `${limit.type}/${limit.renewal}`
        : limit.type;
      const percent = usedPercent(limit);
      if (percent === null) {
        return `${name} ${limit.size} ${limit.currency}`;
      }
      const warning = percent >= LIMIT_WARNING_PERCENT ? ' !' : '';
      return `${name} ${limit.used}/${limit.size} ${limit.currency} (${percent}%)${warning}`;
    })
    .join('; ');
}

export default defineCommand({
  description:
    'List your cards with their limits and how much of each is used; ! marks a limit at 80% or more. Closed cards are never returned.',
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
      ...formatOptions,
    }),
  ),
  action: async (options) => {
    const format = outputFormat(options);
    const client = await requireClient();
    const cards = await fetchAll(
      async (page) => {
        const response = await client.cards.list(page);
        return { items: response.cards, nextCursor: response.next_cursor };
      },
      { limit: options.limit },
    );
    if (format === 'json') {
      printJson(cards);
      return;
    }
    const rows = cards.map((card) => ({
      id: card.id,
      name: card.name,
      last4: card.last_4 ?? '',
      type: card.type,
      state: card.state,
      account: card.account_id ?? '',
      limits: limitsLabel(card),
    }));
    if (format === 'csv') {
      printCsv(rows, { columns: COLUMNS, locale: options.csvLocale });
      return;
    }
    if (cards.length === 0) {
      consola.info('No cards found.');
      return;
    }
    printTable(rows);
  },
});
