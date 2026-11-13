import { afterEach, describe, expect, it, vi } from 'vitest';
import { categoryOf } from '../src/categories';
import { outputFormat, printCsv } from '../src/format';
import { formatCents, toCents } from '../src/money';
import {
  historyWindowStart,
  inPeriod,
  momentLabel,
  parsePeriod,
} from '../src/period';
import { internalGroupIds } from '../src/query';
import { summarize } from '../src/summary';
import { ACCOUNT_ID, CARD_ID, transaction, tx } from './fixtures';
import { captureLog } from './helpers';

const NOW = new Date('2026-11-12T15:30:00Z');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('money', () => {
  it('parses API amounts into cents and back without rounding', () => {
    expect(toCents('-12.50')).toBe(-1250n);
    expect(toCents('0.1')).toBe(10n);
    expect(toCents('7')).toBe(700n);
    expect(formatCents(-1250n)).toBe('-12.50');
    expect(formatCents(5n)).toBe('0.05');
    expect(formatCents(-5n)).toBe('-0.05');
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    expect(formatCents(toCents('0.10') + toCents('0.20'))).toBe('0.30');
  });

  it('rejects an amount it does not understand', () => {
    expect(() => toCents('12,50')).toThrow('Unexpected amount format');
  });
});

describe('period', () => {
  it('parses relative ages, dates and timestamps', () => {
    expect(parsePeriod({ since: '7d' }, NOW).from?.toISOString()).toBe(
      '2026-11-05T15:30:00.000Z',
    );
    expect(parsePeriod({ since: '2w' }, NOW).from?.toISOString()).toBe(
      '2026-10-29T15:30:00.000Z',
    );
    const days = parsePeriod({ since: '2026-10-01', until: '2026-10-31' }, NOW);
    expect(days.from?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    // A plain --until date includes the whole day.
    expect(days.to?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(
      parsePeriod({ until: '2026-10-31T12:00:00Z' }, NOW).to?.toISOString(),
    ).toBe('2026-10-31T12:00:00.000Z');
  });

  it('turns a month into its first moment up to the next month', () => {
    const period = parsePeriod({ month: '2026-12' }, NOW);
    expect(period.from?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(period.to?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects invalid or contradictory input', () => {
    expect(() => parsePeriod({ since: 'yesterday' }, NOW)).toThrow(
      'Invalid date "yesterday"',
    );
    expect(() => parsePeriod({ month: '2026-13' }, NOW)).toThrow(
      'Invalid month',
    );
    expect(() => parsePeriod({ month: '2026-10', since: '7d' }, NOW)).toThrow(
      'either --month or --since/--until',
    );
    expect(() =>
      parsePeriod({ since: '2026-10-02', until: '2026-10-01' }, NOW),
    ).toThrow('--since must be before --until');
  });

  it('starts the history window at midnight UTC 90 days ago', () => {
    expect(historyWindowStart(NOW).toISOString()).toBe(
      '2026-08-14T00:00:00.000Z',
    );
    expect(momentLabel(historyWindowStart(NOW))).toBe('2026-08-14');
  });

  it('filters by when the payment happened, not when it changed', () => {
    const period = parsePeriod({ month: '2025-03' });
    // Fixture: show_at 1 March, updated_at 2 March.
    expect(inPeriod(tx(), period)).toBe(true);
    expect(inPeriod(tx({ show_at: '2025-02-28T23:59:59Z' }), period)).toBe(
      false,
    );
    // Without show_at, the moment Vivid recorded it counts.
    expect(
      inPeriod(
        tx({ show_at: null, created_at: '2025-04-01T00:00:00Z' }),
        period,
      ),
    ).toBe(false);
  });
});

describe('output format and CSV', () => {
  it('lets --json win and rejects it together with another --format', () => {
    expect(outputFormat({})).toBe('table');
    expect(outputFormat({ json: true })).toBe('json');
    expect(outputFormat({ format: 'csv' })).toBe('csv');
    expect(() => outputFormat({ json: true, format: 'csv' })).toThrow(
      'either --json or --format',
    );
  });

  it('writes standard CSV with quoting and formula protection', () => {
    const output = captureLog();
    printCsv(
      [
        { name: 'ACME, Inc.', note: 'say "hi"', amount: '-12.50' },
        { name: '=HYPERLINK("x")', note: '', amount: '3.00' },
      ],
      { columns: ['name', 'note', 'amount'], amountColumns: ['amount'] },
    );
    expect(output()).toBe(
      [
        'name,note,amount',
        '"ACME, Inc.","say ""hi""",-12.50',
        `"'=HYPERLINK(""x"")",,3.00`,
      ].join('\n'),
    );
  });

  it('writes the German dialect with semicolons, decimal commas and a BOM', () => {
    const output = captureLog();
    printCsv([{ name: 'Müller; Söhne', amount: '-1234.56' }], {
      columns: ['name', 'amount'],
      locale: 'de',
      amountColumns: ['amount'],
    });
    expect(output()).toBe('﻿name;amount\n"Müller; Söhne";-1234,56');
  });
});

describe('categories', () => {
  it('maps merchant category codes to coarse groups', () => {
    expect(categoryOf('5734')).toBe('Software & IT');
    expect(categoryOf('5812')).toBe('Food & drink');
    expect(categoryOf('3012')).toBe('Travel');
    expect(categoryOf('0742')).toBe('MCC 0742');
    expect(categoryOf(null)).toBeNull();
  });
});

describe('summarize', () => {
  const context = {
    accountNames: new Map([[ACCOUNT_ID, 'ACME GmbH']]),
    cardNames: new Map([[CARD_ID, 'ACME Travel']]),
    internalGroups: new Set(['group-internal']),
  };
  const records = [
    tx({ id: 'a', amount: '-100.00' }),
    tx({ id: 'b', amount: '-0.10' }),
    tx({ id: 'c', amount: '20.00', type: 'card_refund' }),
    tx({
      id: 'd',
      amount: '-50.00',
      merchant: { ...transaction.merchant, name: 'ACME TRAINS' },
    }),
    tx({
      id: 'e',
      amount: '-500.00',
      type: 'transfer',
      group_id: 'group-internal',
      merchant: null,
      card: null,
    }),
    tx({ id: 'f', amount: '-9.99', currency: 'USD' }),
  ];

  it('nets refunds per merchant, keeps transfers apart and never mixes currencies', () => {
    const rows = summarize(records, 'merchant', context, { withTotals: true });
    expect(rows).toEqual([
      {
        currency: 'EUR',
        group: 'ACME CLOUD',
        count: 3,
        out: '-100.10',
        refunds: '20.00',
        in: '0.00',
        transfers: '0.00',
        net: '-80.10',
      },
      expect.objectContaining({ group: 'ACME TRAINS', out: '-50.00' }),
      expect.objectContaining({
        group: '(no merchant)',
        out: '0.00',
        transfers: '-500.00',
        net: '-500.00',
      }),
      expect.objectContaining({
        currency: 'EUR',
        group: 'TOTAL',
        count: 5,
        out: '-150.10',
        refunds: '20.00',
        transfers: '-500.00',
        net: '-630.10',
      }),
      expect.objectContaining({
        currency: 'USD',
        group: 'ACME CLOUD',
        out: '-9.99',
      }),
      expect.objectContaining({ currency: 'USD', group: 'TOTAL', count: 1 }),
    ]);
  });

  it('groups by card, account, category and month', () => {
    const eur = records.filter((r) => r.currency === 'EUR');
    expect(summarize(eur, 'card', context).map((r) => r.group)).toEqual([
      'ACME Travel (…4242)',
      '(no card)',
    ]);
    expect(summarize(eur, 'account', context).map((r) => r.group)).toEqual([
      'ACME GmbH',
    ]);
    expect(summarize(eur, 'category', context).map((r) => r.group)).toEqual([
      'Software & IT',
      '(transfer)',
    ]);
    const months = summarize(
      [tx({ id: 'x' }), tx({ id: 'y', show_at: '2025-05-02T00:00:00Z' })],
      'month',
      context,
    );
    expect(months.map((r) => r.group)).toEqual(['2025-05', '2025-03']);
  });

  it('counts transfers with other banks as money in and out', () => {
    const transfer = (id: string, amount: string, group_id: string) =>
      tx({
        id,
        amount,
        group_id,
        type: 'transfer',
        merchant: null,
        card: null,
      });
    const rows = summarize(
      [
        transfer('in', '1500.00', 'group-customer'),
        transfer('out', '-100.00', 'group-supplier'),
        transfer('moved', '-490.00', 'group-internal'),
        tx({ id: 'fx', amount: '-50.00', type: 'exchange', merchant: null }),
      ],
      'type',
      context,
    );
    expect(rows).toEqual([
      {
        currency: 'EUR',
        group: 'transfer',
        count: 3,
        out: '-100.00',
        refunds: '0.00',
        in: '1500.00',
        transfers: '-490.00',
        net: '910.00',
      },
      expect.objectContaining({
        group: 'exchange',
        out: '0.00',
        in: '0.00',
        transfers: '-50.00',
      }),
    ]);
  });
});

describe('internalGroupIds', () => {
  const OTHER_ACCOUNT = '00000000-0000-4000-8000-000000000002';

  it('finds the transfers booked on two accounts', () => {
    const groups = internalGroupIds([
      tx({ id: 'a', type: 'transfer', group_id: 'moved', amount: '-490.00' }),
      tx({
        id: 'b',
        type: 'transfer',
        group_id: 'moved',
        amount: '490.00',
        account_id: OTHER_ACCOUNT,
      }),
      tx({ id: 'c', type: 'transfer', group_id: 'received' }),
      // Two records of one event on the same account are not a movement.
      tx({ id: 'd', type: 'transfer', group_id: 'twice' }),
      tx({ id: 'e', type: 'transfer', group_id: 'twice' }),
      // Only transfers count, whatever their group.
      tx({ id: 'f', group_id: 'payment' }),
      tx({ id: 'g', group_id: 'payment', account_id: OTHER_ACCOUNT }),
    ]);
    expect([...groups]).toEqual(['moved']);
  });
});
