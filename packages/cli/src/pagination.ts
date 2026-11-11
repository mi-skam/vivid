/** The largest page the Vivid API serves; a larger `limit` is served as 500. */
const PAGE_SIZE = 500;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface FetchAllOptions {
  /** Maximum number of rows to return in total. */
  limit?: number;
}

/**
 * Collects rows of a cursor-paged list route across as many pages as needed.
 *
 * Paging stops only when `next_cursor` is `null` (or `limit` is met): the API
 * may return a short or even empty page before the end, so a page's length
 * says nothing about whether more follow. The page size is fixed for the whole
 * run because a cursor is only valid with the request that produced it.
 */
export async function fetchAll<T>(
  fetchPage: (page: { limit: number; cursor?: string }) => Promise<Page<T>>,
  options: FetchAllOptions = {},
): Promise<T[]> {
  const { limit } = options;
  const pageSize = limit === undefined ? PAGE_SIZE : Math.min(limit, PAGE_SIZE);
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  while (limit === undefined || items.length < limit) {
    const page = await fetchPage(
      cursor === undefined ? { limit: pageSize } : { limit: pageSize, cursor },
    );
    items.push(...page.items);
    if (page.nextCursor === null) {
      break;
    }
    if (seen.has(page.nextCursor)) {
      throw new Error(
        'The Vivid API returned a cursor it had already returned; stopping to avoid an endless loop.',
      );
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return limit === undefined ? items : items.slice(0, limit);
}
