import { VividError } from '@mi-skam/vivid-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodlineError } from 'zodline';
import { formatError } from '../src/errors';

function vividError(status: number, code?: string, message = 'API message') {
  return new VividError({
    status,
    statusText: 'Status',
    body: {
      trace_id: 'trace-42',
      errors: code ? [{ code, message }] : [],
    },
  });
}

describe('formatError', () => {
  it('passes ZodlineError messages through', () => {
    expect(formatError(new ZodlineError('Unknown command: foo'))).toBe(
      'Unknown command: foo',
    );
  });

  it('formats ZodError issues as one line per issue', () => {
    const result = z.object({ limit: z.number() }).safeParse({ limit: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatError(result.error)).toMatch(/^limit: /);
    }
  });

  it.each([
    [401, 'invalid_key', 'vivid login'],
    [401, 'key_revoked', 'Add API token'],
    [401, 'key_expired', 'Add API token'],
    [401, 'address_not_allowed', 'allow list'],
    [403, 'scope_denied', 'transactions:read'],
    [403, 'user_not_in_entity', 'left the company'],
    [403, 'issuer_not_permitted', 'Manage API tokens'],
    [403, 'entity_inactive', 'Contact Vivid support'],
    [404, 'outside_history_window', 'older than 90 days'],
    [429, 'rate_limited', 'rate limit'],
  ])('maps %i %s to a hint', (status, code, hint) => {
    expect(formatError(vividError(status, code))).toContain(hint);
  });

  it('includes the trace id for server errors', () => {
    const message = formatError(vividError(503, 'internal_error'));
    expect(message).toContain('503');
    expect(message).toContain('trace-42');
  });

  it('treats unknown 401 codes as an authentication failure', () => {
    expect(formatError(vividError(401, 'brand_new_code'))).toContain(
      'vivid login',
    );
  });

  it('uses the API message for other errors', () => {
    expect(
      formatError(
        vividError(400, 'invalid_request', 'account_ids[0] must be a UUID'),
      ),
    ).toBe('account_ids[0] must be a UUID');
    expect(formatError(vividError(404, 'not_found', 'not found'))).toBe(
      'not found',
    );
  });

  it('stringifies unknown errors', () => {
    expect(formatError('boom')).toBe('boom');
  });
});
