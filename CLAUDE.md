# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Live API safety (strict)

The CLI runs against a real Vivid Business account. There is **no sandbox**: every call reads live banking data.

- Vivid API v1 is read-only, so `ping`, `*:list`, `*:get` and `doctor` cannot change anything and may be run freely.
- **Never run `login` or `logout`** without asking first and getting an explicit yes for that specific run — they write or delete the stored key.
- **Never read, print or copy the API key.** Do not open `~/.config/vivid/config.json` and do not echo `VIVID_API_KEY`. Do not create or go looking for a key. Touch the account only through the CLI.
- Output of live commands contains real account data (IBANs, amounts, merchants). Keep it out of the repo, tests, docs and commits.
- `db:sync` writes real data into a local SQLite file. When trying it, point `VIVID_DB` at a scratch path outside the repo rather than the user's default database, unless asked otherwise.

## Commands

```bash
npm install
npm run build                 # tsdown build in every workspace
npm test                      # vitest run in every workspace
npm run typecheck             # tsc --noEmit in every workspace
npm run lint                  # eslint . && prettier --check .
npm run fmt                   # eslint --fix . && prettier --write .

npm test -w @mi-skam/vivid-sdk -- transactions   # single test file (vitest name filter)
npm test -w @mi-skam/vivid -- --watch

node packages/cli/dist/index.js <command>         # run the built CLI locally
```

CLI tests import the SDK through the workspace link, which resolves to `packages/sdk/dist` — run `npm run build` before `npm test`. CI runs `build`, `lint`, `typecheck`, `test`, `release:pack` and `release:verify` on Node 22 and 24. Node >= 22.13 is required for the CLI (built-in `node:sqlite`), >= 22 for the SDK.

## Architecture

npm workspaces monorepo with two published packages. **The CLI is a thin layer over the SDK — never call the Vivid API directly from CLI code.**

### `packages/sdk` — `@mi-skam/vivid-sdk`

Zero runtime dependencies, native `fetch`, ESM only.

- `src/http-client.ts` — the only place that talks to the network. Every request is `POST` to `baseUrl + path` with a JSON body (`{}` when empty, `undefined` fields dropped). Owns auth (raw key in `Authorization`, no `Bearer`), timeouts via `AbortSignal.timeout`, and retries: because v1 is read-only, **every** request is retried on network errors, `429` and `5xx` (3 retries, honoring `Retry-After` capped at 60 s, otherwise jittered backoff from 1 s capped at 10 s). Other `4xx` are never retried. Non-2xx throws `VividError`.
- `src/errors.ts` — `VividError` with `status`, `statusText`, `body`, `errors`, `codes`, `messages`, `code`, `hasCode()`, `traceId` (from `trace_id` in the body, else the `X-Trace-Id` header).
- `src/resources/*.ts` — one class per API area (`accounts`, `transactions`, `cards`), each extending `BaseResource` with the shared `HttpClient`. `Vivid` in `src/client.ts` instantiates them as readonly properties and adds `ping()`.
- `src/types.ts` — `OpenEnum`, `Amount`, `DateInput`, `CursorListOptions`, `CursorPage`. `src/dates.ts` — `toRfc3339`.
- `src/index.ts` re-exports everything; new resources must be added there.

### `packages/cli` — `@mi-skam/vivid` (bin `vivid`)

Built on `zodline` + `zod` + `consola`.

