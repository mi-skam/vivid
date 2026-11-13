import { consola, type ConsolaReporter } from 'consola';
import { z } from 'zod';
import { formatError } from '../errors';
import type { Tool, ToolAnnotations, ToolResult } from './protocol';

/** The parts of a zodline command the server uses; any command fits. */
export interface Command {
  description?: string;
  options?: { schema: z.ZodObject };
  args?: z.ZodType;
  action: (options: never, args: never) => void | Promise<void>;
}

type Action = (options: unknown, args: unknown) => void | Promise<void>;

/**
 * Commands that only read: from Vivid, or from the local database. All
 * `:list` and `:get` commands count as reads as well.
 */
const READS = new Set([
  'db:history',
  'db:info',
  'doctor',
  'ping',
  'transactions:summary',
]);

/** Reads from Vivid, but writes the local database. */
const LOCAL_WRITES = new Set(['db:sync']);

/** Names for positional arguments; a single argument is `id` otherwise. */
const ARGUMENT_NAMES: Record<string, string[]> = {
  'accounts:get': ['account'],
  'cards:get': ['card'],
};

/** Commands whose positional arguments stay optional; for all others they are required. */
const OPTIONAL_ARGUMENTS = new Set(['db:history']);

/** Options every tool sets itself: the output is always JSON. */
const HIDDEN_OPTIONS = new Set(['json', 'format', 'csvLocale']);

/**
 * The largest result text a tool returns. Claude Code rejects results over
 * 25,000 tokens by default and counts the JSON-escaped text, which is longer
 * than the text itself, so stay well below. A longer list is cut to the
 * records that fit, with a note on how to narrow the query.
 */
export const MAX_RESULT_LENGTH = 40_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Drops `null` fields. The API sends every field and uses `null` for unknown
 * or not visible, which fills a result with noise: most transactions have no
 * original amount, many no merchant or card. The server instructions say that
 * a missing field is `null`. The CLI's own `--json` output is unchanged.
 */
export function slim(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => slim(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== null)
      .map(([key, entry]) => [key, slim(entry)]),
  );
}

/**
 * Compacts JSON output (the CLI indents it), {@link slim}s it and cuts an
 * array that is too long. Non-JSON output is cut as text.
 */
export function shapeOutput(
  text: string,
  maxLength = MAX_RESULT_LENGTH,
  hint = 'Narrow the query with filters.',
): { text: string; note?: string } {
  const cutText = (value: string): { text: string; note?: string } =>
    value.length > maxLength
      ? {
          text: value.slice(0, maxLength),
          note: `Output cut at ${maxLength} of ${value.length} characters.`,
        }
      : { text: value };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return cutText(text);
  }
  const shaped = slim(value);
  const compact = JSON.stringify(shaped);
  if (compact.length <= maxLength || !Array.isArray(shaped)) {
    return cutText(compact);
  }
  // Keep the longest prefix of records that fits.
  let length = 2;
  let count = 0;
  for (const record of shaped) {
    const size = JSON.stringify(record).length + (count > 0 ? 1 : 0);
    if (length + size > maxLength) {
      break;
    }
    length += size;
    count += 1;
  }
  return {
    text: JSON.stringify(shaped.slice(0, count)),
    note: `Showing the first ${count} of ${shaped.length} records; the rest did not fit into one result. ${hint}`,
  };
}

export type ToolKind = 'read' | 'local-write';

/**
 * Whether a command becomes a tool. `login` and `logout` change the stored
 * key and `transactions:watch` never returns, so they match nothing here; a
 * new command is not offered until it does.
 */
export function toolKind(name: string): ToolKind | undefined {
  if (name.endsWith(':list') || name.endsWith(':get') || READS.has(name)) {
    return 'read';
  }
  return LOCAL_WRITES.has(name) ? 'local-write' : undefined;
}

