import { z } from 'zod';
import { requireStringOption } from './options';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Vivid identifies accounts, transactions and cards by UUIDs in 8-4-4-4-12
 * form. The API answers anything else with `400 invalid_request`, so reject it
 * before sending a request. Filters stay named options.
 */
export const idArgument = z
  .string()
  .trim()
  .regex(UUID_PATTERN, 'Must be a UUID (8-4-4-4-12 hexadecimal digits).');

/** True when the value is a Vivid id rather than a name. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/**
 * An account or card given by ID or by name. Names are resolved against the
 * visible objects (see `src/resolve.ts`), so only emptiness is checked here.
 */
export const targetArgument = z.string().trim().min(1, 'Must not be empty.');

/** Prompts for a target (ID or name) when it is missing; see {@link targetArgument}. */
export async function requireTargetArgument(
  options: Parameters<typeof requireStringOption>[0],
): Promise<string> {
  return targetArgument.parse(await requireStringOption(options));
}

/** Validate both positional input and the interactive ID prompt. */
export async function requireIdArgument(
  options: Parameters<typeof requireStringOption>[0],
): Promise<string> {
  return idArgument.parse(await requireStringOption(options));
}

/**
 * Flattens a repeatable option that also accepts comma-separated values, so
 * `--account a --account b` and `--account a,b` are equivalent.
 */
export function listOption(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
