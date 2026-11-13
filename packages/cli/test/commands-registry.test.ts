import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commands } from '../src/commands';

const COMMANDS_DIR = join(import.meta.dirname, '..', 'src', 'commands');

/** `commands/transactions/list.ts` → `transactions:list`; top-level files keep their name. */
async function commandFiles(): Promise<string[]> {
  const entries = await readdir(COMMANDS_DIR, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) =>
      relative(COMMANDS_DIR, join(entry.parentPath, entry.name))
        .replace(/\.ts$/, '')
        .replace(/[\\/]/, ':'),
    );
}

describe('command registry', () => {
  it('registers every command file', async () => {
    const registered = new Set([...Object.keys(commands), 'mcp']);
    const missing = (await commandFiles()).filter(
      (name) => !registered.has(name),
    );
    expect(missing).toEqual([]);
  });
});
