import { consola } from 'consola';
import { isInteractive } from './interactive';
import { promptText } from './prompt';

interface RequiredOption<T> {
  value: T | undefined;
  /** Describes the missing value, for example `a card ID as a positional argument`. */
  requirement: string;
  /** Question asked when the option is missing in an interactive environment. */
  question: string;
}

/**
 * Returns the option value, asking for it when it is missing. Exits when the
 * value is missing in a non-interactive environment.
 */
export async function requireStringOption(
  options: RequiredOption<string>,
): Promise<string> {
  const value = options.value?.trim();
  if (value) {
    return value;
  }
  requireInteractive(options.requirement);
  const answer = (await promptText(options.question)).trim();
  if (!answer) {
    consola.error('The value must not be empty.');
    process.exit(1);
  }
  return answer;
}

function requireInteractive(requirement: string): void {
  if (!isInteractive()) {
    consola.error(
      `You must provide ${requirement} when running in a non-interactive environment.`,
    );
    process.exit(1);
  }
}
