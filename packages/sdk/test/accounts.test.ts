import { describe, expect, it } from 'vitest';
import { AccountsResource } from '../src/resources/accounts';
import { account } from './fixtures';
import {
  BASE_URL,
  createHttpClient,
  createMockFetch,
  lastRequest,
} from './helpers';

describe('AccountsResource', () => {
  describe('list', () => {
    it('posts an empty body and unwraps the accounts', async () => {
      const fetch = createMockFetch({ accounts: [account] });
      const resource = new AccountsResource(createHttpClient(fetch));

      const result = await resource.list();

      const { url, init, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/accounts/current/list`);
      expect(init.method).toBe('POST');
      expect(body).toEqual({});
      expect(result).toEqual([account]);
    });

    it('sends include_closed', async () => {
      const fetch = createMockFetch({ accounts: [] });
      const resource = new AccountsResource(createHttpClient(fetch));

      await resource.list({ includeClosed: true });

      expect(lastRequest(fetch).body).toEqual({ include_closed: true });
    });
  });

  describe('get', () => {
    it('sends the id and unwraps the account', async () => {
      const fetch = createMockFetch({ account });
      const resource = new AccountsResource(createHttpClient(fetch));

      const result = await resource.get({ accountId: account.id });

      const { url, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/accounts/current/get`);
      expect(body).toEqual({ id: account.id });
      expect(result).toEqual(account);
    });

    it('keeps unknown enum values and null balances', async () => {
      const odd = { ...account, state: 'archived', balance: null };
      const fetch = createMockFetch({ account: odd });
      const resource = new AccountsResource(createHttpClient(fetch));

      const result = await resource.get({ accountId: account.id });

      expect(result.state).toBe('archived');
      expect(result.balance).toBeNull();
    });
  });
});
