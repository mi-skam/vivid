#!/usr/bin/env node
import { consola } from 'consola';
import { defineConfig, processConfig } from 'zodline';
import accountsGet from './commands/accounts/get';
import accountsList from './commands/accounts/list';
import cardsGet from './commands/cards/get';
import cardsList from './commands/cards/list';
import dbHistory from './commands/db/history';
import dbInfo from './commands/db/info';
import dbSync from './commands/db/sync';
import doctor from './commands/doctor';
import login from './commands/login';
import logout from './commands/logout';
import ping from './commands/ping';
import transactionsGet from './commands/transactions/get';
import transactionsList from './commands/transactions/list';
import transactionsSummary from './commands/transactions/summary';
import transactionsWatch from './commands/transactions/watch';
import { formatError } from './errors';
import { pkg } from './package';

const config = defineConfig({
  meta: {
    name: 'vivid',
    version: pkg.version,
    description: pkg.description,
  },
  commands: {
    login,
    logout,
    ping,
    doctor,
    'accounts:get': accountsGet,
    'accounts:list': accountsList,
    'cards:get': cardsGet,
    'cards:list': cardsList,
    'transactions:get': transactionsGet,
    'transactions:list': transactionsList,
    'transactions:summary': transactionsSummary,
    'transactions:watch': transactionsWatch,
    'db:sync': dbSync,
    'db:info': dbInfo,
    'db:history': dbHistory,
  },
});

try {
  const result = processConfig(config, process.argv.slice(2));
  await result.command.action(result.options, result.args);
} catch (error) {
  consola.error(formatError(error));
  process.exitCode = 1;
}
