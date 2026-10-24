# AGENTS.md — action-release

Inherits the org-wide rules from [helpers4/.dev AGENTS.md](https://github.com/helpers4/.dev/blob/main/AGENTS.md)
(English only, LGPL-3.0-or-later header on every source file, commit format, scopes from `scopes.json`).

## Layout

- `action.yml` — action manifest (`runs.using: node26`, entry `dist/index.mjs`)
- `src/main.ts` — dispatches on the `mode` input (`build`, `publish`, `check`)
- `src/modes/` — one file per mode
- `scripts/build.mjs` — esbuild bundle into `dist/`
- `test/` — vitest

## Rules specific to this repo

- `dist/` is never committed on `main`: it only exists in release tags, added by `include-build`.
- The `publish` mode never runs project code (no install, no scripts).
- A release never rewrites a file a human wrote, except the version placeholder.
- Third-party actions are pinned by commit SHA.

## Commands

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```
