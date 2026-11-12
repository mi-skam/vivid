import { z } from 'zod';

export type OutputFormat = 'table' | 'json' | 'csv';
export type CsvLocale = 'en' | 'de';

/** Options shared by every command that can print a list. */
export const formatOptions = {
  format: z
    .enum(['table', 'json', 'csv'])
    .optional()
    .describe('Output format: table (default), json or csv.'),
  csvLocale: z
    .enum(['en', 'de'])
    .default('en')
    .describe(
      'CSV dialect: en (comma separator, 1234.56) or de (semicolon separator, 1234,56, with a byte order mark so Excel reads umlauts).',
    ),
  json: z
    .boolean()
    .default(false)
    .describe('Output in JSON format. Same as --format json.'),
};

export function outputFormat(options: {
  format?: OutputFormat | undefined;
  json?: boolean | undefined;
}): OutputFormat {
  if (options.json) {
    if (options.format !== undefined && options.format !== 'json') {
      throw new Error('Pass either --json or --format, not both.');
    }
    return 'json';
  }
  return options.format ?? 'table';
}

export interface CsvOptions {
  columns: string[];
  locale?: CsvLocale | undefined;
  /** Columns holding API amounts; `de` writes them with a decimal comma. */
  amountColumns?: string[];
}

/**
 * Prints RFC 4180 style CSV. Text cells starting with `=`, `+`, `-`, `@` or a
 * control character are prefixed with `'` so a spreadsheet never runs a
 * merchant name as a formula. Amount columns are left as numbers.
 */
export function printCsv(
  rows: Array<Record<string, string>>,
  options: CsvOptions,
): void {
  const locale = options.locale ?? 'en';
  const delimiter = locale === 'de' ? ';' : ',';
  const amounts = new Set(options.amountColumns ?? []);
  const cell = (column: string, raw: string): string => {
    let value = raw;
    if (amounts.has(column)) {
      if (locale === 'de') {
        value = value.replace('.', ',');
      }
    } else if (/^[=+\-@\t\r]/.test(value)) {
      value = `'${value}`;
    }
    return value.includes(delimiter) ||
      /["\n\r]/.test(value) ||
      value !== value.trim()
      ? `"${value.replaceAll('"', '""')}"`
      : value;
  };
  const lines = [
    options.columns.join(delimiter),
    ...rows.map((row) =>
      options.columns
        .map((column) => cell(column, row[column] ?? ''))
        .join(delimiter),
    ),
  ];
  console.log(`${locale === 'de' ? '﻿' : ''}${lines.join('\n')}`);
}
