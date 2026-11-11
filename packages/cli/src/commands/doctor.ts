import type { Vivid } from '@mi-skam/vivid-sdk';
import { VividError } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { createClient } from '../client';
import { resolveApiKey } from '../config';
import { formatError } from '../errors';
import { printJson } from '../output';
import { pkg } from '../package';

type PermissionStatus = 'granted' | 'denied' | 'unknown' | 'error';

interface PermissionResult {
  status: PermissionStatus;
  error: string | null;
}

/** Returned by a probe that could not run, e.g. without a visible account. */
const SKIPPED = Symbol('skipped');

function isScopeDenied(error: unknown): boolean {
  return (
    error instanceof VividError &&
    error.status === 403 &&
    error.hasCode('scope_denied')
  );
}

/**
 * Probes `transactions:read` through one visible account. Filtering by
 * `account_types` currently fails with `500 internal_error` on the live API,
 * so the probe asks for a single row of an explicit account instead. Without
 * `accounts:read` or without any visible account the permission cannot be
 * checked and is reported as unknown rather than denied.
 */
async function probeTransactions(client: Vivid): Promise<unknown> {
  let accounts;
  try {
    accounts = await client.accounts.list();
  } catch (error) {
    if (isScopeDenied(error)) {
      return SKIPPED;
    }
    throw error;
  }
  const [account] = accounts;
  if (!account) {
    return SKIPPED;
  }
  return client.transactions.list({ accountIds: [account.id], limit: 1 });
}

/**
 * One cheap read per permission. The API is read-only, so probing is safe;
 * paged routes ask for a single row.
 */
const PROBES: Array<{ permission: string; probe: (client: Vivid) => unknown }> =
  [
    { permission: 'accounts:read', probe: (client) => client.accounts.list() },
    { permission: 'transactions:read', probe: probeTransactions },
    {
      permission: 'cards:read',
      probe: (client) => client.cards.list({ limit: 1 }),
    },
  ];

async function probePermission(
  client: Vivid,
  probe: (client: Vivid) => unknown,
): Promise<PermissionResult> {
  try {
    if ((await probe(client)) === SKIPPED) {
      return { status: 'unknown', error: null };
    }
    return { status: 'granted', error: null };
  } catch (error) {
    // scope_denied only means the key was not issued with this permission.
    if (isScopeDenied(error)) {
      return { status: 'denied', error: null };
    }
    return { status: 'error', error: formatError(error) };
  }
}

export default defineCommand({
  description:
    'Check the CLI setup, the connection to the Vivid API and the permissions of the API key.',
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const { apiKey, source } = await resolveApiKey();
    let ping: string | undefined;
    let apiError: string | undefined;
    const permissions: Record<string, PermissionResult> = {};
    if (apiKey) {
      // One retry at most: doctor should answer quickly, also when the API
      // keeps failing with 5xx.
      const client = createClient(apiKey, { maxRetries: 1 });
      try {
        ping = (await client.ping()).status;
      } catch (error) {
        apiError = formatError(error);
      }
      if (!apiError) {
        for (const { permission, probe } of PROBES) {
          permissions[permission] = await probePermission(client, probe);
        }
      }
    }
    const probeFailed = Object.values(permissions).some(
      (result) => result.status === 'error',
    );
    if (options.json) {
      printJson({
        cliVersion: pkg.version,
        nodeVersion: process.version,
        keySource: source,
        ping: ping ?? null,
        apiError: apiError ?? null,
        permissions,
      });
    } else {
      consola.info(`CLI version: ${pkg.version}`);
      consola.info(`Node.js version: ${process.version}`);
      consola.info(`Key source: ${source}`);
      if (!apiKey) {
        consola.warn(
          'No API key found. Run `vivid login` or set the VIVID_API_KEY environment variable.',
        );
      } else if (apiError) {
        consola.error(`API connection failed: ${apiError}`);
      } else {
        consola.success(`API connection succeeded (ping: ${ping}).`);
        for (const [permission, result] of Object.entries(permissions)) {
          if (result.status === 'granted') {
            consola.success(`${permission}: granted`);
          } else if (result.status === 'denied') {
            consola.info(`${permission}: not granted`);
          } else if (result.status === 'unknown') {
            consola.info(
              `${permission}: unknown (needs accounts:read and a visible account to check)`,
            );
          } else {
            consola.error(`${permission}: check failed: ${result.error}`);
          }
        }
      }
    }
    if (!apiKey || apiError || probeFailed) {
      process.exitCode = 1;
    }
  },
});
