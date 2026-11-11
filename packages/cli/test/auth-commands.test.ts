import { consola } from 'consola';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import login from '../src/commands/login';
import logout from '../src/commands/logout';
import { configPath, readConfig, writeConfig } from '../src/config';
import { isInteractive } from '../src/interactive';
import { promptSecret, promptText } from '../src/prompt';
import {
  BASE_PATH,
  captureLog,
  errorResponse,
  jsonResponse,
  lastRequest,
  mockExit,
} from './helpers';

vi.mock('../src/interactive');
vi.mock('../src/prompt');

const fetchMock = vi.fn();

describe('login and logout', () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('XDG_CONFIG_HOME', await mkdtemp(join(tmpdir(), 'vivid-cli-')));
    vi.stubEnv('VIVID_API_KEY', '');
    vi.mocked(isInteractive).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it('validates the key with ping before storing it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    const success = vi.spyOn(consola, 'success').mockImplementation(() => {});

    await login.action(
      { apiKey: ' vivid_sk_v1_test ', json: false },
      undefined,
    );

    const { url, init, body } = lastRequest(fetchMock);
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/ping`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'vivid_sk_v1_test',
    );
    expect(body).toEqual({});
    expect(await readConfig()).toEqual({ apiKey: 'vivid_sk_v1_test' });
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
    expect(success).toHaveBeenCalledWith(
      `Logged in. API key stored in ${configPath()}.`,
    );
  });

  it('prints JSON on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    const output = captureLog();

    await login.action({ apiKey: 'vivid_sk_v1_test', json: true }, undefined);

    expect(JSON.parse(output())).toEqual({
      loggedIn: true,
      configPath: configPath(),
    });
  });

  it('does not store a key the API rejects', async () => {
    fetchMock.mockResolvedValue(errorResponse(401, 'invalid_key'));

    await expect(
      login.action({ apiKey: 'vivid_sk_v1_bad', json: false }, undefined),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_key' });
    expect(await readConfig()).toEqual({});
  });

  it('requires --api-key in a non-interactive environment', async () => {
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(login.action({ json: false }, undefined)).rejects.toThrow(
      'process.exit(1)',
    );
    expect(error).toHaveBeenCalledWith(
      'You must provide an API key via --api-key when running in a non-interactive environment.',
    );
    expect(promptText).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prompts for the key when interactive', async () => {
    vi.mocked(isInteractive).mockReturnValue(true);
    vi.mocked(promptSecret).mockResolvedValue(' vivid_sk_v1_prompted ');
    vi.spyOn(consola, 'info').mockImplementation(() => {});
    vi.spyOn(consola, 'success').mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));

    await login.action({ json: false }, undefined);

    expect(await readConfig()).toEqual({ apiKey: 'vivid_sk_v1_prompted' });
    // The key is read without echo, never through the plain text prompt.
    expect(promptSecret).toHaveBeenCalledWith('Enter your Vivid API key:');
    expect(promptText).not.toHaveBeenCalled();
  });

  it('removes the stored key and keeps other settings', async () => {
    await writeConfig({ apiKey: 'vivid_sk_v1_test' });
    const success = vi.spyOn(consola, 'success').mockImplementation(() => {});

    await logout.action({ json: false }, undefined);

    expect(await readConfig()).toEqual({});
    expect(success).toHaveBeenCalledWith('Logged out.');
  });

  it('warns when VIVID_API_KEY is still set', async () => {
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_env');
    vi.spyOn(consola, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(consola, 'warn').mockImplementation(() => {});

    await logout.action({ json: false }, undefined);

    expect(warn).toHaveBeenCalledWith(
      'The VIVID_API_KEY environment variable is still set and will be used for authentication.',
    );
  });

  it('reports logout as JSON', async () => {
    const output = captureLog();

    await logout.action({ json: true }, undefined);

    expect(JSON.parse(output())).toEqual({
      loggedOut: false,
      environmentKeySet: false,
    });
  });
});
