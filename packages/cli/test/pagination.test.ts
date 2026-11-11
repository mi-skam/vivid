import { describe, expect, it, vi } from 'vitest';
import { fetchAll } from '../src/pagination';

/** Serves the given pages in order; each page's cursor is its index. */
function servePages(pages: number[][]) {
  return vi.fn(async ({ cursor }: { limit: number; cursor?: string }) => {
    const index = cursor === undefined ? 0 : Number(cursor);
    return {
      items: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    };
  });
}

describe('fetchAll', () => {
  it('follows next_cursor until it is null', async () => {
    const fetchPage = servePages([[1, 2], [3], [4, 5]]);

    const items = await fetchAll(fetchPage);

    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([
      { limit: 500 },
      { limit: 500, cursor: '1' },
      { limit: 500, cursor: '2' },
    ]);
  });

  it('does not stop on a short or empty page', async () => {
    const fetchPage = servePages([[1], [], [], [2]]);

    const items = await fetchAll(fetchPage);

    expect(items).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('stops once the limit is met and keeps the page size fixed', async () => {
    const fetchPage = servePages([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);

    const items = await fetchAll(fetchPage, { limit: 3 });

    expect(items).toEqual([1, 2, 3]);
    expect(fetchPage.mock.calls.map(([page]) => page.limit)).toEqual([3, 3]);
  });

  it('caps the page size at 500', async () => {
    const fetchPage = servePages([[1]]);

    await fetchAll(fetchPage, { limit: 2000 });

    expect(fetchPage.mock.calls[0]?.[0]).toEqual({ limit: 500 });
  });

  it('refuses to loop on a repeated cursor', async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], nextCursor: 'same' }));

    await expect(fetchAll(fetchPage)).rejects.toThrow(/endless loop/);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
