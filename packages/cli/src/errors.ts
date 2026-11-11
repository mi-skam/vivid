import { VividError } from '@genz-its/vivid-sdk';
import { z } from 'zod';
import { ZodlineError } from 'zodline';

const NEW_KEY_HINT =
  'Create a new key in Vivid Business (web → API → Add API token) and run `vivid login`.';

/**
 * User-facing hints by error code. Errors are handled by status, then code —
 * never by message, which the API may change. Unknown codes fall through to a
 * generic message for their status.
 */
const HINTS: Record<string, string> = {
  invalid_key:
    'The API key was not accepted. Check it, or run `vivid login` again.',
  key_revoked: `The API key was deleted in Vivid Business. ${NEW_KEY_HINT}`,
  key_expired: `The API key has expired (keys live at most 180 days). ${NEW_KEY_HINT}`,
  address_not_allowed:
    "This machine's IP address is not on the key's allow list. Call from an allowed address, or create a key that allows it.",
  scope_denied:
    'The API key lacks the permission for this call (accounts:read, transactions:read or cards:read). Create a key with that permission and run `vivid login`.',
  user_not_in_entity: `The member who created the API key has left the company. ${NEW_KEY_HINT}`,
  issuer_not_permitted: `The member who created the API key lost the Manage API tokens permission. ${NEW_KEY_HINT}`,
  entity_inactive:
    'Your company cannot use the Vivid API right now. Contact Vivid support.',
  outside_history_window:
    'Transactions older than 90 days are not available through the Vivid API.',
  rate_limited:
    'The Vivid API rate limit was reached (60 requests per minute per key). Wait a minute and try again.',
};

function withTrace(message: string, error: VividError): string {
  return error.traceId ? `${message} (trace id: ${error.traceId})` : message;
}

function formatVividError(error: VividError): string {
  if (error.status >= 500) {
    return withTrace(
      `The Vivid API failed with status ${error.status}. Try again later; if it repeats, contact Vivid support with the trace id.`,
      error,
    );
  }
  const hint = error.codes.map((code) => HINTS[code]).find(Boolean);
  if (hint) {
    return hint;
  }
  if (error.status === 401) {
    return 'Authentication failed. Check your API key or run `vivid login` again.';
  }
  return error.message;
}

export function formatError(error: unknown): string {
  if (error instanceof ZodlineError) {
    return error.message;
  }
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('\n');
  }
  if (error instanceof VividError) {
    return formatVividError(error);
  }
  return error instanceof Error ? error.message : String(error);
}
