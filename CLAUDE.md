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

## Fork UI reskin (`theme-modern.css` + editor-page work)

This fork restyles the UI on top of Stylus's design tokens. Key facts:

- **`src/css/theme-modern.css`** is the reskin (control styling, radii, accent, gray ramp,
  shadows). It is **not global** — each page entry imports it **last** so it wins the cascade.
  It's imported in `manage/index.js`, `popup/index.js`, `options/index.js`, **and**
  `edit/index.js` (added by this fork — the editor page looked unstyled before). If you create
  a new page, import it last there too.
- **Icon font** (`src/css/icons.woff2`) is generated from `src/icons/*.svg` by
  `tools/build-icons.mjs` (`pnpm build-icons`), which also rewrites the AUTO-GENERATED-ICON
  block + `unicode-range` in `global.css`. Each SVG's `id="<char>"` attribute is its codepoint.
  **Gotcha:** the builder (`svgicons2svgfont`) ignores `fill-rule="evenodd"`, so icons with a
  punched-out hole (e.g. Heroicons cogs) render as a solid blob — reverse the inner subpath's
  winding so the hole cuts out under nonzero winding. Custom glyphs added: `code.svg` (`‹`,
  `.i-code`, `</>`), `brush.svg` (`✒`, `.i-brush`). Rebuild + reload the unpacked dist to see
  font changes; the committed woff2 can be stale vs the SVGs.

### Editor page (`src/edit/`) layout specifics

- **Desktop sidebar** (`edit/css/header.css`): the collapsible panels (`#details-wrapper >
  details`) are styled as Figma-style rows (hidden native marker, full-row click target,
  right-side chevron via `summary::after`, border-top dividers). `#basic-info` is a column
  "app bar" (`#basic-info-toprow` = back + title + info/code/error icons, full-bleed with a
  bottom border). `#details-wrapper` is the single scroll container (`overflow-y:auto`) so the
  last panel never clips.
- **Compact/mobile** (`@media max-width:850px` in `edit/css/compact.css`): the panels become
  horizontal **icon tabs** (glyph from `data-icon="<char>"` on each summary `h2`, rendered via
  `[data-icon]::after`). The wide-layout Figma styles are written **unscoped** in header.css,
  so compact.css must **undo** them (chevron `content:none`, no border-top, `#basic-info` back
  to a row, etc.). Always re-check compact.css when changing header.css panel/app-bar styles.
- **Compact popup positioning is JS-driven** (`edit/compact-header.js` →
  `positionCompactPopup`): on open/resize it centers each tab's popup under its icon and clamps
  it to the viewport via a `--popup-left` CSS var (pure CSS can't measure per-tab overflow).
  Same file: outside-click / Escape close the open popup; clicking inside keeps it open.
- **Compact panels are an accordion**: `src/js/dom-prefs.js` `saveOnChange` closes sibling
  `<details>` in `#details-wrapper` when one opens, **only** when `$root` has `.compact-layout`
  (toggled by `src/js/dom-init.js`). Wide layout keeps independent open panels.
- **Verifying editor UI**: it's a browser-extension page needing runtime data/fonts, so a
  static HTML preview can't paint icon-font glyphs or run the positioning/accordion JS. Build
  (`pnpm build-chrome-mv3`) and reload the unpacked `dist-chrome-mv3` below 850px to verify
  live; for quick layout checks, render the `<template data-id="body">` from `dist/edit.html`
  with `dist/css/edit.css` and measure geometry (glyphs/JS won't run).

## Custom feature: `direction: bidi` (auto RTL/LTR detection)

This fork adds a non-standard CSS value, `direction: bidi`, usable in any style section:

```css
.chat .message-bubble { direction: bidi; }
```

The browser ignores the invalid declaration; instead the content script detects it and sets
`dir="rtl"` or `dir="ltr"` on each matching element based on its first strong directional
character (Arabic/Persian/Hebrew/etc. → RTL). Works on dynamically added elements
(e.g. incoming chat messages) via a MutationObserver. Scoped per style/section since the
directive lives in the style's own CSS text.

Implementation:
- `src/content/auto-dir.js` — parses applied section CSS for `direction: bidi` selectors,
  runs the MutationObserver, applies/removes `dir` per element. Wired from
  `src/content/apply.js` on style apply/update/removal.
- Linter acceptance: `bidi` was added to the `direction` property's allowed values in the
  `csslint-mod` dependency via a pnpm patch (`patches/csslint-mod*.patch`,
  `pnpm.patchedDependencies` in `package.json`) so the editor doesn't flag it.
  Note: the Stylelint linter option (if selected in editor settings) may still flag it.

## Code discovery

This repo is indexed with `codebase-memory-mcp`. Prefer `search_graph`, `trace_path`, `get_code_snippet`, and `search_code` over ad hoc grepping for structural questions (call chains, dependents, architecture). Use plain Grep/Glob for text/config/non-code lookups.
