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

/** Every command, keyed `group:action`. */
export const commands = {
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
};
