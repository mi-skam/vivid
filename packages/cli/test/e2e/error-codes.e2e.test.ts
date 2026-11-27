import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const preload = fileURLToPath(new URL('./fake-fetch.mjs', import.meta.url));

interface FakeResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vivid-e2e-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the built CLI in a child process against a faked fetch. */
async function runCli(args: string[], response: FakeResponse) {
  const callsFile = join(dir, 'calls');
  const env = {
    PATH: process.env.PATH,
    VIVID_API_KEY: 'vivid_sk_v1_test',
    XDG_CONFIG_HOME: dir,
    CI: '1',
    FAKE_VIVID_RESPONSE: JSON.stringify(response),
    FAKE_VIVID_CALLS: callsFile,
  };
  const result = await exec(
    process.execPath,
    ['--import', preload, cli, ...args],
    { env },
  ).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
  const calls = readFileSync(callsFile, 'utf8').trim().split('\n');
  return { ...result, calls };
}

function errorBody(code: string) {
  return {
    trace_id: 'trace-e2e',
    errors: [{ code, message: `${code} message from the API` }],
  };
}

describe('vivid CLI error codes (end to end)', () => {
  it('explains 403 tariff_unavailable without retrying', async () => {
    const result = await runCli(['ping'], {
      status: 403,
      body: errorBody('tariff_unavailable'),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "Your company's Vivid plan does not include API access",
    );
    expect(result.calls).toHaveLength(1);
  });

  it('retries 503 service_unavailable, then explains it with the trace id', async () => {
    const result = await runCli(['ping'], {
      status: 503,
      body: errorBody('service_unavailable'),
      headers: { 'Retry-After': '0' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('temporarily unavailable');
    expect(result.stderr).toContain('trace-e2e');
    // One request plus three retries.
    expect(result.calls).toHaveLength(4);
    expect(result.calls[0]).toMatch(/\/api\/v1\/ping$/);
  });

  it('prints the API message for an unknown 403 code', async () => {
    const result = await runCli(['ping'], {
      status: 403,
      body: errorBody('brand_new_code'),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('brand_new_code message from the API');
  });
});
