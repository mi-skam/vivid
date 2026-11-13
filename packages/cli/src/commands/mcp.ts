import { consola } from 'consola';
import { defineCommand } from 'zodline';
import { commands } from '../commands';
import { McpServer } from '../mcp/protocol';
import { buildTools } from '../mcp/tools';
import { pkg } from '../package';

const INSTRUCTIONS = `Tools for a Vivid Business bank account, one per CLI command (transactions_list = \`vivid transactions:list\`). Everything is read-only: the Vivid API cannot move money or change the account. Results are the CLI's JSON output, as the API sends it (snake_case; amounts are decimal strings in the account's currency, negative for a debit), with fields that are null left out: a missing field is unknown or not visible to the API key, such as a hidden balance.

- transactions_list and transactions_summary take \`local: true\`: they then answer from the local database without API requests (the API allows 60 per minute) and reach back further than the API's 90 days. Run db_sync first when the database is missing or stale (db_info shows the last sync); db_history shows what syncs found changed.
- For totals call transactions_summary instead of adding up transactions_list; amounts of different currencies are never added.
- since, until and month filter by when a payment happened; updatedFrom and updatedTo by when a record last changed.
- A result that would be too long is cut to the records that fit, with a note; narrow the query with filters.
- Accounts and cards can be given by name instead of ID. When a call fails because the API key is missing or rejected, ask the user to run \`vivid login\` or \`vivid doctor\` in a terminal.`;

export default defineCommand({
  description:
    'Run a Model Context Protocol server on stdin/stdout that offers the read commands as tools, for Claude Code and other MCP clients. Register it with `claude mcp add vivid -- vivid mcp`.',
  action: async () => {
    // stdout carries the protocol; anything else goes to stderr.
    console.log = (...values: unknown[]) => {
      console.error(...values);
    };
    consola.options.stdout = process.stderr;
    const tools = buildTools(commands);
    const server = new McpServer(
      { name: 'vivid', version: pkg.version, instructions: INSTRUCTIONS },
      tools,
    );
    consola.info(`vivid MCP server ${pkg.version}: ${tools.length} tools.`);
    await server.serveStdio();
  },
});
