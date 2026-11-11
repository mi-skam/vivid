/**
 * A fixed list of values the API may extend without a new version. Known
 * values are typed for autocompletion; any other string is accepted, so an
 * unknown value never breaks a caller. Treat it as `other` and keep the record.
 */
export type OpenEnum<T extends string> = T | (string & {});

/**
 * Accepted moment representations for request options. `Date` objects are
 * serialized as RFC 3339 in UTC; strings are passed through unchanged.
 */
export type DateInput = Date | string;

/**
 * A decimal amount with two decimals as a string, negative for money out,
 * e.g. `"-12.50"`. Kept as a string so no precision is lost.
 */
export type Amount = string;

/** Options shared by every paged list route. */
export interface CursorListOptions {
  /** Page size: 50 when absent, 500 at most — a larger value is served as 500. */
  limit?: number;
  /** `next_cursor` of the previous page, sent back verbatim. */
  cursor?: string;
}

/**
 * Fields every paged response carries. Keep paging until `next_cursor` is
 * `null`: a short or even empty page does not mean the end.
 */
export interface CursorPage {
  next_cursor: string | null;
}
