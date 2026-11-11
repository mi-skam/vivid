# @mi-skam/vivid

Unofficial command-line interface for the [Vivid Business](https://vivid.money/en-eu/business/) API.[^1]

## Features

- 🏦 **Accounts**: List payment accounts with IBAN, state and balances.
- 💳 **Transactions**: List and filter the transactions of the last 90 days, across every page.
- 🪪 **Cards**: List cards and inspect their spending limits.
- 🩺 **Doctor**: Check the key, the connection, and which permissions the key has.
- 🤖 **Automation-friendly**: `--json` output on every command, non-interactive mode, and stable exit codes.

## Requirements

- Node.js 22 or later.
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

# List completed card payments changed since March
vivid transactions:list --type card_payment --state completed --updated-from 2025-03-01
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

- **`--json`**: Every command supports the `--json` flag to output machine-readable JSON, exactly as the API returns it.
- **Non-interactive mode**: When the CLI runs without a TTY or with the `CI` environment variable set, it never prompts. Missing required values cause an error and exit code `1` instead.
- **Exit codes**: `0` on success, `1` on any failure.
- **Read-only**: Vivid API v1 cannot move money or change the account, so every command except `login`/`logout` only reads.

```bash
# Example: total of completed card payments that happened since 1 March 2025
vivid transactions:list --type card_payment --state completed --json \
  | jq -r '[.[] | select(.show_at >= "2025-03-01") | .amount | tonumber] | add'
```

## Commands

- [`login`](#login)
- [`logout`](#logout)
- [`doctor`](#doctor)
- [`accounts:get`](#accountsget)
- [`accounts:list`](#accountslist)
- [`cards:get`](#cardsget)
- [`cards:list`](#cardslist)
- [`transactions:get`](#transactionsget)
- [`transactions:list`](#transactionslist)

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

List your payment accounts with name, IBAN, currency, state, and available and pending balance. Balances are empty when the key's issuer may not see them.

```bash
vivid accounts:list [options]
```

**Options:**

- `--include-closed`: Include closed accounts. Defaults to open accounts only.
- `--json`: Output in JSON format.

### `cards:get`

Show a single card and its limits.

```bash
vivid cards:get [id-name-or-last4] [options]
```

**Argument:** `id` — The card ID (UUID). If omitted, you will be prompted.

**Options:**

- `--json`: Output in JSON format.

### `cards:list`

List your cards. Closed cards are never returned.

```bash
vivid cards:list [options]
```

**Options:**

- `--limit`: The maximum number of cards to return. Defaults to all of them.
- `--json`: Output in JSON format.

### `transactions:get`

Show a single transaction. Transactions older than 90 days are not available.

```bash
vivid transactions:get [id] [options]
```

**Argument:** `id` — The transaction ID (UUID). If omitted, you will be prompted.

**Options:**

- `--json`: Output in JSON format.

### `transactions:list`

List transactions of the last 90 days, newest first, with date (`show_at`), amount, original amount when made in another currency, merchant, type and state. Pages through all results.

```bash
vivid transactions:list [options]
```

**Options:**

- `--account`: Only show transactions of this account, by ID or name. Repeat it or pass a comma-separated list. Cannot be combined with `--account-type`.
- `--account-type`: Only show transactions of accounts of this type: `current` or `other`. Repeat it or pass a comma-separated list. Note: the live API currently answers this filter with `500 internal_error`; prefer `--account`. Without `--account` and `--account-type`, every visible account is queried by ID.
- `--type`: Only show transactions of this type: `card_payment`, `card_refund`, `atm`, `transfer`, `exchange`, `fee` or `other`. Repeat it or pass a comma-separated list.
- `--state`: Only show transactions in this state: `pending`, `completed` or `declined`.
- `--updated-from`: Only show transactions changed at or after this moment (RFC 3339, or `YYYY-MM-DD` for midnight UTC).
- `--updated-to`: Only show transactions changed before this moment (RFC 3339, or `YYYY-MM-DD` for midnight UTC).
- `--limit`: The maximum number of transactions to return. Defaults to all of them.
- `--json`: Output in JSON format.

## License

See [LICENSE](https://github.com/mi-skam/vivid/blob/main/LICENSE).

[^1]: This project is not affiliated with, endorsed by, sponsored by, or approved by Vivid Money GmbH or any of their affiliates or subsidiaries.
