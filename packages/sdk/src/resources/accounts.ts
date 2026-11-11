import type { Amount, OpenEnum } from '../types';
import { BaseResource } from './base';

/** What an account holds, as decimal strings in the account's currency. */
export interface Balance {
  /** What can be spent right now. */
  available: Amount;
  /**
   * Incoming money not yet credited, never negative and not part of
   * `available`. Card holds are not here. `null` when no pending amount is
   * known, which is not `"0.00"`.
   */
  pending: Amount | null;
}

/** One set of details money can be sent to. A field the bank did not supply is `null`. */
export interface AccountDetails {
  iban: string | null;
  bic: string | null;
  holder_name: string | null;
  bank_name: string | null;
  type: OpenEnum<'local' | 'international'>;
}

/** One payment account. */
export interface Account {
  /** UUID; the same value appears as `account_id` on transactions and cards. */
  id: string;
  /** The name given in the app, `""` when unnamed. */
  name: string;
  /** ISO 4217. */
  currency: string;
  state: OpenEnum<'active' | 'blocked' | 'closed'>;
  /**
   * `null` when the member who issued the key may not see balances in the
   * app; the account itself is still returned.
   */
  balance: Balance | null;
  /** Empty when the account has none; may hold a local and an international set. */
  account_details: AccountDetails[];
  /** RFC 3339 UTC; `null` when the source has no opening date. */
  created_at: string | null;
}

export interface ListAccountsOptions {
  /** Include visible closed accounts. Only open accounts are returned by default. */
  includeClosed?: boolean;
}

export class AccountsResource extends BaseResource {
  /**
   * Retrieves all payment accounts visible to the key's issuer via
   * `POST /api/v1/accounts/current/list`. Not paged.
   */
  public async list(options: ListAccountsOptions = {}): Promise<Account[]> {
    const response = await this.http.request<{ accounts: Account[] }>({
      path: '/api/v1/accounts/current/list',
      body: { include_closed: options.includeClosed },
    });
    return response.accounts;
  }

  /** Retrieves a single payment account via `POST /api/v1/accounts/current/get`. */
  public async get(options: { accountId: string }): Promise<Account> {
    const response = await this.http.request<{ account: Account }>({
      path: '/api/v1/accounts/current/get',
      body: { id: options.accountId },
    });
    return response.account;
  }
}
