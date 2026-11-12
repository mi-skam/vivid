import type { Transaction } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { idArgument } from '../../arguments';
import {
  amountLabel,
  merchantLabel,
  printJson,
  printTable,
} from '../../output';
import { withStore } from '../../store';

/** Fields that change with every version and say nothing on their own. */
const IGNORED = new Set(['updated_at']);

function show(value: unknown): string {
  if (value === null || value === undefined) {
    return '–';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** `state: pending → completed; amount: -12.00 → -12.50` between two versions. */
export function describeChanges(
  previous: Transaction,
  current: Transaction,
): string {
  const before = previous as unknown as Record<string, unknown>;
  const after = current as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter(
      (key) =>
        !IGNORED.has(key) &&
        JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    )
    .map((key) => `${key}: ${show(before[key])} → ${show(after[key])}`)
    .join('; ');
}

export default defineCommand({
  description:
    'Show the change log of the local database: every version of a transaction that a sync has seen. Without an ID, the latest changes of all transactions. Makes no request.',
  args: z.tuple([
    idArgument
      .optional()
      .describe(
        'A transaction ID (UUID) to show every stored version of. If omitted, the latest changes of all transactions are shown.',
      ),
  ]),
  options: defineOptions(
    z.object({
      limit: z.coerce
        .number()
        .int()
        .positive()
        .default(20)
        .describe(
          'Without an ID, how many of the latest versions to show. Defaults to 20.',
        ),
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options, [transactionId]) => {
    const rows = await withStore({ create: false }, (store) => {
      const versions =
        transactionId === undefined
          ? store.versions({ limit: options.limit ?? 20 })
          : store.versions({ transactionId }).reverse();
      return versions.map((version) => {
        const previous = store.previousVersion(
          version.transaction.id,
          version.updatedAt,
        );
        return {
          ...version,
          change: previous ? 'updated' : 'new',
          changes: previous
            ? describeChanges(previous, version.transaction)
            : '',
        };
      });
    });
    if (options.json) {
      printJson(rows);
      return;
    }
    if (rows.length === 0) {
      consola.info(
        transactionId === undefined
          ? 'The change log is empty. Run `vivid db:sync` first.'
          : 'No stored versions of this transaction.',
      );
      return;
    }
    printTable(
      rows.map((row) => ({
        updated: row.updatedAt,
        recorded: row.recordedAt,
        change: row.change,
        id: row.transaction.id,
        amount: amountLabel(row.transaction.amount, row.transaction.currency),
        merchant: merchantLabel(row.transaction) || row.transaction.type,
        state: row.transaction.state,
        changes: row.changes,
      })),
    );
  },
});