/** `transactions:list` → `transactions_list`; MCP tool names allow no colon. */
export function toolName(command: string): string {
  return command.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const ANNOTATIONS: Record<ToolKind, ToolAnnotations> = {
  read: { readOnlyHint: true, openWorldHint: true },
  'local-write': {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

function camelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Rewrites the CLI's wording for a tool caller: "Keep them with `vivid
 * db:sync` and read them with --local." becomes "Keep them with the db_sync
 * tool and read them with local set to true.", and `--account-type` becomes
 * the input name `accountType`. Commands that are not tools, such as `vivid
 * login`, stay as they are: those are for the user to run.
 */
export function toolWording(message: string): string {
  const tool = (command: string): string | undefined =>
    toolKind(command) ? toolName(command) : undefined;
  return message
    .replace(/\bRun `vivid ([a-z-]+:[a-z-]+)`/g, (match, command: string) =>
      tool(command) ? `Call the ${tool(command)} tool` : match,
    )
    .replace(/`vivid ([a-z-]+:[a-z-]+)`/g, (match, command: string) =>
      tool(command) ? `the ${tool(command)} tool` : match,
    )
    .replace(/\b(with) --local\b/gi, '$1 local set to true')
    .replace(
      /(^|[\s(/])--([a-z]+(?:-[a-z]+)*)/g,
      (_, before: string, flag: string) => `${before}${camelCase(flag)}`,
    );
}

/** Drops the CLI's hints on prompting and repeating flags, which do not apply to tool calls. */
function cleanDescription(text: string | undefined): string | undefined {
  return text === undefined
    ? undefined
    : toolWording(
        text
          .replace(/\s*If omitted, you will be prompted\./g, '')
          .replace(/\s*Repeat it or pass a comma-separated list\./g, ''),
      ).trim();
}

function argumentItems(command: Command): z.ZodType[] {
  const args = command.args as z.ZodType | undefined;
  return args instanceof z.ZodTuple ? (args.def.items as z.ZodType[]) : [];
}

function argumentNames(name: string, command: Command): string[] {
  const items = argumentItems(command);
  const names = ARGUMENT_NAMES[name] ?? (items.length === 1 ? ['id'] : []);
  if (names.length !== items.length) {
    throw new Error(`No MCP argument names for the arguments of ${name}.`);
  }
  return names;
}

/**
 * The tool's input: the command's positional arguments as named properties,
 * then its options, minus the output format.
 */
function inputSchema(name: string, command: Command): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  const items = argumentItems(command);
  argumentNames(name, command).forEach((argument, index) => {
    const declared = items[index]!;
    // The CLI prompts for a missing argument; a tool call cannot.
    shape[argument] =
      declared instanceof z.ZodOptional && !OPTIONAL_ARGUMENTS.has(name)
        ? (declared.unwrap() as z.ZodType).describe(declared.description ?? '')
        : declared;
  });
  const options = (command.options?.schema as z.ZodObject | undefined)?.shape;
  for (const [key, option] of Object.entries(options ?? {})) {
    if (!HIDDEN_OPTIONS.has(key)) {
      shape[key] = option as z.ZodType;
    }
  }
  return z.object(shape);
}

/** The JSON Schema a client sees, with descriptions worded for tool callers. */
function jsonSchemaOf(schema: z.ZodObject): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete jsonSchema['$schema'];
  const properties = (jsonSchema['properties'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  for (const property of Object.values(properties)) {
    const description = cleanDescription(
      property['description'] as string | undefined,
    );
    if (description) {
      property['description'] = description;
    } else {
      delete property['description'];
    }
  }
  return jsonSchema;
}

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function formatLog(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
}

/**
 * Runs a command as the CLI would with `--json`, capturing what it prints.
 * `console.log` output is the result; consola messages (warnings, errors)
 * come back as notes. `process.exit` ends the call, not the server.
 */
export async function runCommand(
  command: Command,
  options: Record<string, unknown>,
  args: unknown[],
  hint?: string,
): Promise<ToolResult> {
  const output: string[] = [];
  const notes: string[] = [];
  const log = console.log;
  const exit = process.exit;
  const exitCode = process.exitCode;
  const reporter: ConsolaReporter = {
    log: (entry) => {
      notes.push(formatLog(entry.args));
    },
  };
  const reporters = consola.options.reporters;
  console.log = (...values: unknown[]) => {
    output.push(formatLog(values));
  };
  process.exit = ((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as typeof process.exit;
  consola.setReporters([reporter]);
  process.exitCode = undefined;
  let failed: boolean;
  try {
    await (command.action as Action)(options, args);
    failed = Boolean(process.exitCode);
  } catch (error) {
    if (error instanceof ExitSignal) {
      failed = error.code !== 0;
    } else {
      failed = true;
      notes.push(formatError(error));
    }
  } finally {
    console.log = log;
    process.exit = exit;
    process.exitCode = exitCode;
    consola.setReporters(reporters);
  }
  const content: ToolResult['content'] = [];
  if (output.length > 0) {
    const shaped = shapeOutput(output.join('\n'), MAX_RESULT_LENGTH, hint);
    content.push({ type: 'text', text: shaped.text });
    if (shaped.note) {
      notes.push(shaped.note);
    }
  }
  if (notes.length > 0) {
    content.push({ type: 'text', text: toolWording(notes.join('\n')) });
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: failed ? 'Failed.' : 'Done.' });
  }
  return failed ? { content, isError: true } : { content };
}

/**
 * How to reach the records a cut result left out. The API pages with cursors
 * the CLI follows itself, so a tool can only narrow its query.
 */
export function pagingHint(inputs: readonly string[]): string {
  const filters = inputs.filter(
    (input) => !['limit', 'local', 'id'].includes(input),
  );
  return filters.length > 0
    ? `Narrow the query with ${filters.join(', ')}.`
    : 'This tool cannot narrow its query; the result is incomplete.';
}

function failure(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function buildTools(commands: Record<string, Command>): Tool[] {
  const tools: Tool[] = [];
  for (const [name, command] of Object.entries(commands)) {
    const kind = toolKind(name);
    if (!kind) {
      continue;
    }
    const schema = inputSchema(name, command);
    const names = argumentNames(name, command);
    const jsonSchema = jsonSchemaOf(schema);
    tools.push({
      name: toolName(name),
      description:
        cleanDescription(command.description) ?? `The ${name} command.`,
      inputSchema: jsonSchema,
      annotations: { title: name, ...ANNOTATIONS[kind] },
      call: async (input) => {
        const required = (jsonSchema['required'] as string[] | undefined) ?? [];
        const missing = required.filter((key) => input[key] === undefined);
        if (missing.length > 0) {
          return failure(
            `Missing required argument${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
          );
        }
        const parsed = schema.safeParse(input);
        if (!parsed.success) {
          return failure(formatError(parsed.error));
        }
        const values = { ...parsed.data } as Record<string, unknown>;
        const args = names.map((argument) => {
          const value = values[argument];
          delete values[argument];
          return value;
        });
        const commandOptions = command.options?.schema
          ? (command.options.schema as z.ZodObject).parse({
              ...values,
              json: true,
            })
          : {};
        return runCommand(
          command,
          commandOptions,
          args,
          pagingHint(Object.keys(schema.shape)),
        );
      },
    });
  }
  return tools;
}
