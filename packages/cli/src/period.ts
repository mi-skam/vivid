import type { Transaction } from '@mi-skam/vivid-sdk';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** A half-open range of payment moments: `from` inclusive, `to` exclusive. */
export interface Period {
  from?: Date;
  to?: Date;
}

export interface PeriodOptions {
  since?: string;
  until?: string;
  month?: string;
}

const MOMENT_HINT =
  'Use a relative age (7d, 2w), a date (YYYY-MM-DD) or an RFC 3339 timestamp.';

/**
 * Parses `7d`, `2w`, `YYYY-MM-DD` or an RFC 3339 timestamp. A plain date is a
 * whole UTC day: as a start it means its first moment, as an end it includes
 * the day, so `--until 2026-10-31` covers 31 October.
 */
function parseMoment(value: string, edge: 'start' | 'end', now: Date): Date {
  const trimmed = value.trim();
  const relative = /^(\d+)([dw])$/.exec(trimmed);
  if (relative) {
    const size = Number(relative[1]) * (relative[2] === 'w' ? WEEK : DAY);
    return new Date(now.getTime() - size);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const start = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(start)) {
      throw new Error(`Invalid date "${value}". ${MOMENT_HINT}`);
    }
    return new Date(edge === 'end' ? start + DAY : start);
  }
  const parsed = Date.parse(trimmed);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid date "${value}". ${MOMENT_HINT}`);
  }
  return new Date(parsed);
}

/** Turns `--since`, `--until` and `--month` into a period of payment moments. */
export function parsePeriod(
  options: PeriodOptions,
  now: Date = new Date(),
): Period {
  if (options.month !== undefined) {
    if (options.since !== undefined || options.until !== undefined) {
      throw new Error('Pass either --month or --since/--until, not both.');
    }
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(options.month.trim());
    if (!match) {
      throw new Error(`Invalid month "${options.month}". Use YYYY-MM.`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    return {
      from: new Date(Date.UTC(year, month - 1, 1)),
      to: new Date(Date.UTC(year, month, 1)),
    };
  }
  const period: Period = {};
  if (options.since !== undefined) {
    period.from = parseMoment(options.since, 'start', now);
  }
  if (options.until !== undefined) {
    period.to = parseMoment(options.until, 'end', now);
  }
  if (period.from && period.to && period.from >= period.to) {
    throw new Error('--since must be before --until.');
  }
  return period;
}

export function hasPeriod(period: Period): boolean {
  return period.from !== undefined || period.to !== undefined;
}

/**
 * The oldest moment the API still serves: 00:00 UTC 90 days ago, counted from
 * `show_at`.
 */
export function historyWindowStart(now: Date = new Date()): Date {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return new Date(today - 90 * DAY);
}

/**
 * When the payment happened: `show_at`, or when Vivid recorded it if the
 * moment is not known. The API can only filter by `updated_at`, so periods are
 * applied to this value by the CLI.
 */
export function occurredAt(transaction: Transaction): string {
  return transaction.show_at ?? transaction.created_at;
}

export function inPeriod(transaction: Transaction, period: Period): boolean {
  const at = Date.parse(occurredAt(transaction));
  return (
    (period.from === undefined || at >= period.from.getTime()) &&
    (period.to === undefined || at < period.to.getTime())
  );
}

/** `2026-10-01` for a midnight, otherwise the full timestamp. */
export function momentLabel(moment: Date): string {
  const iso = moment.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}
