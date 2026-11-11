import type { Account, Transaction } from '@mi-skam/vivid-sdk';
import { describe, expect, it } from 'vitest';
import {
  accountIban,
  amountLabel,
  originalAmountLabel,
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
