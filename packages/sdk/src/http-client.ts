import { VividError } from './errors';

export const DEFAULT_BASE_URL = 'https://api.prime.vivid.money/sme-integration';

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT = '@genz-its/vivid-sdk';
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000;
const RETRY_MAX_DELAY = 10_000;
const RETRY_AFTER_MAX_DELAY = 60_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export interface VividOptions {
  /**
   * The API key exactly as issued (`vivid_sk_v1_…`), sent as raw
   * `Authorization` header value — no `Bearer` prefix.
   */
  apiKey: string;
  /** The API base URL, without the `/api/v1` version path. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30 seconds. */
  timeout?: number;
  userAgent?: string;
  /**
   * How often a failed request (network error, `429`, `5xx`) is repeated
   * before the error is thrown. Defaults to 3; `0` disables retries.
   */
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
}

export interface HttpRequestOptions {
  /** Route path including the version, e.g. `/api/v1/ping`. */
  path: string;
  /** JSON request body. Defaults to `{}`; `undefined` fields are dropped. */
  body?: object;
}

/**
 * The only place that talks to the network.
 *
 * Every Vivid Business API route is a `POST` with a JSON body, including
 * reads. Version 1 of the API is read-only — no route can move money or
 * change the account — so, unlike in APIs where `POST` creates records, every
 * request is safe to repeat. Requests are therefore retried regardless of
 * method on network errors, `429` and `5xx`, up to {@link RETRY_MAX_ATTEMPTS}
 * times by default (`maxRetries` overrides it). A `Retry-After` header is honored (capped at one minute); otherwise
 * the delay is a jittered exponential backoff starting at one second and
 * capped at ten. Any other `4xx` fails again unchanged and is never retried.
 */
export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly userAgent: string;
  private readonly maxRetries: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: VividOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.maxRetries = Math.max(0, options.maxRetries ?? RETRY_MAX_ATTEMPTS);
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** Performs a request and returns the parsed JSON response body. */
  public async request<T>(options: HttpRequestOptions): Promise<T> {
    const response = await this.fetchWithRetry(options);
    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  private async fetchWithRetry(options: HttpRequestOptions): Promise<Response> {
    const url = this.baseUrl + options.path;
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxRetries;
      let response: Response;
      try {
        response = await this.fetch(url, this.buildRequestInit(options));
      } catch (error) {
        if (canRetry) {
          await delay(backoffDelay(attempt));
          continue;
        }
        throw error;
      }
      if (response.ok) {
        return response;
      }
      if (canRetry && RETRYABLE_STATUS_CODES.has(response.status)) {
        // Release the connection before waiting.
        await response.body?.cancel();
        await delay(
          retryAfterDelay(response.headers.get('Retry-After')) ??
            backoffDelay(attempt),
        );
        continue;
      }
      throw new VividError({
        status: response.status,
        statusText: response.statusText,
        body: await parseErrorBody(response),
        traceId: response.headers.get('X-Trace-Id'),
      });
    }
  }

  private buildRequestInit(options: HttpRequestOptions): RequestInit {
    return {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent,
      },
      body: JSON.stringify(options.body ?? {}),
      signal: AbortSignal.timeout(this.timeout),
    };
  }
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function backoffDelay(attempt: number): number {
  const ceiling = Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

function retryAfterDelay(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : new Date(header).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return undefined;
  }
  return Math.min(milliseconds, RETRY_AFTER_MAX_DELAY);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
