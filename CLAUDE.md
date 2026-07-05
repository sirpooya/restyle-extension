# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project overview

This is **Restyle** (a fork of the Stylus browser extension, repo name `restyle-extension`), a browser extension for managing user CSS styles/themes. It supports Chrome (MV2/MV3), Firefox, and Chromium-based browsers. Users can write/install CSS, LESS, or Stylus-syntax themes for websites, with a built-in linting editor, cloud sync (Dropbox/GDrive/OneDrive/WebDAV), and style galleries (USW, USO archive, Greasy Fork).

- License: GPL-3.0-only
- Package manager: **pnpm only** (enforced via `preinstall: only-allow pnpm`)
- Node: `>=24`
- Upstream project: `openstyles/stylus`; this fork's origin is `sirpooya/restyle-extension`

## Build & dev commands

| Purpose | Command |
|---|---|
| Install deps | `pnpm i` |
| Lint | `pnpm lint` |
| Test (lint + csslint) | `pnpm test` |
| Build MV2 (any browser) | `pnpm build-mv2` |
| Build MV2 Firefox | `pnpm build-firefox` |
| Build MV3 Chrome/Chromium | `pnpm build-chrome-mv3` |
| Watch MV2 | `pnpm watch-mv2` |
| Watch MV3 | `pnpm watch-mv3` |
| Watch MV3 with HMR | `pnpm watch-mv3-hmr` |
| Zip for store submission | `pnpm zip` |

Build output goes to `dist*/` folders (not cleared automatically between builds — e.g. `dist-chrome-mv3/`). Bundler is Webpack (`webpack.config.js`), configured per-target via `--config-node-env <name>` (`any-mv2`, `chrome-mv3`, `firefox`).

`postinstall` runs `tools/build-cm-css-data.js` (generates CodeMirror CSS data) — required after fresh installs.

## Source layout (`src/`)

- `background/` — MV2/MV3 background/service-worker logic: style storage (`db.js`), sync (`sync-manager.js`, `db-to-cloud-broker.js`), style application (`style-via-api.js`, `style-via-webrequest.js`), usercss install/update, USO/USW API clients, icon/badge management, prefs.
- `manage/` — the style manager UI (list/search/filter/sort styles, import/export, bulk actions). Entry: `manage/index.js`.
- `edit/` — the style editor UI (CodeMirror-based, linting via Stylelint/CSSLint-mod, LESS/Stylus preprocessing, live preview, usercss metadata editing).
- `popup/` — the browser-action popup (per-tab style list, search, quick toggle).
- `options/` — the extension options/settings page.
- `sidepanel/` — Chrome side panel UI.
- `install-usercss/` — the usercss installation confirmation page.
- `content/` — content scripts injected into pages.
- `offscreen/` — MV3 offscreen document (for APIs unavailable to service workers).
- `js/` — shared utilities: messaging (`msg.js`, `msg-api.js`, `port.js`), prefs, DOM helpers, color utils, localization, `worker/` (web workers).
- `cm/` — CodeMirror integration/config.
- `css/` — shared/global stylesheets.
- `icon/`, `icons/` — icon assets and generation.
- `vendor-overwrites/` — patched third-party libraries (excluded from lint; see licenses within).
- `_locales/` — i18n message bundles (managed via Transifex, see below).
- `manifest*.json` — MV2/MV3/Firefox manifest variants, merged/patched at build time.

## Translations

Locale files (`messages.json`) live in `src/_locales/` and are synced with Transifex.

- Pull: `pnpm update-locales` (requires Transifex client + `.transifexrc`)
- Push: `pnpm update-transifex`
- Don't hand-edit non-English locale files directly; source-of-truth edits go through Transifex.

## Linting & conventions

- ESLint config: `eslint.config.js` (flat config). `src/vendor/` and `src/vendor-overwrites/` are excluded from linting — never "fix" style in those.
- Path alias: `@/*` maps to `src/*` (see `jsconfig.json`).
- Husky git hooks are installed via `prepare`; don't bypass with `--no-verify` unless explicitly asked.
- `pnpm version`/`pnpm bump`/`pnpm bump-stable` run tests, sync manifest version, and build a zip automatically — treat these as release actions, not routine dev commands.

## Working across MV2/MV3

Logic often needs to work across Manifest V2 and V3 simultaneously (different background execution models: persistent background page vs. service worker vs. offscreen document). When touching `background/`, check whether a change needs to account for both `manifest-mv2*.json` and `manifest-mv3.json` targets, and whether offscreen-document delegation (`offscreen/`) is involved for APIs unavailable in MV3 service workers.

## Code discovery

This repo is indexed with `codebase-memory-mcp`. Prefer `search_graph`, `trace_path`, `get_code_snippet`, and `search_code` over ad hoc grepping for structural questions (call chains, dependents, architecture). Use plain Grep/Glob for text/config/non-code lookups.
