// Preloaded into the CLI process by error-codes.e2e.test.ts: replaces the
// global fetch with one that answers every request with FAKE_VIVID_RESPONSE
// and counts the calls in FAKE_VIVID_CALLS. No request leaves the process.
import { appendFileSync } from 'node:fs';
import process from 'node:process';

const { status, body, headers } = JSON.parse(process.env.FAKE_VIVID_RESPONSE);
const callsFile = process.env.FAKE_VIVID_CALLS;

globalThis.fetch = async (url) => {
  appendFileSync(callsFile, `${url}\n`);
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
};
