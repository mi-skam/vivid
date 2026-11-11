import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireTargetArgument, targetArgument } from '../../arguments';
import { requireClient } from '../../client';
import { amountLabel, printJson } from '../../output';
import { resolveAccountId } from '../../resolve';

export default defineCommand({
  description: 'Show a single payment account.',
  args: z.tuple([
    targetArgument
      .optional()
      .describe(
        'The account ID (UUID) or name, e.g. Reserve. If omitted, you will be prompted.',
      ),
  ]),
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options, [targetId]) => {
    const client = await requireClient();
    const accountId = await resolveAccountId(
      client,
      await requireTargetArgument({
        value: targetId,
        requirement: 'an account ID or name as a positional argument',
        question: 'Enter the account ID or name:',
      }),
    );
    const account = await client.accounts.get({ accountId });
    if (options.json) {
      printJson(account);
      return;
    }
    consola.info(`ID: ${account.id}`);
    consola.info(`Name: ${account.name || '-'}`);
    consola.info(`Currency: ${account.currency}`);
    consola.info(`State: ${account.state}`);
    consola.info(
      `Available: ${amountLabel(account.balance?.available, account.currency) || '-'}`,
    );
    consola.info(
      `Pending: ${amountLabel(account.balance?.pending, account.currency) || '-'}`,
    );
    for (const details of account.account_details) {
      consola.info(
        `IBAN (${details.type}): ${details.iban ?? '-'} · BIC: ${details.bic ?? '-'} · Holder: ${details.holder_name ?? '-'} · Bank: ${details.bank_name ?? '-'}`,
      );
    }
    consola.info(`Created: ${account.created_at ?? '-'}`);
  },
});
