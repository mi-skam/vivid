#!/usr/bin/env node
import { consola } from 'consola';
import { defineConfig, processConfig } from 'zodline';
import { commands } from './commands';
import { formatError } from './errors';
import { pkg } from './package';

const config = defineConfig({
  meta: {
    name: 'vivid',
    version: pkg.version,
    description: pkg.description,
  },
  commands,
});

try {
  const result = processConfig(config, process.argv.slice(2));
  await result.command.action(result.options, result.args);
} catch (error) {
  consola.error(formatError(error));
  process.exitCode = 1;
}
