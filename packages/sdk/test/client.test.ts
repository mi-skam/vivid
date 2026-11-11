import { describe, expect, it } from 'vitest';
import { Vivid } from '../src/client';
import { AccountsResource } from '../src/resources/accounts';
import { CardsResource } from '../src/resources/cards';
import { TransactionsResource } from '../src/resources/transactions';
import { BASE_URL, createMockFetch, lastRequest } from './helpers';

describe('Vivid', () => {
  it('exposes every resource', () => {
    const vivid = new Vivid({ apiKey: 'k', fetch: createMockFetch({}) });

    expect(vivid.accounts).toBeInstanceOf(AccountsResource);
    expect(vivid.cards).toBeInstanceOf(CardsResource);
    expect(vivid.transactions).toBeInstanceOf(TransactionsResource);
  });

  it('pings with an empty JSON body', async () => {
    const fetch = createMockFetch({ status: 'ok' });
    const vivid = new Vivid({ apiKey: 'vivid_sk_v1_test', fetch });

    const result = await vivid.ping();

    const { url, init, body } = lastRequest(fetch);
    expect(url).toBe(`${BASE_URL}/api/v1/ping`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'vivid_sk_v1_test',
    );
    expect(body).toEqual({});
    expect(result).toEqual({ status: 'ok' });
  });
});
