/**
 * Readable groups for merchant category codes (ISO 18245). Deliberately
 * coarse: a dozen buckets that matter for business spending. Single codes are
 * checked before ranges; a code in no group is shown as `MCC 1234`.
 */
const CODES: Record<string, string> = {
  '4111': 'Transport',
  '4112': 'Transport',
  '4121': 'Transport',
  '4131': 'Transport',
  '4511': 'Travel',
  '4722': 'Travel',
  '4784': 'Transport',
  '4789': 'Transport',
  '4812': 'Telecom & internet',
  '4814': 'Telecom & internet',
  '4816': 'Telecom & internet',
  '4899': 'Telecom & internet',
  '4900': 'Utilities',
  '5045': 'Software & IT',
  '5732': 'Software & IT',
  '5734': 'Software & IT',
  '5817': 'Software & IT',
  '5818': 'Software & IT',
  '7372': 'Software & IT',
  '7379': 'Software & IT',
  '5411': 'Groceries',
  '5422': 'Groceries',
  '5441': 'Groceries',
  '5451': 'Groceries',
  '5462': 'Groceries',
  '5499': 'Groceries',
  '5541': 'Fuel & vehicles',
  '5542': 'Fuel & vehicles',
  '5983': 'Fuel & vehicles',
  '7523': 'Fuel & vehicles',
  '7538': 'Fuel & vehicles',
  '5811': 'Food & drink',
  '5812': 'Food & drink',
  '5813': 'Food & drink',
  '5814': 'Food & drink',
  '5111': 'Office supplies',
  '5943': 'Office supplies',
  '5044': 'Office supplies',
  '6010': 'Cash',
  '6011': 'Cash',
  '7011': 'Travel',
  '7311': 'Advertising',
  '8111': 'Professional services',
  '8931': 'Professional services',
  '9311': 'Taxes & government',
};

const RANGES: Array<[number, number, string]> = [
  [3000, 3350, 'Travel'],
  [3351, 3500, 'Fuel & vehicles'],
  [3501, 3999, 'Travel'],
  [4000, 4799, 'Transport'],
  [5000, 5599, 'Retail'],
  [5600, 5699, 'Retail'],
  [5700, 5999, 'Retail'],
  [6000, 6999, 'Financial services'],
  [7000, 7299, 'Services'],
  [7300, 7399, 'Business services'],
  [7400, 7999, 'Services'],
  [8000, 8099, 'Health'],
  [8100, 8999, 'Professional services'],
  [9000, 9999, 'Taxes & government'],
];

export function categoryOf(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  const known = CODES[code];
  if (known) {
    return known;
  }
  const value = Number(code);
  const range = RANGES.find(([low, high]) => value >= low && value <= high);
  return range ? range[2] : `MCC ${code}`;
}
