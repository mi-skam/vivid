import { toRfc3339 } from '../dates';
import type {
  Amount,
  CursorListOptions,
  CursorPage,
  DateInput,
  OpenEnum,
} from '../types';
import { BaseResource } from './base';

export type AccountType = OpenEnum<'current' | 'other'>;

export type TransactionType = OpenEnum<
  | 'card_payment'
  | 'card_refund'
  | 'atm'
  | 'transfer'
  | 'exchange'
  | 'fee'
  | 'other'
>;

export type TransactionState = OpenEnum<'pending' | 'completed' | 'declined'>;

/** The other side of a card operation as the card network reported it. */
export interface Merchant {
  /** Often abbreviated. */
  name: string | null;
  /** Merchant category code, four digits. */
  category_code: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
}

/** The card an operation was made with. Each field is `null` when not known. */
export interface TransactionCard {
  id: string | null;
  last_4: string | null;
}

/**
 * One record on one account. A hold and its settlement are the same record:
 * its `state`, `amount` and `updated_at` change, its `id` does not.
 */
export interface Transaction {
  id: string;
  /** Links the records of one event, e.g. both sides of an exchange. Opaque. */
  group_id: string;
  account_id: string;
  account_type: AccountType;
  /** A refund or a fee is a record of its own, never part of the payment's amount. */
  type: TransactionType;
  /** `pending` is authorised but not settled; its amount may still change. */
  state: TransactionState;
  /** In the account's currency, negative for a debit. */
  amount: Amount;
  /** ISO 4217, the account's own currency. */
  currency: string;
  /** In the operation's currency when that differs from the account's; `null` otherwise. */
  original_amount: Amount | null;
  original_currency: string | null;
  /**
   * Best estimate of when the transaction happened, RFC 3339 UTC. The 90-day
   * history window counts from it. `null` when not known.
   */
  show_at: string | null;
  /** When Vivid first recorded the transaction; not the payment moment. */
  created_at: string;
  updated_at: string;
  /** Present for card operations; `null` when no merchant is known. */
  merchant: Merchant | null;
  /** Present only for card operations; `null` when the card is not known. */
  card: TransactionCard | null;
  network_transaction_id: string | null;
}

export interface ListTransactionsOptions extends CursorListOptions {
  /**
   * Accounts whose records to return. Exactly one of `accountIds` and
   * `accountTypes` is required; both or neither is `400 invalid_request`.
   */
  accountIds?: string[];
  /** Account types whose records to return; `['current']` means every payment account. */
  accountTypes?: AccountType[];
  /** Records last changed at or after this moment. */
  updatedFrom?: DateInput;
  /** Records last changed before this moment. */
  updatedTo?: DateInput;
  types?: TransactionType[];
  /** A single state; omitted returns every state. */
  state?: TransactionState;
}

export interface ListTransactionsResponse extends CursorPage {
  /** Newest first. */
  transactions: Transaction[];
}

export class TransactionsResource extends BaseResource {
  /**
   * Retrieves one page of transactions of the last 90 days via
   * `POST /api/v1/transactions/list`.
   */
  public async list(
    options: ListTransactionsOptions,
  ): Promise<ListTransactionsResponse> {
    return this.http.request<ListTransactionsResponse>({
      path: '/api/v1/transactions/list',
      body: {
        account_ids: options.accountIds,
        account_types: options.accountTypes,
        updated_from: toRfc3339(options.updatedFrom),
        updated_to: toRfc3339(options.updatedTo),
        types: options.types,
        state: options.state,
        limit: options.limit,
        cursor: options.cursor,
      },
    });
  }

  /**
   * Retrieves a single transaction via `POST /api/v1/transactions/get`. Older
   * than 90 days answers `404 outside_history_window`.
   */
  public async get(options: { transactionId: string }): Promise<Transaction> {
    const response = await this.http.request<{ transaction: Transaction }>({
      path: '/api/v1/transactions/get',
      body: { id: options.transactionId },
    });
    return response.transaction;
  }
}
