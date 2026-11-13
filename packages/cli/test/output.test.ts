import type { Account, Transaction } from '@mi-skam/vivid-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountIban,
  amountLabel,
  displayWidth,
  originalAmountLabel,
  printTable,
  toTimestamp,
} from '../src/output';
import { account, transaction } from './fixtures';

describe('output helpers', () => {
  it('formats amounts with their currency', () => {
    expect(amountLabel('-12.50', 'EUR')).toBe('-12.50 EUR');
    expect(amountLabel(null, 'EUR')).toBe('');
  });

  it('prefers the local IBAN', () => {
    const twoSets = {
      ...account,
      account_details: [
        { ...account.account_details[0], iban: 'INTL', type: 'international' },
        ...account.account_details,
      ],
    } as Account;
    expect(accountIban(twoSets)).toBe('DE89370400440532013000');
    expect(accountIban({ ...account, account_details: [] } as Account)).toBe(
      '',
    );
  });

  it('shows the original amount only when it differs', () => {
    expect(originalAmountLabel(transaction as Transaction)).toBe('-13.00 USD');
    expect(
      originalAmountLabel({
        ...transaction,
        original_amount: null,
        original_currency: null,
      } as Transaction),
    ).toBe('');
  });

  it('expands plain dates to midnight UTC', () => {
    expect(toTimestamp('2025-03-01')).toBe('2025-03-01T00:00:00Z');
    expect(toTimestamp('2025-03-01T10:00:00+01:00')).toBe(
      '2025-03-01T10:00:00+01:00',
    );
    expect(toTimestamp(undefined)).toBeUndefined();
  });
});

describe('displayWidth', () => {
  it('counts terminal columns, not code units', () => {
    expect(displayWidth('ACME GmbH')).toBe(9);
    expect(displayWidth('Société')).toBe(7);
    expect(displayWidth('Socie\u0301te\u0301')).toBe(7);
    expect(displayWidth('株式会社')).toBe(8);
    expect(displayWidth('ＡＣＭＥ')).toBe(8);
    expect(displayWidth('한국')).toBe(4);
    expect(displayWidth('🚀')).toBe(2);
    expect(displayWidth('👍🏽')).toBe(2);
    expect(displayWidth('')).toBe(0);
  });
});

describe('printTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aligns columns after wide characters', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTable([
      { merchant: 'ACME', amount: '-12.50 EUR' },
      { merchant: '株式会社', amount: '-3.00 EUR' },
    ]);
    const lines = log.mock.calls.map(([line]) => String(line).trimEnd());
    expect(lines).toEqual([
      'MERCHANT  AMOUNT',
      'ACME      -12.50 EUR',
      '株式会社  -3.00 EUR',
    ]);
  });
});
