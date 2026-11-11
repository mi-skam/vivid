import { describe, expect, it } from 'vitest';
import { TransactionsResource } from '../src/resources/transactions';
import { account, transaction } from './fixtures';
import {
  BASE_URL,
  createHttpClient,
  createMockFetch,
  lastRequest,
} from './helpers';

describe('TransactionsResource', () => {
  describe('list', () => {
    it('maps every filter to its snake_case body field', async () => {
      const fetch = createMockFetch({
        transactions: [transaction],
        next_cursor: 'cursor-2',
      });
      const resource = new TransactionsResource(createHttpClient(fetch));

      const result = await resource.list({
        accountIds: [account.id],
        updatedFrom: new Date('2025-03-01T00:00:00.000Z'),
        updatedTo: '2025-03-31T00:00:00Z',
        types: ['card_payment', 'fee'],
        state: 'completed',
        limit: 100,
        cursor: 'cursor-1',
      });

      const { url, init, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/transactions/list`);
      expect(init.method).toBe('POST');
      expect(body).toEqual({
        account_ids: [account.id],
        updated_from: '2025-03-01T00:00:00.000Z',
        updated_to: '2025-03-31T00:00:00Z',
        types: ['card_payment', 'fee'],
        state: 'completed',
        limit: 100,
        cursor: 'cursor-1',
      });
      expect(result).toEqual({
        transactions: [transaction],
        next_cursor: 'cursor-2',
      });
    });

    it('sends only the filters that are set', async () => {
      const fetch = createMockFetch({ transactions: [], next_cursor: null });
      const resource = new TransactionsResource(createHttpClient(fetch));

      await resource.list({ accountTypes: ['current'] });

      expect(lastRequest(fetch).body).toEqual({ account_types: ['current'] });
    });
  });

  describe('get', () => {
    it('sends the id and unwraps the transaction', async () => {
      const fetch = createMockFetch({ transaction });
      const resource = new TransactionsResource(createHttpClient(fetch));

      const result = await resource.get({ transactionId: transaction.id });

      const { url, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/transactions/get`);
      expect(body).toEqual({ id: transaction.id });
      expect(result).toEqual(transaction);
    });

    it('surfaces outside_history_window as a 404 VividError', async () => {
      const fetch = createMockFetch(
        {
          trace_id: 'trace-9',
          errors: [{ code: 'outside_history_window', message: 'too old' }],
        },
        { status: 404, statusText: 'Not Found' },
      );
      const resource = new TransactionsResource(createHttpClient(fetch));

      await expect(
        resource.get({ transactionId: transaction.id }),
      ).rejects.toMatchObject({
        name: 'VividError',
        status: 404,
        code: 'outside_history_window',
        traceId: 'trace-9',
      });
    });
  });
});