- `src/index.ts` — registers every command in a flat `commands` map keyed `group:action` (e.g. `transactions:list`). New commands must be imported and registered here. Top-level try/catch funnels all errors through `formatError`, then sets exit code 1.
- `src/commands/<group>/<action>.ts` — one `defineCommand({ description, args?, options: defineOptions(z.object({…})), action })` per file, default-exported.
- `src/client.ts` — `requireClient()` resolves the key and exits with a hint if absent; `createClient()` sets the CLI `User-Agent` (`@mi-skam/vivid/<version>`).
- `src/config.ts` — key resolution order: `VIVID_API_KEY` env var → `~/.config/vivid/config.json` (`apiKey`, respects `XDG_CONFIG_HOME`, written with mode `0600`). No OS keyring.
- `src/arguments.ts` — `idArgument` validates UUIDs (8-4-4-4-12) before any request; `requireIdArgument` prompts when interactive; `listOption` flattens repeatable, comma-separated options.
- `src/resolve.ts` — resolves account/card names to IDs (see API quirks).
- `src/options.ts` / `src/prompt.ts` / `src/interactive.ts` — `promptSecret` reads the API key in raw mode and echoes `*` per character (never the key); `requireStringOption` prompts when interactive and exits 1 with an explanatory message when not. Non-interactive = no TTY or `CI` set.
- `src/pagination.ts` — cursor-based `fetchAll` (see API quirks).
- `src/output.ts` — `printJson`, `printTable`, and label helpers (`amountLabel`, `accountIban`, `originalAmountLabel`, `merchantLabel`, `toTimestamp`).
- `src/query.ts` — `queryTransactions` and the shared filter options of `transactions:list`/`transactions:summary`: resolves accounts, reads the API or (`--local`) the store, then applies the filters the API cannot — the payment period (`src/period.ts`: `--since`/`--until`/`--month` on `show_at ?? created_at`, never `updated_at`), `--card` (four digits match `card.last_4` without a request) and `--merchant`. Warns when a period starts before the 90-day window. With a client-side filter, `--limit` applies after filtering, so the whole window is fetched.
- `src/summary.ts` — `summarize` groups per currency (never mixed), sums in integer cents (`src/money.ts`, `bigint`, never floats), and splits `out` / `refunds` (`card_refund`) / `in` / `transfers` (`transfer`, `exchange`). `src/categories.ts` maps MCCs to coarse hand-written groups.
- `src/format.ts` — `--format table|json|csv`, `--csv-locale en|de`; `--json` stays as an alias and keeps printing API objects unchanged. `printCsv` prefixes text cells starting with `= + - @` with `'`.
- `src/store.ts` — the local SQLite database via built-in `node:sqlite` (Node ≥ 22.13), loaded lazily with its experimental warning suppressed. Path: `VIVID_DB` → `$XDG_DATA_HOME/vivid/vivid.db` → `~/.local/share/vivid/vivid.db`, mode `0600`. Schema version in `PRAGMA user_version`; bump `SCHEMA_VERSION` and add a migration step for any schema change. Timestamps are stored as `toISOString()` so text order is time order; each API object is kept unchanged in `data`. Read commands open it with `create: false` and fail with a hint to run `db:sync`.
- `src/sync.ts` — `syncStore`: one global `watermark` (newest `updated_at` seen) in `meta`; known accounts fetch `updated_from = watermark − 1 h`, new accounts fetch the full window and get `history_from` in `account_sync`. Everything is written in one SQLite transaction. Transactions are never deleted, which is what keeps history beyond 90 days.
- `src/watch.ts` — `watchTransactions`: polling loop (first poll is a silent baseline, then `updated_from = newest seen − 5 min`, dedupe by id + `updated_at`), injectable `sleep`/`now`/`signal` for tests. The command enforces `--interval` ≥ 30 s because of the rate limit.
- `src/errors.ts` — maps `ZodlineError`, `ZodError` and `VividError` to user-facing strings: by status, then by `code` (`invalid_key`, `key_revoked`, `key_expired`, `address_not_allowed`, `scope_denied`, `user_not_in_entity`, `issuer_not_permitted`, `entity_inactive`, `outside_history_window`, `rate_limited`), `5xx` with the trace id, unknown codes fall back to the API message.

## Conventions

- **Hand-written types only.** `api.json` (Swagger 2.0, gitignored) is a local reference download, not a codegen source. Never generate code from it.
- SDK methods take a single camelCase options object and map it to the snake_case body; responses are returned as the API sends them (snake_case). Each method has a one-line JSDoc naming the route (`/** Retrieves a single card via \`POST /api/v1/cards/get\`. */`). Non-obvious API behavior belongs in JSDoc on the affected field.
- `get` methods unwrap the single-object envelope (`{ account }`, `{ transaction }`, `{ card }`); `accounts.list` unwraps `{ accounts }` because it is not paged; paged `list` methods return the page (`{ transactions | cards, next_cursor }`) and stay 1:1 with the route.
- **Every CLI command supports `--json`**, which prints the API objects unchanged. Exit codes are `0`/`1` only.
- CLI list commands print a table by default and `consola.info('No … found.')` on empty results. Primary IDs are positional; filters are named options.
- Documenting a new command means adding it to the list _and_ the reference section in `packages/cli/README.md`; new SDK resources go in the resources table in `packages/sdk/README.md`.

## API quirks to preserve

