import { consola } from 'consola';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import get from '../src/commands/cards/get';
import list from '../src/commands/cards/list';
import { CARD_ID, card } from './fixtures';
import {
  BASE_PATH,
  captureLog,
  jsonResponse,
  lastRequest,
  mockExit,
  requests,
} from './helpers';

const fetchMock = vi.fn();

describe('card commands', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubEnv('VIVID_API_KEY', 'vivid_sk_v1_test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists cards as a table', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ cards: [card], next_cursor: null }),
    );
    const output = captureLog();

    await list.action({ json: false }, undefined);

    const { url, init, body } = lastRequest(fetchMock);
    expect(init.method).toBe('POST');
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/cards/list`);
    expect(body).toEqual({ limit: 500 });
    const text = output();
    expect(text).toMatch(/ID\s+NAME\s+LAST4\s+TYPE\s+STATE\s+ACCOUNT/);
    expect(text).toContain('ACME Travel');
    expect(text).toContain('4242');
  });

  it('follows next_cursor and respects --limit', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ cards: [card], next_cursor: 'c1' }))
      .mockResolvedValueOnce(
        jsonResponse({ cards: [card], next_cursor: 'c2' }),
      );
    const output = captureLog();

    await list.action({ limit: 2, json: true }, undefined);

    expect(lastRequest(fetchMock).body).toEqual({ limit: 2, cursor: 'c1' });
    expect(JSON.parse(output())).toHaveLength(2);
  });

  it('reports an empty list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cards: [], next_cursor: null }));
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await list.action({ json: false }, undefined);

    expect(info).toHaveBeenCalledWith('No cards found.');
  });

  it('shows a single card with its limits', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ card }));
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await get.action({ json: false }, [CARD_ID]);

    const { url, body } = lastRequest(fetchMock);
    expect(url.pathname).toBe(`${BASE_PATH}/api/v1/cards/get`);
    expect(body).toEqual({ id: CARD_ID });
    expect(info).toHaveBeenCalledWith('Name: ACME Travel');
    expect(info).toHaveBeenCalledWith(
      'Limit: spending monthly 1000.00 EUR, used 12.50',
    );
  });

  it('says when limits are not visible to the key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ card: { ...card, limits: [], limits_visible: false } }),
    );
    const info = vi.spyOn(consola, 'info').mockImplementation(() => {});

    await get.action({ json: false }, [CARD_ID]);

    expect(info).toHaveBeenCalledWith('Limits: not visible to the key');
  });

  it('prints a single card as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ card }));
    const output = captureLog();

    await get.action({ json: true }, [CARD_ID]);

    expect(JSON.parse(output())).toEqual(card);
  });

  it.each(['acme travel', '4242'])(
    'shows a card by name or last four digits (%s)',
    async (target) => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ cards: [card], next_cursor: null }),
        )
        .mockResolvedValueOnce(jsonResponse({ card }));
      vi.spyOn(consola, 'info').mockImplementation(() => {});

      await get.action({ json: false }, [target]);

      const [lookup, fetched] = requests(fetchMock);
      expect(lookup?.url.pathname).toBe(`${BASE_PATH}/api/v1/cards/list`);
      expect(fetched?.url.pathname).toBe(`${BASE_PATH}/api/v1/cards/get`);
      expect(fetched?.body).toEqual({ id: CARD_ID });
    },
  );

  it('exits when no card matches', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ cards: [card], next_cursor: null }),
    );
    const error = vi.spyOn(consola, 'error').mockImplementation(() => {});
    mockExit();

    await expect(get.action({ json: false }, ['9999'])).rejects.toThrow(
      'process.exit(1)',
    );
    expect(error).toHaveBeenCalledWith(
      'No card named "9999". Available: ACME Travel (…4242).',
    );
  });
});
