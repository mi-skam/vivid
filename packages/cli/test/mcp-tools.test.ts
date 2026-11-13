import { consola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand, defineOptions } from 'zodline';
import { commands } from '../src/commands';
import {
  buildTools,
  pagingHint,
  shapeOutput,
  slim,
  toolKind,
  toolWording,
  type Command,
} from '../src/mcp/tools';
import { ACCOUNT_ID, account, transaction } from './fixtures';
import {
  BASE_PATH,
  errorResponse,
  jsonResponse,
  lastRequest,
  requests,
} from './helpers';

const fetchMock = vi.fn();

function text(result: { content: Array<{ text: string }> }): string {
  return result.content.map((part) => part.text).join('\n');
}

function tool(all: Record<string, Command>, name: string) {
  const found = buildTools(all).find((t) => t.name === name);
  if (!found) {
    throw new Error(`No tool ${name}`);
  }
  return found;
}

function properties(name: string): Record<string, Record<string, unknown>> {
  return tool(commands, name).inputSchema['properties'] as Record<
    string,
    Record<string, unknown>
  >;
}

describe('MCP tools from the CLI commands', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers the reads and db:sync, never the key or the endless watch', () => {
    const names = buildTools(commands).map((t) => t.annotations?.title);
    expect(names.sort()).toEqual([
      'accounts:get',
      'accounts:list',
      'cards:get',
      'cards:list',
      'db:history',
      'db:info',
      'db:sync',
      'doctor',
      'ping',
      'transactions:get',
      'transactions:list',
      'transactions:summary',
    ]);
    for (const hidden of ['login', 'logout', 'mcp', 'transactions:watch']) {
      expect(toolKind(hidden)).toBeUndefined();
    }
  });

  it('names tools without colons and marks reads read-only', () => {
    for (const t of buildTools(commands)) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.inputSchema['type']).toBe('object');
      expect(t.annotations?.readOnlyHint).toBe(
        toolKind(t.annotations!.title!) === 'read',
      );
      expect(t.annotations?.destructiveHint).not.toBe(true);
    }
  });

  it('words descriptions for tool callers, not for a shell', () => {
    for (const t of buildTools(commands)) {
      const described = [
        t.description,
        ...Object.values(
          t.inputSchema['properties'] as Record<
            string,
            Record<string, unknown>
          >,
        ).map((property) => String(property['description'] ?? '')),
      ];
      for (const description of described) {
        expect(description).not.toMatch(/you will be prompted|Repeat it|--/);
      }
    }
    expect(properties('transactions_list')['account']!['description']).toBe(
      'Only transactions of this account, by ID or name (e.g. Reserve). Cannot be combined with accountType.',
    );
  });

  it('requires the argument the CLI would prompt for and hides the output format', () => {
    const accountsGet = tool(commands, 'accounts_get');
    expect(accountsGet.inputSchema['required']).toEqual(['account']);
    expect(Object.keys(properties('accounts_get'))).toEqual(['account']);
    expect(tool(commands, 'cards_get').inputSchema['required']).toEqual([
      'card',
    ]);
    expect(tool(commands, 'transactions_get').inputSchema['required']).toEqual([
      'id',
    ]);

    const history = tool(commands, 'db_history');
    expect(history.inputSchema['required']).toBeUndefined();
    expect(Object.keys(properties('db_history'))).toEqual(['id', 'limit']);

    const list = Object.keys(properties('transactions_list'));
    expect(list).toContain('local');
    expect(list).toContain('since');
    for (const hidden of ['json', 'format', 'csvLocale']) {
      expect(list).not.toContain(hidden);
    }
    expect(properties('transactions_list')['account']).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    expect(properties('transactions_list')['limit']!['type']).toBe('integer');
  });

  it('returns the JSON output of the command without null fields', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ accounts: [{ ...account, balance: null }] }),
    );

    const result = await tool(commands, 'accounts_list').call({});

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify([{ ...account, balance: undefined }]),
      },
    ]);
    const { url, body } = lastRequest(fetchMock);
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/accounts/current/list`);
    expect(body).toEqual({ include_closed: false });
  });

  it('passes arguments and options on to the command', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      new URL(url).pathname.endsWith('/accounts/current/list')
        ? jsonResponse({ accounts: [account] })
        : jsonResponse({ transactions: [transaction], next_cursor: null }),
    );

    const result = await tool(commands, 'transactions_list').call({
      account: ['acme gmbh'],
      state: 'completed',
      limit: 5,
    });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual([
      // network_transaction_id is null in the fixture.
      expect.not.objectContaining({ network_transaction_id: null }),
    ]);
    expect(lastRequest(fetchMock).body).toMatchObject({
      account_ids: [ACCOUNT_ID],
      state: 'completed',
      limit: 5,
    });
  });

  it('reports a missing or malformed argument without a request', async () => {
    expect(await tool(commands, 'accounts_get').call({})).toEqual({
      content: [{ type: 'text', text: 'Missing required argument: account.' }],
      isError: true,
    });
    const malformed = await tool(commands, 'transactions_get').call({
      id: 'nope',
    });
    expect(malformed.isError).toBe(true);
    expect(text(malformed)).toContain('Must be a UUID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports API errors as tool errors and leaves login to the user', async () => {
    fetchMock.mockResolvedValue(errorResponse(401, 'invalid_key'));

    const result = await tool(commands, 'ping').call({});

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'The API key was not accepted. Check it, or run `vivid login` again.',
        },
      ],
      isError: true,
    });
  });

  it('rewords the hint of a filter conflict', async () => {
    const result = await tool(commands, 'transactions_list').call({
      account: ['Reserve'],
      accountType: ['current'],
    });

    expect(result).toEqual({
      content: [
        { type: 'text', text: 'Pass either account or accountType, not both.' },
      ],
      isError: true,
    });
    expect(requests(fetchMock)).toEqual([]);
  });

  it('points to db_sync when the local database is missing', async () => {
    vi.stubEnv('VIVID_DB', '/nonexistent/vivid-mcp-test.db');

    const result = await tool(commands, 'db_info').call({});

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('the db_sync tool');
    expect(text(result)).not.toContain('`vivid db:sync`');
  });
});

describe('command capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fake = (action: Command['action']): Record<string, Command> => ({
    'fake:list': defineCommand({
      description: 'A fake list.',
      options: defineOptions(
        z.object({
          state: z.string().default('completed'),
          json: z.boolean().default(false),
        }),
      ),
      action: action as never,
    }) as Command,
  });

  it('passes json and collects console and consola output', async () => {
    const seen = vi.fn();
    const all = fake(((options: unknown) => {
      seen(options);
      console.log('{"ok":true}');
      consola.warn('Older transactions are missing.');
    }) as Command['action']);

    const result = await tool(all, 'fake_list').call({});

    expect(seen).toHaveBeenCalledWith({ state: 'completed', json: true });
    expect(result.content.map((part) => part.text)).toEqual([
      '{"ok":true}',
      'Older transactions are missing.',
    ]);
    expect(result.isError).toBeUndefined();
  });

  it('turns process.exit into a failed call and keeps the process alive', async () => {
    const all = fake((() => {
      consola.error('No visible account.');
      process.exit(1);
    }) as Command['action']);
    const exit = process.exit;

    const result = await tool(all, 'fake_list').call({});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'No visible account.' }],
      isError: true,
    });
    expect(process.exit).toBe(exit);
  });

  it('reports a thrown error and restores console.log', async () => {
    const log = console.log;
    const all = fake((() => {
      throw new Error('Boom');
    }) as Command['action']);

    const result = await tool(all, 'fake_list').call({});

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Boom');
    expect(console.log).toBe(log);
  });

  it('fails when the command sets a non-zero exit code, keeping its output', async () => {
    const all = fake((() => {
      console.log('{"ping":null}');
      process.exitCode = 1;
    }) as Command['action']);

    const result = await tool(all, 'fake_list').call({});

    expect(result).toEqual({
      content: [{ type: 'text', text: '{}' }],
      isError: true,
    });
    expect(process.exitCode).toBeUndefined();
  });
});

describe('shapeOutput', () => {
  it('compacts JSON and drops null fields', () => {
    const indented = JSON.stringify(
      [{ id: '1', merchant: null, card: { id: null, last_4: '4242' } }],
      null,
      2,
    );
    expect(shapeOutput(indented)).toEqual({
      text: '[{"id":"1","card":{"last_4":"4242"}}]',
    });
  });

  it('cuts a long list to the records that fit, with a hint', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    const shaped = shapeOutput(JSON.stringify(records), 50, 'Narrow it.');
    const kept = JSON.parse(shaped.text) as unknown[];
    expect(shaped.text.length).toBeLessThanOrEqual(50);
    expect(kept).toEqual(records.slice(0, kept.length));
    expect(shaped.note).toBe(
      `Showing the first ${kept.length} of 10 records; the rest did not fit into one result. Narrow it.`,
    );
  });

  it('cuts text and objects that are too long', () => {
    expect(shapeOutput('x'.repeat(20), 10)).toEqual({
      text: 'x'.repeat(10),
      note: 'Output cut at 10 of 20 characters.',
    });
    expect(shapeOutput(JSON.stringify({ a: 'y'.repeat(20) }), 10).note).toBe(
      'Output cut at 10 of 28 characters.',
    );
  });
});

describe('slim', () => {
  it('keeps zeros, empty strings, false and empty lists', () => {
    const value = { amount: '0.00', name: '', visible: false, limits: [] };
    expect(slim(value)).toEqual(value);
  });
});

describe('pagingHint', () => {
  it('names the filters that narrow a query', () => {
    expect(pagingHint(['account', 'since', 'limit', 'local'])).toBe(
      'Narrow the query with account, since.',
    );
    expect(pagingHint(['limit'])).toBe(
      'This tool cannot narrow its query; the result is incomplete.',
    );
  });
});

describe('toolWording', () => {
  it('turns CLI hints into tool hints', () => {
    expect(
      toolWording(
        'Older ones are missing. Keep them with `vivid db:sync` and read them with --local.',
      ),
    ).toBe(
      'Older ones are missing. Keep them with the db_sync tool and read them with local set to true.',
    );
    expect(
      toolWording('The change log is empty. Run `vivid db:sync` first.'),
    ).toBe('The change log is empty. Call the db_sync tool first.');
    expect(
      toolWording('Pass either --month or --since/--until, not both.'),
    ).toBe('Pass either month or since/until, not both.');
  });

  it('leaves commands that are not tools to the user', () => {
    for (const message of [
      'Check it, or run `vivid login` again.',
      'Run `vivid transactions:watch` in a terminal.',
      'A merchant named ACME--Berlin.',
    ]) {
      expect(toolWording(message)).toBe(message);
    }
  });
});
