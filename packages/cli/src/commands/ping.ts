import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { requireClient } from '../client';
import { printJson } from '../output';

export default defineCommand({
  description:
    'Check that the Vivid API is reachable and the API key is accepted.',
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const client = await requireClient();
    const response = await client.ping();
    if (options.json) {
      printJson(response);
      return;
    }
    consola.success(`API connection succeeded (ping: ${response.status}).`);
  },
});
