# Changelog

## [0.3.0](https://github.com/mi-skam/vivid/compare/v0.2.0...v0.3.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* **cli:** in transactions:summary, transfers to and from other banks moved from the transfers column to in and out; transfers now holds only movements between own accounts and exchanges. net is unchanged.

### Features

* **cli:** add an MCP server (vivid mcp) ([#19](https://github.com/mi-skam/vivid/issues/19)) ([fadca8e](https://github.com/mi-skam/vivid/commit/fadca8ea23b39c040d8d52a42637013dd74f3912))
* **cli:** count transfers with other banks as money in and out in summaries ([#16](https://github.com/mi-skam/vivid/issues/16)) ([1b94a36](https://github.com/mi-skam/vivid/commit/1b94a3626d9b0991602fb7f5a125689a8cfd69ba))
* **cli:** keep a change log of transaction versions in the local database ([#14](https://github.com/mi-skam/vivid/issues/14)) ([9780d67](https://github.com/mi-skam/vivid/commit/9780d67cf0d93253cf0d138e93050b6d38498e20))


### Bug Fixes

* **cli:** align table columns after wide characters ([#15](https://github.com/mi-skam/vivid/issues/15)) ([907763f](https://github.com/mi-skam/vivid/commit/907763fdc7be8fae0f8bfa006fe52953f8f2a2ab))

## [0.2.0](https://github.com/mi-skam/vivid/compare/v0.1.0...v0.2.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **cli:** the CLI now requires Node.js 22.13 or later for the built-in node:sqlite module. The SDK still supports Node.js 22.

### Features

* **cli:** add summaries, CSV export, watch, ping and a local transaction database ([c85fd57](https://github.com/mi-skam/vivid/commit/c85fd5743fbeed21ed24b70f765173857622273d))

## 0.1.0 (2026-11-11)


### Features

* add Vivid Business API SDK and CLI ([a7ef243](https://github.com/mi-skam/vivid/commit/a7ef243451cf608088c852ed92ef8d3b28039f06))
