import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { readConfig, writeConfig } from '../config';
import { printJson } from '../output';

export default defineCommand({
  description: 'Log out by removing the stored API key.',
  options: defineOptions(
    z.object({
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    const { apiKey, ...config } = await readConfig();
    if (apiKey) {
      await writeConfig(config);
    }
    const environmentKeySet = Boolean(process.env['VIVID_API_KEY']?.trim());
    if (options.json) {
      printJson({ loggedOut: Boolean(apiKey), environmentKeySet });
      return;
    }
    if (apiKey) {
      consola.success('Logged out.');
    } else {
      consola.info('You are not logged in.');
    }
    if (environmentKeySet) {
      consola.warn(
        'The VIVID_API_KEY environment variable is still set and will be used for authentication.',
      );
    }
  },
});
