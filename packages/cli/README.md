# @mi-skam/vivid

Unofficial command-line interface for the [Vivid Business](https://vivid.money/en-eu/business/) API.[^1]

## Features

- 🏦 **Accounts**: List payment accounts with IBAN, state and balances.
- 💳 **Transactions**: List and filter the transactions of the last 90 days by payment date, card or merchant, across every page.
- 📊 **Summaries**: Spending per merchant, category, card, account, type or month, per currency, with refunds and transfers kept apart.
- 📄 **CSV export**: Every list as CSV, in standard or German Excel dialect.
- 🗄️ **Local history**: A local SQLite database that keeps transactions beyond the API's 90 days and answers queries without a request.
- 👀 **Watch**: Print new and changed transactions as they happen.
- 🪪 **Cards**: List cards and see how much of each limit is used.
- 🩺 **Doctor**: Check the key, the connection, and which permissions the key has.
- 🤖 **Automation-friendly**: `--json` output on every command, non-interactive mode, and stable exit codes.

## Requirements

- Node.js 22.13 or later.
- A Vivid Business API key (`vivid_sk_v1_…`). API access requires a paid plan.

## Installation

The packages are not published to npm. Install the CLI from a GitHub release (the CLI tarball bundles the matching SDK):

```bash
gh release download vX.Y.Z --repo mi-skam/vivid --pattern 'vivid-cli-*.tgz'
npm install -g ./vivid-cli-X.Y.Z.tgz
```

or build it from source:

```bash
git clone https://github.com/mi-skam/vivid && cd vivid
npm install && npm run build && npm run release:pack
npm install -g ./release-artifacts/vivid-cli-*.tgz
```

If the global npm prefix is not writable (e.g. on Nix), add `--prefix ~/.local` and put `~/.local/bin` on your `PATH`.

## Quickstart

```bash
# Log in with your API key
vivid login

# Verify your setup and see which permissions the key has
vivid doctor

# List your accounts and balances
vivid accounts:list

# Card payments of the last 7 days
vivid transactions:list --type card_payment --since 7d

# Last month as a CSV file for Excel (German dialect)
vivid transactions:list --month 2026-10 --format csv --csv-locale de > 2026-10.csv

# Where did the money go this month?
vivid transactions:summary --month 2026-11 --by category

# Keep a local history and query it without requests
vivid db:sync
vivid transactions:summary --local --by month
```

## Authentication

Run [`vivid login`](#login) to validate and store your API key. Create a key in Vivid Business on the web under **API > Add API token**; you need the **Manage API tokens** permission. Choose the permissions the CLI should use (`accounts:read`, `transactions:read`, `cards:read`). The key is shown only once, expires after at most 180 days, and can be restricted to IP addresses.

The key is resolved in the following order:

1. The `VIVID_API_KEY` environment variable.
2. The config file written by `vivid login` (`~/.config/vivid/config.json`, respecting `XDG_CONFIG_HOME`, mode `0600`).

In CI or other automated environments, prefer the `VIVID_API_KEY` environment variable over storing the key on disk.

A key acts as the member who created it and sees exactly what that member sees in the app. An empty list can mean the member cannot see the data; balances show as empty when the member may not see balances.

## Argument conventions

Target IDs are UUIDs and positional. Place them before options:

```bash
vivid accounts:get 00000000-0000-4000-8000-000000000001 --json
vivid transactions:list --account 00000000-0000-4000-8000-000000000001 --limit 20
vivid accounts:get Main --json        # by name instead of ID
vivid transactions:list --account Main --type transfer
```

Accounts and cards can be given by ID or by name (case-insensitive; cards also by their last four digits); a name must match exactly one object. Commands that take an ID prompt for it in a terminal when it is omitted; non-interactive calls must supply it. Filters stay named options. Repeatable filters (`--account`, `--account-type`, `--type`) accept the flag several times or a comma-separated list.

## Scripting

The CLI is designed to be scriptable:

- **`--json`**: Every command supports the `--json` flag to output machine-readable JSON, exactly as the API returns it (`transactions:summary` prints its rows).
- **`--format csv`**: `accounts:list`, `cards:list`, `transactions:list` and `transactions:summary` also print CSV. `--csv-locale de` switches to semicolons and decimal commas with a byte order mark, which Excel in German opens directly. Text cells starting with `=`, `+`, `-` or `@` get a leading `'` so a spreadsheet never runs them as formulas.
- **Non-interactive mode**: When the CLI runs without a TTY or with the `CI` environment variable set, it never prompts. Missing required values cause an error and exit code `1` instead.
- **Exit codes**: `0` on success, `1` on any failure.
- **Read-only**: Vivid API v1 cannot move money or change the account, so every command except `login`/`logout` only reads.

```bash
# Example: IDs of completed card payments at a merchant this month
vivid transactions:list --month 2026-11 --merchant acme --state completed --json | jq -r '.[].id'
```

## Dates and periods

The API can only filter by when a transaction last _changed_ (`--updated-from`, `--updated-to`). A payment made on 2 October that settles on 5 October changed on 5 October. To select by when a payment _happened_ (`show_at`, or when Vivid recorded it if that is unknown), use:

- `--since` / `--until`: a relative age (`7d`, `2w`), a date (`2026-10-01`, midnight UTC; as `--until` the whole day is included) or an RFC 3339 timestamp.
- `--month`: a calendar month (`2026-10`, UTC).

These are applied by the CLI after fetching the API's whole 90-day window, which takes one request per 500 transactions. The API keeps transactions from 00:00 UTC 90 days ago; a period reaching further back prints a warning, because older transactions are only available from the [local database](#local-database).

## Local database

`vivid db:sync` copies accounts, cards and transactions into a SQLite database. The first run fetches the last 90 days; later runs fetch only what changed since the previous one. Transactions stay in the database after they leave the API's 90-day window, so **running it at least every 90 days** (e.g. from cron) builds a complete history. A run more than 90 days after the previous one warns that changes in between could not be fetched.

`transactions:list` and `transactions:summary` read it instead of the API with `--local`: no request, no rate limit, and every transaction ever synced.

- **Location:** `~/.local/share/vivid/vivid.db` (respecting `XDG_DATA_HOME`), or the path in `VIVID_DB`. It holds real banking data: it is created with mode `0600`; keep it out of shared folders and backups you do not trust.
- **Requirements:** Node.js 22.13 or later (built-in `node:sqlite`; no native module).
- **Inspect:** `vivid db:info`, or open the file with any SQLite tool. The `transactions` table keeps each API object unchanged in `data` (JSON) next to indexed columns.
- **Reset:** delete the file; the next `db:sync` starts over with the last 90 days.

```bash
# Cron: sync every morning at 6
0 6 * * * VIVID_API_KEY=… vivid db:sync >/dev/null
```

## Commands

- [`login`](#login)
- [`logout`](#logout)
- [`ping`](#ping)
- [`doctor`](#doctor)
- [`accounts:get`](#accountsget)
- [`accounts:list`](#accountslist)
- [`cards:get`](#cardsget)
- [`cards:list`](#cardslist)
- [`transactions:get`](#transactionsget)
- [`transactions:list`](#transactionslist)
- [`transactions:summary`](#transactionssummary)
- [`transactions:watch`](#transactionswatch)
- [`db:sync`](#dbsync)
- [`db:info`](#dbinfo)

### `login`

Log in with your Vivid Business API key. The key is validated with `ping` before it is stored in the config file; a key that fails is never stored.

```bash
vivid login [options]
```

**Options:**

- `--api-key`: The Vivid Business API key (`vivid_sk_v1_…`). If omitted, you will be prompted; the key is not echoed (each character shows as `*`). Prefer the prompt: a key passed as option ends up in your shell history.
- `--json`: Output in JSON format.

### `logout`

Log out by removing the stored API key. Warns when `VIVID_API_KEY` is still set.

```bash
vivid logout [options]
```

**Options:**

- `--json`: Output in JSON format.

### `ping`

Check that the Vivid API is reachable and the API key is accepted. Exits `1` when the key is missing or rejected. For the permissions of the key, use `doctor`.

```bash
vivid ping [options]
```

**Options:**

- `--json`: Output in JSON format (the API response, e.g. `{"status":"ok"}`).

### `doctor`

Check the CLI setup, the connection to the Vivid API and the permissions of the API key. After a successful `ping`, it makes one minimal read per permission (`accounts:read`, `transactions:read`, `cards:read`) and reports each as granted or not granted. A permission the key was not issued with is not a failure; doctor exits `1` only when no key is found, `ping` fails, or a probe fails for another reason.

```bash
vivid doctor [options]
```

**Options:**

- `--json`: Output in JSON format.

### `accounts:get`

Show a single payment account, including its account details (IBAN, BIC, holder, bank) and balance.

```bash
vivid accounts:get [id-or-name] [options]
```

**Argument:** `id` — The account ID (UUID). If omitted, you will be prompted.

**Options:**

- `--json`: Output in JSON format.

### `accounts:list`

List your payment accounts with name, IBAN, currency, state, and available and pending balance. Balances are empty when the key's issuer may not see them. With several accounts in a currency, the table ends with a `TOTAL` row per currency; accounts with a hidden balance are counted (`1 balance(s) hidden`), not taken as zero.

```bash
vivid accounts:list [options]
```

**Options:**

- `--include-closed`: Include closed accounts. Defaults to open accounts only.
- `--format`: Output format: `table` (default), `json` or `csv`.
- `--csv-locale`: CSV dialect: `en` (comma, `1234.56`, default) or `de` (semicolon, `1234,56`, with a byte order mark for Excel).
- `--json`: Output in JSON format. Same as `--format json`.

### `cards:get`

Show a single card and its limits.

```bash
vivid cards:get [id-name-or-last4] [options]
```

**Argument:** `id` — The card ID (UUID). If omitted, you will be prompted.

**Options:**

- `--json`: Output in JSON format.

### `cards:list`

List your cards with their limits and how much of each is used, e.g. `spending/monthly 850.00/1000.00 EUR (85%) !`. `!` marks a limit at 80 % or more; `hidden` means the key's issuer may not see limits. Closed cards are never returned. The API reports no expiry date.

```bash
vivid cards:list [options]
```

**Options:**

- `--limit`: The maximum number of cards to return. Defaults to all of them.
- `--format`: Output format: `table` (default), `json` or `csv`.
- `--csv-locale`: CSV dialect: `en` (comma, `1234.56`, default) or `de` (semicolon, `1234,56`, with a byte order mark for Excel).
- `--json`: Output in JSON format. Same as `--format json`.

### `transactions:get`

Show a single transaction. Transactions older than 90 days are not available.

```bash
vivid transactions:get [id] [options]
```

**Argument:** `id` — The transaction ID (UUID). If omitted, you will be prompted.

**Options:**

- `--json`: Output in JSON format.

### `transactions:list`

List transactions of the last 90 days, newest first, with date (`show_at`), amount, original amount when made in another currency, merchant, type and state. Pages through all results. With `--local`, lists every transaction in the local database instead.

```bash
vivid transactions:list [options]
```

**Options:**

- `--account`: Only transactions of this account, by ID or name. Repeat it or pass a comma-separated list. Cannot be combined with `--account-type`.
- `--account-type`: Only transactions of accounts of this type: `current` or `other`. Repeat it or pass a comma-separated list. Note: the live API currently answers this filter with `500 internal_error`; prefer `--account`. Without `--account` and `--account-type`, every visible account is queried by ID.
- `--type`: Only transactions of this type: `card_payment`, `card_refund`, `atm`, `transfer`, `exchange`, `fee` or `other`. Repeat it or pass a comma-separated list.
- `--since` / `--until` / `--month`: Only transactions that happened in this period; see [Dates and periods](#dates-and-periods).
- `--card`: Only transactions made with this card, by ID, name or last four digits. Four digits need no extra request.
- `--merchant`: Only transactions whose merchant name contains this text (case-insensitive).
- `--local`: Read from the [local database](#local-database) instead of the API.
- `--state`: Only transactions in this state: `pending`, `completed` or `declined`.
- `--updated-from`: Only transactions changed at or after this moment (RFC 3339, or `YYYY-MM-DD` for midnight UTC). For when a payment happened, use `--since`.
- `--updated-to`: Only transactions changed before this moment. For when a payment happened, use `--until`.
- `--limit`: The maximum number of transactions to return. Defaults to all of them.
- `--format`: Output format: `table` (default), `json` or `csv`.
- `--csv-locale`: CSV dialect: `en` (comma, `1234.56`, default) or `de` (semicolon, `1234,56`, with a byte order mark for Excel).
- `--json`: Output in JSON format. Same as `--format json`.

CSV columns: `id`, `date`, `account`, `type`, `state`, `amount`, `currency`, `original_amount`, `original_currency`, `merchant`, `city`, `country`, `mcc`, `category`, `card_last4`. Transactions carry no counterparty or payment reference, so transfers show only amount, date and account.

### `transactions:summary`

Sum up transactions per group, separately per currency (amounts in different currencies are never added). Counts `completed` transactions; `--include-pending` adds `pending` ones, `declined` never count. Groups are sorted by money spent, largest first.

```bash
vivid transactions:summary [options]
```

Columns:

- `OUT`: money spent — card payments, ATM withdrawals, fees and other debits.
- `REFUNDS`: card refunds, kept apart so `OUT` stays what was charged; grouped by merchant they net against the merchant's payments in `NET`.
- `IN`: other credits.
- `TRANSFERS`: transfers and exchanges, which move money rather than spend it; never part of `OUT` or `IN`.
- `NET`: the sum of all of them.

The table ends with a `TOTAL` row per currency. `category` groups merchant category codes (MCC) into about 20 coarse groups such as `Software & IT` or `Travel`; unknown codes show as `MCC 1234`, records without a merchant as their type, e.g. `(transfer)`.

**Options:**

- `--by`: What to group by: `merchant` (default), `category`, `card`, `account`, `type` or `month`.
- `--include-pending`: Also count pending transactions, whose amount may still change.
- `--account`: Only transactions of this account, by ID or name. Repeat it or pass a comma-separated list. Cannot be combined with `--account-type`.
- `--account-type`: Only transactions of accounts of this type: `current` or `other`. Repeat it or pass a comma-separated list. Note: the live API currently answers this filter with `500 internal_error`; prefer `--account`. Without `--account` and `--account-type`, every visible account is queried by ID.
- `--type`: Only transactions of this type: `card_payment`, `card_refund`, `atm`, `transfer`, `exchange`, `fee` or `other`. Repeat it or pass a comma-separated list.
- `--since` / `--until` / `--month`: Only transactions that happened in this period; see [Dates and periods](#dates-and-periods).
- `--card`: Only transactions made with this card, by ID, name or last four digits. Four digits need no extra request.
- `--merchant`: Only transactions whose merchant name contains this text (case-insensitive).
- `--local`: Read from the [local database](#local-database) instead of the API.
- `--format`: Output format: `table` (default), `json` or `csv`.
- `--csv-locale`: CSV dialect: `en` (comma, `1234.56`, default) or `de` (semicolon, `1234,56`, with a byte order mark for Excel).
- `--json`: Output in JSON format. Same as `--format json`.

### `transactions:watch`

Watch for new and changed transactions and print them as they appear, until Ctrl+C. Only changes made after the start are shown; a pending payment that settles shows as `UPDATED … (pending → completed)`.

```bash
vivid transactions:watch [options]
```

Each check asks only for records changed since the previous one, so it costs one request per check. The API allows 60 requests per minute per key and 120 per company, so the interval is at least 30 seconds.

**Options:**

- `--account`: Only watch this account, by ID or name. Repeat it or pass a comma-separated list. Defaults to every visible payment account.
- `--type`: Only watch transactions of this type, e.g. `card_payment`. Repeat it or pass a comma-separated list.
- `--interval`: Seconds between checks. Defaults to `60`, at least `30`.
- `--save`: Also save every record seen to the local database.
- `--json`: Print one JSON object per line: `{"event":"new"|"updated","transaction":{…}}`.

### `db:sync`

Copy accounts, cards and transactions into the [local database](#local-database). The first run fetches the last 90 days; later runs fetch only what changed (one request for accounts, one per 500 cards and one per 500 changed transactions). Cards are skipped when the key has no `cards:read` permission.

```bash
vivid db:sync [options]
```

**Options:**

- `--json`: Output in JSON format: path, counts, number of requests, and `gap` when the previous sync is older than the 90-day window.

### `db:info`

Show where the local database is, how many accounts, cards and transactions it holds, the oldest and newest payment, from when on it is complete, and when it was last synced. Makes no request.

```bash
vivid db:info [options]
```

**Options:**

- `--json`: Output in JSON format.

## License

See [LICENSE](https://github.com/mi-skam/vivid/blob/main/LICENSE).

[^1]: This project is not affiliated with, endorsed by, sponsored by, or approved by Vivid Money GmbH or any of their affiliates or subsidiaries.
