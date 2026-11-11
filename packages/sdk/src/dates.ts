import type { DateInput } from './types';

/** Serializes a moment as RFC 3339 in UTC, passing strings through unchanged. */
export function toRfc3339(value: DateInput | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}
