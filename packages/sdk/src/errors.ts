import type { OpenEnum } from './types';

/**
 * Error codes documented by the Vivid Business API. The list is open: an
 * unknown code is a generic error of its HTTP status.
 */
export type VividErrorCode = OpenEnum<
  | 'invalid_request'
  | 'invalid_key'
  | 'key_revoked'
  | 'key_expired'
  | 'address_not_allowed'
  | 'scope_denied'
  | 'user_not_in_entity'
  | 'issuer_not_permitted'
  | 'entity_inactive'
  | 'not_found'
  | 'outside_history_window'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'internal_error'
>;

/** One entry of the `errors` list in the API's error envelope. */
export interface VividErrorDetail {
  code: VividErrorCode;
  /** For people only and subject to change. Never branch on it. */
  message: string;
}

/** The error envelope every failed request returns. */
export interface VividErrorBody {
  trace_id: string;
  errors: VividErrorDetail[];
}

export interface VividErrorOptions {
  status: number;
  statusText: string;
  body: unknown;
  /** Value of the `X-Trace-Id` response header, if present. */
  traceId?: string | null;
}

/**
 * Thrown for every non-2xx response. Handle it by `status`, then by `codes`
 * — never by `message`, which is meant for people and can change.
 */
export class VividError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly body: unknown;
  /** The `trace_id` of the error envelope, or the `X-Trace-Id` header. */
  public readonly traceId: string | null;
  /** The parsed `errors` list; empty when the body was not an error envelope. */
  public readonly errors: VividErrorDetail[];

  constructor(options: VividErrorOptions) {
    const errors = extractErrors(options.body);
    super(extractMessage(options, errors));
    this.name = 'VividError';
    this.status = options.status;
    this.statusText = options.statusText;
    this.body = options.body;
    this.errors = errors;
    this.traceId = extractTraceId(options.body) ?? options.traceId ?? null;
  }

  /** All error codes of the response, in order. */
  public get codes(): VividErrorCode[] {
    return this.errors.map((error) => error.code);
  }

  /** All error messages of the response, in order. */
  public get messages(): string[] {
    return this.errors.map((error) => error.message);
  }

  /** The first error code, or `undefined` when the body carried none. */
  public get code(): VividErrorCode | undefined {
    return this.errors[0]?.code;
  }

  /** Whether any error of the response has the given code. */
  public hasCode(code: VividErrorCode): boolean {
    return this.errors.some((error) => error.code === code);
  }
}

function extractErrors(body: unknown): VividErrorDetail[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const { code, message } = entry as { code?: unknown; message?: unknown };
    if (typeof code !== 'string') {
      return [];
    }
    return [{ code, message: typeof message === 'string' ? message : '' }];
  });
}

function extractTraceId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const traceId = (body as { trace_id?: unknown }).trace_id;
  return typeof traceId === 'string' && traceId.length > 0
    ? traceId
    : undefined;
}

function extractMessage(
  options: VividErrorOptions,
  errors: VividErrorDetail[],
): string {
  const messages = errors
    .map((error) => error.message)
    .filter((message) => message.length > 0);
  if (messages.length > 0) {
    return messages.join('; ');
  }
  if (typeof options.body === 'string' && options.body.length > 0) {
    return options.body;
  }
  return `Vivid API error: ${options.status} ${options.statusText}`.trim();
}
