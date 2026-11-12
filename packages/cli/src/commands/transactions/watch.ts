import type { Transaction } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { listOption } from '../../arguments';
import { requireClient } from '../../client';
import { amountLabel, merchantLabel } from '../../output';
import { fetchAll } from '../../pagination';
import { occurredAt } from '../../period';
import { resolveAccountIds } from '../../resolve';
import { Store } from '../../store';
import { watchTransactions, type WatchEvent } from '../../watch';

function describe(transaction: Transaction): string {
  return [
    occurredAt(transaction),
    amountLabel(transaction.amount, transaction.currency),
    merchantLabel(transaction) || transaction.type,
    transaction.state,
  ].join('  ');
}

function eventLine(event: WatchEvent): string {
  if (event.kind === 'new' || !event.previous) {
    return `NEW      ${describe(event.transaction)}`;
  }
  const changes: string[] = [];
  if (event.previous.state !== event.transaction.state) {
    changes.push(`${event.previous.state} → ${event.transaction.state}`);
  }
  if (event.previous.amount !== event.transaction.amount) {
    changes.push(`${event.previous.amount} → ${event.transaction.amount}`);
  }
  const detail = changes.length > 0 ? `  (${changes.join(', ')})` : '';
  return `UPDATED  ${describe(event.transaction)}${detail}`;
}

export default defineCommand({
  description:
    'Watch for new and changed transactions and print them as they appear, until Ctrl+C. Only changes made after the start are shown.',
  options: defineOptions(
    z.object({
      account: z
        .array(z.string())
        .optional()
        .describe(
          'Only watch this account, by ID or name. Repeat it or pass a comma-separated list. Defaults to every visible payment account.',
        ),
      type: z
        .array(z.string())
        .optional()
        .describe(
          'Only watch transactions of this type, e.g. card_payment. Repeat it or pass a comma-separated list.',
        ),
      interval: z.coerce
        .number()
        .int()
        .min(
          30,
          'Must be at least 30 seconds (the API allows 60 requests per minute per key).',
        )
        .default(60)
        .describe('Seconds between checks. Defaults to 60, at least 30.'),
      save: z
        .boolean()
        .default(false)
        .describe('Also save every record seen to the local database.'),
      json: z
        .boolean()
        .default(false)
        .describe(
          'Print one JSON object per line: {"event":"new"|"updated","transaction":{…}}.',
        ),
    }),
  ),
  action: async (options) => {
    const client = await requireClient();
    const targets = listOption(options.account);
    const accountIds =
      targets.length > 0
        ? await resolveAccountIds(client, targets)
        : (await client.accounts.list()).map((account) => account.id);
    if (accountIds.length === 0) {
      consola.error('No visible account to watch.');
      process.exit(1);
    }
    const types = listOption(options.type);
    const store = options.save ? await Store.open({ create: true }) : undefined;
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const interval = options.interval ?? 60;
    if (!options.json) {
      consola.info(
        `Watching ${accountIds.length} account(s) every ${interval} s. Press Ctrl+C to stop.`,
      );
    }
    try {
      await watchTransactions({
        intervalMs: interval * 1000,
        signal: controller.signal,
        fetchChanges: (updatedFrom) =>
          fetchAll(async (page) => {
            const response = await client.transactions.list({
              accountIds,
              types: types.length > 0 ? types : undefined,
              updatedFrom,
              ...page,
            });
            return {
              items: response.transactions,
              nextCursor: response.next_cursor,
            };
          }),
        onPoll: store
          ? (transactions) => {
              store.transaction(() =>
                store.upsertTransactions(transactions, new Date()),
              );
            }
          : undefined,
        onEvent: (event) => {
          if (options.json) {
            console.log(
              JSON.stringify({
                event: event.kind,
                transaction: event.transaction,
              }),
            );
          } else {
            console.log(eventLine(event));
          }
        },
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      store?.close();
    }
  },
});
