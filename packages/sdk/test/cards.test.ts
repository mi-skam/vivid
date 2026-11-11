import { describe, expect, it } from 'vitest';
import { CardsResource } from '../src/resources/cards';
import { card } from './fixtures';
import {
  BASE_URL,
  createHttpClient,
  createMockFetch,
  lastRequest,
} from './helpers';

describe('CardsResource', () => {
  describe('list', () => {
    it('posts an empty body by default and returns the page', async () => {
      const fetch = createMockFetch({ cards: [card], next_cursor: null });
      const resource = new CardsResource(createHttpClient(fetch));

      const result = await resource.list();

      const { url, init, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/cards/list`);
      expect(init.method).toBe('POST');
      expect(body).toEqual({});
      expect(result).toEqual({ cards: [card], next_cursor: null });
    });

    it('sends limit and cursor', async () => {
      const fetch = createMockFetch({ cards: [], next_cursor: null });
      const resource = new CardsResource(createHttpClient(fetch));

      await resource.list({ limit: 1, cursor: 'abc' });

      expect(lastRequest(fetch).body).toEqual({ limit: 1, cursor: 'abc' });
    });
  });

  describe('get', () => {
    it('sends the id and unwraps the card', async () => {
      const fetch = createMockFetch({ card });
      const resource = new CardsResource(createHttpClient(fetch));

      const result = await resource.get({ cardId: card.id });

      const { url, body } = lastRequest(fetch);
      expect(url).toBe(`${BASE_URL}/api/v1/cards/get`);
      expect(body).toEqual({ id: card.id });
      expect(result).toEqual(card);
    });
  });
});