- **Every route is `POST`**, reads included, with `Content-Type: application/json`; a missing content type is `415`. Send `{}` when there is nothing to send.
- **Cursor pagination**: paged routes take `limit` (default 50, max 500) and `cursor`, and return `next_cursor`. Keep going until `next_cursor` is `null` — a short or **empty** page is not the end. `fetchAll` in `packages/cli/src/pagination.ts` does that, keeps the page size fixed for the whole run (a cursor is only valid with the request that produced it), honors a total `--limit`, and aborts on a repeated cursor. SDK `list` methods do not paginate.
- `transactions/list` requires **exactly one** of `account_ids` and `account_types`; both or neither is `400`. **`account_types` answers `500 internal_error` on the live API** (verified 11.11.2026, also with `limit: 1`), while `account_ids` works. So `transactions:list` without filters first lists the visible accounts and sends their IDs, and the `doctor` probe for `transactions:read` reads one row of one visible account (reported as `unknown` without `accounts:read` or without a visible account). `--account-type` is kept and passed through, with a note in its help. `--account` together with `--account-type` is rejected.
- **Names instead of IDs**: `accounts:get`, `cards:get` and `transactions:list --account` accept a name (`src/resolve.ts`): a UUID is used as is without a request; anything else is matched case-insensitively against the account `name`, or the card `name`/`last_4`. Exactly one match is required — no match or several matches exit 1 with the candidates, never a guess. Transactions have no name, so `transactions:get` takes IDs only.
- `doctor` uses `maxRetries: 1` so a persistent `5xx` is reported in seconds instead of after the full retry cycle.
- **Open enums**: `state`, `type`, `renewal`, error `code` and other fixed lists can grow without a new version. Types use `OpenEnum<…>` (known literals `| (string & {})`); never reject or drop an unknown value on output. Unknown values in a request filter are rejected by the API with `400`, so the CLI passes filter values through rather than validating them against a fixed list.
- **90-day history**: transactions are available from 00:00 UTC 90 days ago, counted from `show_at`. `transactions/get` on an older own transaction answers `404 outside_history_window`.
- **Visibility-dependent nulls**: a key acts as its creator. `balance` is `null` without balance visibility; card `limits` is empty when `limits_visible` is `false`; lists can be empty because the creator cannot see the data. Every field is always present, `null` when unknown.
- **Keys** are sent raw (`vivid_sk_v1_…`), expire after at most 180 days, can be IP-restricted (`401 address_not_allowed`), and carry fixed permissions (`scope_denied` = `403`). `doctor` treats `scope_denied` on its probes as "not granted", not as a failure.
- Transactions carry no counterparty or payment-reference field; the only "other side" is `merchant` (card operations).
- Rate limits: 60 requests/minute per key, 120 per company; `X-RateLimit-Limit`/`X-RateLimit-Remaining` on success.

## Testing

Vitest, no network. SDK tests build a resource on an `HttpClient` with a mocked `fetch` (`test/helpers.ts`: `createMockFetch`, `createHttpClient`, `lastRequest`) and assert on the exact URL, method, headers and JSON body; retries are tested with fake timers. CLI tests import the command module directly, `vi.stubGlobal('fetch', …)`, set `VIVID_API_KEY` (and a temporary `XDG_CONFIG_HOME` where config is touched), mock `../src/interactive` and `../src/prompt` where needed, and assert on requests, output and `process.exit` behavior. Add tests alongside every new resource method and command.

**Fixtures are always invented, never real.** Never paste a live API response into a test, a doc or a commit, and never commit a database file — no real ids, names, IBANs, amounts, merchants or card digits. Use fake UUIDs (`00000000-0000-4000-8000-…`), `ACME GmbH`, and the published test IBAN `DE89370400440532013000`. Keep any live output you capture while debugging outside the repo.

## Releases

release-please manages a single root component (`.`) with `include-component-in-tag: false`; `extra-files` bump both package versions, the CLI's pinned SDK dependency and the workspace entries in `package-lock.json`. Conventional commits drive versioning and the root `CHANGELOG.md`. **Nothing is published to npm** — releases are GitHub releases only. Merging the release PR makes `.github/workflows/release.yml` tag `vX.Y.Z`, create the GitHub release and call `.github/workflows/github-release.yml`, which checks out the tag, builds, tests, runs `scripts/package-release.mjs` (SDK tarball + CLI tarball with the exact SDK bundled, plus `SHA256SUMS`; checks `RELEASE_TAG` against the versions) and `scripts/verify-release.mjs` (isolated install and offline smoke tests), and attaches the files. It can also be run by hand (`gh workflow run github-release.yml -f tag=vX.Y.Z`) to (re)attach the assets of an existing tag. Both packages share a version. `save-exact=true` — all dependency versions are pinned, including the CLI's dependency on the SDK version (release-please bumps it). The changelog is generated and excluded from prettier.
