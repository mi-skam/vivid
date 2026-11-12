/**
 * The API sends amounts as decimal strings with two decimals ("-12.50").
 * Totals are added up in integer cents so no rounding error creeps in.
 */
export function toCents(amount: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) {
    throw new Error(`Unexpected amount format from the API: "${amount}".`);
  }
  const [, sign, units = '0', fraction = ''] = match;
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign ? -cents : cents;
}

/** Formats integer cents back into the API's notation, e.g. `-12.50`. */
export function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}${absolute / 100n}.${fraction}`;
}
