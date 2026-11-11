import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliConfig {
  apiKey?: string;
}

function configDir(): string {
  const xdgConfigHome = process.env['XDG_CONFIG_HOME'];
  const base = xdgConfigHome ? xdgConfigHome : join(homedir(), '.config');
  return join(base, 'vivid');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function readConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as CliConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

export type KeySource = 'environment' | 'config' | 'none';

export async function resolveApiKey(): Promise<{
  apiKey?: string;
  source: KeySource;
}> {
  const environmentKey = process.env['VIVID_API_KEY']?.trim();
  if (environmentKey) {
    return { apiKey: environmentKey, source: 'environment' };
  }
  const configKey = (await readConfig()).apiKey?.trim();
  if (configKey) {
    return { apiKey: configKey, source: 'config' };
  }
  return { source: 'none' };
}
