import { Vivid } from '@mi-skam/vivid-sdk';
import { consola } from 'consola';
import { resolveApiKey } from './config';
import { pkg } from './package';

export function createClient(
  apiKey: string,
  options: { maxRetries?: number } = {},
): Vivid {
  return new Vivid({
    apiKey,
    userAgent: `${pkg.name}/${pkg.version}`,
    maxRetries: options.maxRetries,
  });
}

/**
 * Resolves the API key and returns a ready-to-use client. Exits with an
 * explanation when no key is available.
 */
export async function requireClient(): Promise<Vivid> {
  const { apiKey } = await resolveApiKey();
  if (!apiKey) {
    consola.error(
      'You must be logged in. Run `vivid login` or set the VIVID_API_KEY environment variable.',
    );
    process.exit(1);
  }
  return createClient(apiKey);
}
