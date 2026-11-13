import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { McpServer, PROTOCOL_VERSIONS, type Tool } from '../src/mcp/protocol';

const echo: Tool = {
  name: 'echo',
  description: 'Echoes its input.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  annotations: { readOnlyHint: true },
  call: vi.fn(async (input) => ({
    content: [{ type: 'text' as const, text: String(input['text']) }],
  })),
};

function server(): McpServer {
  return new McpServer(
    { name: 'vivid', version: '1.2.3', instructions: 'Be careful.' },
    [echo],
  );
}

async function call(method: string, params?: Record<string, unknown>) {
  return server().handle({ jsonrpc: '2.0', id: 1, method, params });
}

describe('McpServer', () => {
  it('echoes a supported protocol version and falls back to the newest', async () => {
    expect(await call('initialize', { protocolVersion: '2025-03-26' })).toEqual(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'vivid', version: '1.2.3' },
          instructions: 'Be careful.',
        },
      },
    );
    const fallback = await call('initialize', {
      protocolVersion: '1999-01-01',
    });
    expect(fallback).toMatchObject({
      result: { protocolVersion: PROTOCOL_VERSIONS[0] },
    });
  });

  it('answers ping and lists tools without their handler', async () => {
    expect(await call('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await call('tools/list')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes its input.',
            inputSchema: echo.inputSchema,
            annotations: { readOnlyHint: true },
          },
        ],
      },
    });
  });

  it('calls a tool with its arguments', async () => {
    expect(
      await call('tools/call', { name: 'echo', arguments: { text: 'ACME' } }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'ACME' }] },
    });
  });

  it('rejects unknown tools, bad arguments and unknown methods', async () => {
    expect(await call('tools/call', { name: 'nope' })).toMatchObject({
      error: { code: -32602 },
    });
    expect(
      await call('tools/call', { name: 'echo', arguments: [1] }),
    ).toMatchObject({ error: { code: -32602 } });
    expect(await call('resources/list')).toMatchObject({
      error: { code: -32601 },
    });
  });

  it('does not answer notifications', async () => {
    expect(
      await server().handle({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).toBeUndefined();
  });

  it('reports unparseable lines', async () => {
    expect(await server().handleLine('{nope')).toMatchObject({
      id: null,
      error: { code: -32700 },
    });
  });

  it('serves newline-delimited JSON in order', async () => {
    const input = new PassThrough();
    const written: string[] = [];
    const done = server().serveStdio(input, (line) => written.push(line));
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n\n');
    input.write(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    );
    input.end();
    await done;
    expect(written.map((line) => JSON.parse(line).id)).toEqual([1, 2]);
    expect(written.every((line) => line.endsWith('\n'))).toBe(true);
  });
});
