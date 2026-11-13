import { consola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { processConfig, type CommandDefinition } from 'zodline';
import { idArgument, listOption, requireIdArgument } from '../src/arguments';
import { isInteractive } from '../src/interactive';
import { promptText } from '../src/prompt';

vi.mock('../src/interactive');
vi.mock('../src/prompt');

const ID = '00000000-0000-4000-8000-000000000001';
const modules = import.meta.glob<CommandDefinition<z.ZodObject, z.ZodType>>(
  '../src/commands/**/*.ts',
  { eager: true, import: 'default' },
);
const idCommands = ['accounts:get', 'transactions:get', 'cards:get'];
/** Accounts and cards can also be named; transactions have no name. */
const nameCommands = ['accounts:get', 'cards:get'];

function command(name: string) {
  const result = modules[`../src/commands/${name.replace(':', '/')}.ts`];
  if (!result) throw new Error(`Missing command: ${name}`);
  return result;
}
function parse(name: string, args: string[]) {
  return processConfig({ commands: { [name]: command(name) } }, [
    name,
    ...args,
  ]);
}

describe('positional primary inputs', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock.mockReset());
    vi.mocked(isInteractive).mockReturnValue(false);
    vi.spyOn(consola, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1)');
    }) as (code?: number) => never);
  });
  afterEach(() => {
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it.each(idCommands)('%s accepts a UUID as its primary argument', (name) => {
    const result = parse(name, [ID, '--json']);
    expect(result.args).toEqual([ID]);
    expect(result.options.json).toBe(true);
    expect(parse(name, [ID.toUpperCase()]).args).toEqual([ID.toUpperCase()]);
  });

  it.each(idCommands)(
    '%s allows omission for the interactive prompt',
    (name) => {
      expect(parse(name, ['--json']).args).toEqual([]);
    },
  );

  it.each(nameCommands)(
    '%s accepts a name instead of an ID, but no empty value, --id or extra operands',
    (name) => {
      expect(parse(name, ['Reserve']).args).toEqual(['Reserve']);
      expect(parse(name, ['  Main account  ']).args).toEqual(['Main account']);
      expect(() => parse(name, ['   '])).toThrow();
      expect(() => parse(name, [ID, ID])).toThrow();
      expect(() => parse(name, ['--id', ID])).toThrow();
    },
  );

  it.each(['transactions:get'])(
    '%s rejects invalid IDs, --id and extra operands before executing anything',
    (name) => {
      for (const id of [
        '42',
        'abc',
        `${ID}0`,
        `{${ID}}`,
        ID.replace(/-/g, ''),
      ]) {
        expect(() => parse(name, [id])).toThrow();
      }
      expect(() => parse(name, [ID, ID])).toThrow();
      expect(() => parse(name, ['--id', ID])).toThrow();
    },
  );

  it('every command supports --json', () => {
    for (const [path, module] of Object.entries(modules)) {
      // The stdout of `mcp` is the protocol itself.
      if (path.endsWith('/commands/mcp.ts')) {
        continue;
      }
      expect(
        module.options?.schema.shape ?? {},
        `${path} has no --json option`,
      ).toHaveProperty('json');
    }
  });

  it('keeps filters as named, repeatable options', () => {
    expect(
      parse('transactions:list', [
        '--account',
        ID,
        '--account',
        ID,
        '--type',
        'fee',
        '--limit',
        '5',
      ]).options,
    ).toMatchObject({ account: [ID, ID], type: ['fee'], limit: 5 });
    expect(
      parse('accounts:list', ['--include-closed']).options.includeClosed,
    ).toBe(true);
    expect(() => parse('cards:list', ['--limit', '0'])).toThrow();
  });

  it('flattens comma-separated list options', () => {
    expect(listOption(['a,b', ' c ', ',', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(listOption(undefined)).toEqual([]);
  });

  it('uses the same ID validation for positional values and interactive answers', async () => {
    expect(idArgument.parse(` ${ID} `)).toBe(ID);
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(promptText).mockResolvedValue(` ${ID} `);
    expect(
      await requireIdArgument({
        value: undefined,
        requirement: 'an ID',
        question: 'ID?',
      }),
    ).toBe(ID);
    expect(promptText).toHaveBeenCalledWith('ID?');
    vi.mocked(promptText).mockResolvedValue('42');
    await expect(
      requireIdArgument({
        value: undefined,
        requirement: 'an ID',
        question: 'ID?',
      }),
    ).rejects.toThrow();
  });

  it('does not prompt for a missing ID in non-interactive mode', async () => {
    await expect(
      requireIdArgument({
        value: undefined,
        requirement: 'an ID as a positional argument',
        question: 'ID?',
      }),
    ).rejects.toThrow('process.exit(1)');
    expect(promptText).not.toHaveBeenCalled();
    expect(consola.error).toHaveBeenCalledWith(
      'You must provide an ID as a positional argument when running in a non-interactive environment.',
    );
  });
});
