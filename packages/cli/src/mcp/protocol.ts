import { createInterface } from 'node:readline';

/**
 * A minimal Model Context Protocol server over stdio: newline-delimited
 * JSON-RPC 2.0 with `initialize`, `ping`, `tools/list` and `tools/call`.
 * That is all a local tool server needs, so the CLI does not depend on the
 * official SDK and its HTTP stack.
 */

/** Newest first; the client's version is echoed when supported. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  call: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

interface Request {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Response =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | {
      jsonrpc: '2.0';
      id: string | number | null;
      error: { code: number; message: string };
    };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function failure(
  id: string | number | null,
  code: number,
  message: string,
): Response {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export class McpServer {
  private readonly tools: Map<string, Tool>;

  constructor(
    private readonly info: ServerInfo,
    tools: readonly Tool[],
  ) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  /** Answers one raw line; `undefined` for notifications. */
  async handleLine(line: string): Promise<Response | undefined> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return failure(null, PARSE_ERROR, 'Parse error');
    }
    if (
      typeof message !== 'object' ||
      message === null ||
      Array.isArray(message) ||
      typeof (message as Request).method !== 'string'
    ) {
      // A response from the client (we send no requests) or garbage.
      return 'id' in (message as object) && !('method' in (message as object))
        ? undefined
        : failure(null, INVALID_REQUEST, 'Invalid request');
    }
    return this.handle(message as Request);
  }

  async handle(request: Request): Promise<Response | undefined> {
    const isNotification = request.id === undefined;
    const id = request.id ?? null;
    let response: Response;
    try {
      response = { jsonrpc: '2.0', id, result: await this.dispatch(request) };
    } catch (error) {
      response =
        error instanceof ProtocolError
          ? failure(id, error.code, error.message)
          : failure(
              id,
              -32603,
              error instanceof Error ? error.message : String(error),
            );
    }
    return isNotification ? undefined : response;
  }

  private async dispatch(request: Request): Promise<unknown> {
    const params = request.params ?? {};
    switch (request.method) {
      case 'initialize': {
        const requested = params['protocolVersion'];
        return {
          protocolVersion:
            typeof requested === 'string' &&
            PROTOCOL_VERSIONS.includes(requested)
              ? requested
              : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.info.name, version: this.info.version },
          ...(this.info.instructions
            ? { instructions: this.info.instructions }
            : {}),
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return {
          tools: [...this.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        };
      case 'tools/call': {
        const name = params['name'];
        const tool =
          typeof name === 'string' ? this.tools.get(name) : undefined;
        if (!tool) {
          throw new ProtocolError(
            INVALID_PARAMS,
            `Unknown tool: ${String(name)}`,
          );
        }
        const input = params['arguments'] ?? {};
        if (
          typeof input !== 'object' ||
          input === null ||
          Array.isArray(input)
        ) {
          throw new ProtocolError(
            INVALID_PARAMS,
            'arguments must be an object',
          );
        }
        return tool.call(input as Record<string, unknown>);
      }
      default:
        if (request.method.startsWith('notifications/')) {
          return {};
        }
        throw new ProtocolError(
          METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
        );
    }
  }

  /**
   * Serves stdin/stdout until stdin closes. Requests are answered one at a
   * time, in order: tools capture the CLI's console output, which must not
   * interleave.
   */
  async serveStdio(
    input: NodeJS.ReadableStream = process.stdin,
    write: (line: string) => void = (line) => process.stdout.write(line),
  ): Promise<void> {
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim() === '') {
        continue;
      }
      const response = await this.handleLine(line);
      if (response) {
        write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

class ProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
