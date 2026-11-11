# vivid

[![CI](https://github.com/mi-skam/vivid/actions/workflows/ci.yml/badge.svg)](https://github.com/mi-skam/vivid/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Unofficial Node.js SDK and CLI for the [Vivid Business](https://vivid.money/en-eu/business/) API.[^1]

## Packages

| Package                                  | Description                                                   |
| ---------------------------------------- | ------------------------------------------------------------- |
| [`@genz-its/vivid-sdk`](./packages/sdk/) | Unofficial Node.js SDK for the Vivid Business API.            |
| [`@genz-its/vivid-cli`](./packages/cli/) | Unofficial command-line interface for the Vivid Business API. |

## Features

- **Read your Vivid Business data**: accounts and balances, transactions of the last 90 days, and cards with their limits.
- **Safe by design**: Vivid API v1 is read-only — nothing it offers can move money or change the account.
- **Scriptable CLI**: `--json` on every command, non-interactive mode, exit codes `0`/`1`, and cursor pagination handled for you.
- **Zero-dependency SDK**: native `fetch`, hand-written types, retries with backoff.

## Getting started

Node.js 22 or later and a Vivid Business API key are required. Create a key in Vivid Business on the web under **API > Add API token** and tick the permissions you need (`accounts:read`, `transactions:read`, `cards:read`).

```bash
npm install -g @genz-its/vivid-cli

vivid login
vivid doctor
vivid accounts:list
vivid transactions:list --state completed --limit 20
```

### Run from source

```bash
git clone https://github.com/mi-skam/vivid.git
cd vivid
npm ci
npm run build

node packages/cli/dist/index.js --help
```

Use `vivid login` to store the key, or supply `VIVID_API_KEY` through your environment. Never commit credentials. There is no sandbox: every call reads live data.

See the [SDK documentation](./packages/sdk/README.md) and the [CLI command reference](./packages/cli/README.md) for details.

## Development

```bash
npm ci
npm run build
npm run lint
npm run typecheck
npm test
```

Unit tests mock `fetch` and never reach the API. CI runs on Node.js 22 and 24.

### Releases

release-please (with the `node-workspace` plugin) opens release PRs from conventional commits and publishes to npm via OIDC trusted publishing when one is merged. Pushing a `vX.Y.Z` tag additionally builds, verifies and attaches tarballs plus `SHA256SUMS` to a GitHub release; add `docs/releases/vX.Y.Z.md` first. To build and verify the tarballs locally after `npm run build`:

```bash
npm run release:pack
npm run release:verify
```

Artifacts are written to the ignored `release-artifacts/`. Verification installs into temporary directories and runs offline smoke tests only; it never calls the Vivid API.

The [Vivid Business API specification](https://api.prime.vivid.money/sme-integration/docs/api.json) serves as a local development reference:

```bash
curl -fsSL https://api.prime.vivid.money/sme-integration/docs/api.json -o api.json
```

## License

See [LICENSE](./LICENSE).

[^1]: This project is not affiliated with, endorsed by, sponsored by, or approved by Vivid Money GmbH or any of their affiliates or subsidiaries.
