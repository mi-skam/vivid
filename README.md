# vivid

[![CI](https://github.com/mi-skam/vivid/actions/workflows/ci.yml/badge.svg)](https://github.com/mi-skam/vivid/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Unofficial Node.js SDK and CLI for the [Vivid Business](https://vivid.money/en-eu/business/) API.[^1]

## Packages

| Package                                 | Description                                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| [`@mi-skam/vivid-sdk`](./packages/sdk/) | Unofficial Node.js SDK for the Vivid Business API.            |
| [`@mi-skam/vivid`](./packages/cli/)     | Unofficial command-line interface for the Vivid Business API. |

## Features

- **Read your Vivid Business data**: accounts and balances, transactions of the last 90 days, and cards with their limits.
- **Safe by design**: Vivid API v1 is read-only — nothing it offers can move money or change the account.
- **Scriptable CLI**: `--json` on every command, non-interactive mode, exit codes `0`/`1`, and cursor pagination handled for you.
- **Insights and export**: filter by payment date, card or merchant; spending summaries per merchant, category, card or month; CSV for Excel; live watch of new transactions.
- **History beyond 90 days**: `vivid db:sync` keeps every transaction in a local SQLite database that list and summary commands can read without a request.
- **MCP server**: `vivid mcp` offers the read commands as tools to Claude Code and other MCP clients.
- **Zero-dependency SDK**: native `fetch`, hand-written types, retries with backoff.

## Getting started

Node.js 22.13 or later (the SDK alone: 22) and a Vivid Business API key are required. Create a key in Vivid Business on the web under **API > Add API token** and tick the permissions you need (`accounts:read`, `transactions:read`, `cards:read`).

Install the CLI from a GitHub release (not published to npm; see [`packages/cli`](./packages/cli/#installation) for building from source):

```bash
gh release download vX.Y.Z --repo mi-skam/vivid --pattern 'vivid-cli-*.tgz'
npm install -g ./vivid-cli-X.Y.Z.tgz

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

Releases are GitHub releases only; nothing is published to npm. Both packages always share one version, tagged `vX.Y.Z`. Shipping a release takes one manual step: either merge a PR that carries the `release` label, or merge the release PR.

1. **Use conventional commit prefixes.** When squash-merging, the PR title becomes the commit message, so give the title the prefix. While the version is below 1.0:

   | Prefix                                         | Example                          | Effect (from 0.1.0) |
   | ---------------------------------------------- | -------------------------------- | ------------------- |
   | `fix:`                                         | `fix: handle empty card list`    | 0.1.1               |
   | `feat:`                                        | `feat: add cards:freeze command` | 0.1.1               |
   | `feat!:` or `BREAKING CHANGE:` in the body     | `feat!: rename --account option` | 0.2.0               |
   | `chore:`, `ci:`, `docs:`, `test:`, `refactor:` | `docs: fix README typo`          | no release          |

2. **release-please opens a release PR (automatic).** After each push to `main`, the Release workflow opens or updates a `chore: release X.Y.Z` PR if there are `fix:` or `feat:` commits since the last release. It bumps both package versions, the CLI's pinned SDK version and the lockfile, and updates `CHANGELOG.md`. Don't edit it; it keeps updating itself.

3. **Approve the release, on the PR you are merging or later.**
   - **Right away:** add the `release` label to the PR before merging it (in the PR sidebar, or `gh pr edit <number> --add-label release`). When it is merged, the Release workflow merges the release PR itself and continues with step 4. Without `fix:` or `feat:` commits there is nothing to release, and the run says so.
   - **Later:** merge without the label; changes collect in the release PR. Merge that one when you want to ship. Use merge or squash, never rebase:

     ```bash
     gh pr list
     gh pr merge <number> --merge
     ```

   In the labelled flow the workflow waits for the release PR's CI to pass before merging it; if it fails, merge the release PR by hand once it is green.

4. **The release is created (automatic, about 2–3 minutes).** The Release workflow tags `vX.Y.Z` and creates the GitHub release with the changelog as notes. It then calls `.github/workflows/github-release.yml`, which builds, lints, typechecks and tests the tag, packs the tarballs, verifies that they install and run, and attaches `vivid-sdk-X.Y.Z.tgz`, `vivid-cli-X.Y.Z.tgz` and `SHA256SUMS`.

5. **Check it worked.** The Release run should be green and the release should list three assets:

   ```bash
   gh run list --limit 3
   gh release view vX.Y.Z
   ```

To install a release, see [Getting started](#getting-started).

**If something goes wrong:**

- **The release has no files:** look at the failed run with `gh run view --log-failed`. Fix the problem on `main`, then rebuild and attach the files to the existing release with `gh workflow run github-release.yml -f tag=vX.Y.Z`.
- **No release PR appears:** there are no `fix:` or `feat:` commits since the last release. Check your commit prefixes.

To build and verify the tarballs locally after `npm run build`:

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
