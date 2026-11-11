import { consola } from 'consola';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { createClient } from '../client';
import { configPath, readConfig, writeConfig } from '../config';
import { isInteractive } from '../interactive';
import { printJson } from '../output';
import { promptSecret } from '../prompt';

export default defineCommand({
  description: 'Log in with your Vivid Business API key.',
  options: defineOptions(
    z.object({
      apiKey: z
        .string()
        .optional()
        .describe(
          'The Vivid Business API key (vivid_sk_v1_…). If omitted, you will be prompted.',
        ),
      json: z.boolean().default(false).describe('Output in JSON format.'),
    }),
  ),
  action: async (options) => {
    let apiKey = options.apiKey?.trim();
    if (!apiKey) {
      if (!isInteractive()) {
        consola.error(
          'You must provide an API key via --api-key when running in a non-interactive environment.',
        );
        process.exit(1);
      }
      consola.info(
        'Create an API key in Vivid Business on the web under API > Add API token.',
      );
      apiKey = (await promptSecret('Enter your Vivid API key:')).trim();
    }
    // Validate before saving: a key that cannot ping is never stored.
    await createClient(apiKey).ping();
    await writeConfig({ ...(await readConfig()), apiKey });
    if (options.json) {
      printJson({ loggedIn: true, configPath: configPath() });
      return;
    }
    consola.success(`Logged in. API key stored in ${configPath()}.`);
  },
});
