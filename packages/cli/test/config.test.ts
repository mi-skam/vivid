import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configPath,
  readConfig,
  resolveApiKey,
  writeConfig,
} from '../src/config';

describe('config', () => {
  beforeEach(async () => {
    vi.stubEnv('XDG_CONFIG_HOME', await mkdtemp(join(tmpdir(), 'vivid-cli-')));
    vi.stubEnv('VIVID_API_KEY', '');
    delete process.env['VIVID_API_KEY'];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('places the config file in XDG_CONFIG_HOME', () => {
    expect(configPath()).toBe(
      join(process.env['XDG_CONFIG_HOME'] as string, 'vivid', 'config.json'),
    );
  });

  it('returns an empty config when no file exists', async () => {
    expect(await readConfig()).toEqual({});
  });

  it('round-trips the config file with mode 0600', async () => {
    await writeConfig({ apiKey: 'abc' });
    expect(await readConfig()).toEqual({ apiKey: 'abc' });
    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('resolves the key from the environment first', async () => {
    await writeConfig({ apiKey: 'from-config' });
    vi.stubEnv('VIVID_API_KEY', 'from-env');
    expect(await resolveApiKey()).toEqual({
      apiKey: 'from-env',
      source: 'environment',
    });
  });

  it('falls back to the config file key', async () => {
    await writeConfig({ apiKey: 'from-config' });
    expect(await resolveApiKey()).toEqual({
      apiKey: 'from-config',
      source: 'config',
    });
  });

  it('reports a missing key', async () => {
    expect(await resolveApiKey()).toEqual({ source: 'none' });
  });
});
