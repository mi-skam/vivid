# @mi-skam/vivid-sdk

Unofficial Node.js SDK for the [Vivid Business](https://vivid.money/en-eu/business/) API.[^1]

## Features

- 🧩 **Complete v1 coverage**: Accounts and balances, transactions of the last 90 days, cards with their limits, and `ping`.
- 🪶 **Zero dependencies**: Built on the native `fetch` API.
- 🔁 **Resilient**: Automatic retries with exponential backoff for network errors, `429` and `5xx` responses, honoring `Retry-After`. Safe for every route because API v1 is read-only.
- 🦺 **Fully typed**: Hand-written TypeScript types that mirror the API's snake_case responses. Fixed lists are typed as open enums, so a value Vivid adds later never breaks your code.

## Requirements

- Node.js 22 or later.
- A Vivid Business API key (`vivid_sk_v1_…`), created on the web under **API > Add API token**. API access requires a paid plan.

## Installation

The package is not published to npm. Install the SDK tarball from a GitHub release:

```bash
gh release download vX.Y.Z --repo mi-skam/vivid --pattern 'vivid-sdk-*.tgz'
npm install ./vivid-sdk-X.Y.Z.tgz
```

## Usage

```ts
import { Vivid } from '@mi-skam/vivid-sdk';

const vivid = new Vivid({ apiKey: process.env.VIVID_API_KEY! });

// Check that the key works
await vivid.ping(); // { status: 'ok' }

// Every payment account, with balances when the key's issuer may see them
const accounts = await vivid.accounts.list();

// Transactions are paged: follow next_cursor until it is null.
// A short or even empty page does not mean the end.
let cursor: string | undefined;
do {
  const page = await vivid.transactions.list({
    accountTypes: ['current'], // exactly one of accountIds / accountTypes
    state: 'completed',
    limit: 500,
    cursor,
  });
  for (const transaction of page.transactions) {
    console.log(transaction.show_at, transaction.amount, transaction.currency);
  }
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

### Client options

| Option      | Description                                                                      | Default                                         |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `apiKey`    | The API key exactly as issued, sent as raw `Authorization` header — no `Bearer`. | –                                               |
| `baseUrl`   | The API base URL, without `/api/v1`.                                             | `https://api.prime.vivid.money/sme-integration` |
| `timeout`   | Request timeout in milliseconds.                                                 | `30000`                                         |
| `userAgent` | The `User-Agent` header value.                                                   | `@mi-skam/vivid-sdk`                            |
| `fetch`     | A custom `fetch` implementation, for example for testing or proxying.            | `globalThis.fetch`                              |

### Resources

| Resource             | Description                                                                         | Permission          |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------- |
| `vivid.ping()`       | Check that the API is reachable and the key is accepted.                            | any                 |
| `vivid.accounts`     | List payment accounts (`list`, not paged) and get one by id (`get`).                | `accounts:read`     |
| `vivid.transactions` | List transactions of the last 90 days (`list`, one page) and get one by id (`get`). | `transactions:read` |
| `vivid.cards`        | List cards (`list`, one page) and get one with its limits by id (`get`).            | `cards:read`        |

Request options are camelCase (`accountIds`, `updatedFrom`); responses are returned exactly as the API sends them, in snake_case (`next_cursor`, `show_at`). Paged `list` methods return a single page and stay 1:1 with the route.

### Error handling

Any non-2xx response throws a `VividError`. Handle it by `status`, then by `code` — never by `message`, which is meant for people and can change. Treat an unknown code as a generic error of its status.

```ts
import { VividError } from '@mi-skam/vivid-sdk';

try {
  await vivid.transactions.get({ transactionId });
} catch (error) {
  if (error instanceof VividError) {
    if (error.status === 404 && error.hasCode('outside_history_window')) {
      // older than 90 days
    }
    console.error(error.status, error.codes, error.messages, error.traceId);
  }
}
```

`traceId` comes from the error body or the `X-Trace-Id` header; include it when contacting Vivid support.

### Good to know

- **Every route is `POST`** with a JSON body, reads included. The SDK always sends `application/json` and `{}` when there is nothing to send.
- **Amounts are strings** with two decimals, negative for money out (`"-12.50"`). Times are RFC 3339 in UTC.
- **Every field is always present**; unknown values are `null`. Some depend on what the key's issuer may see in the app: `balance` is `null` without balance visibility, and a card's `limits` is empty when `limits_visible` is `false`. An empty list can also mean the issuer cannot see the data.
- **Transactions cover 90 days**, counted from `show_at` at 00:00 UTC. Older ones answer `404 outside_history_window`.
- **Keys expire** after at most 180 days and may be restricted to IP addresses (`401 address_not_allowed`).
- **There is no sandbox**: every call reads live data. The API cannot change anything.

[^1]: This project is not affiliated with, endorsed by, sponsored by, or approved by Vivid Money GmbH or any of their affiliates or subsidiaries.
