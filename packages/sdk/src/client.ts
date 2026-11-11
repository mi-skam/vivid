import type { VividOptions } from './http-client';
import { HttpClient } from './http-client';
import { AccountsResource } from './resources/accounts';
import { CardsResource } from './resources/cards';
import { TransactionsResource } from './resources/transactions';

export interface PingResponse {
  /** `"ok"` on success; a failure is a `VividError`, never a status to parse. */
  status: string;
}

export class Vivid {
  public readonly accounts: AccountsResource;
  public readonly cards: CardsResource;
  public readonly transactions: TransactionsResource;
  private readonly http: HttpClient;

  constructor(options: VividOptions) {
    this.http = new HttpClient(options);
    this.accounts = new AccountsResource(this.http);
    this.cards = new CardsResource(this.http);
    this.transactions = new TransactionsResource(this.http);
  }

  /** Checks that the API is reachable and the key is accepted via `POST /api/v1/ping`. */
  public async ping(): Promise<PingResponse> {
    return this.http.request<PingResponse>({ path: '/api/v1/ping' });
  }
}
