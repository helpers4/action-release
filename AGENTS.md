# AGENTS.md — action-release

Inherits the org-wide rules from [helpers4/.dev AGENTS.md](https://github.com/helpers4/.dev/blob/main/AGENTS.md)
(English only, LGPL-3.0-or-later header on every source file, commit format, scopes from `scopes.json`).

## Layout

- `action.yml` — action manifest (`runs.using: node24`, entry `dist/index.mjs`)
- `src/main.ts` — dispatches on the `mode` input (`build`, `publish`, `check`)
- `src/modes/` — one file per mode (`build`, `publish`, `check`)
- `src/lib/` — logic: `tags` (last release, range), `version`, `dist-tag`, `registries` (incl. resume plan),
  `changelog` (git-cliff), `build`, `preflight`, `publish`, `github` (the GitHub operations behind one interface)
- `.github/workflows/release.yml` — reusable workflow (level 1); `self-release.yml` releases this action
- `docs/troubleshooting.md` — one section per preflight code; keep in sync with `preflight.ts` and `check.ts`
- `scripts/build.mjs` — esbuild bundle into `dist/`
- `test/` — vitest

## Rules specific to this repo

- `dist/` is never committed on `main`: it only exists in release tags, added by `include-build`.
- The `publish` mode never runs project code (no install, no scripts).
- A release never rewrites a file a human wrote, except the version placeholder.
- Third-party actions are pinned by commit SHA.
- The reusable workflow cannot change in a release commit (GitHub refuses a tag whose workflows match no
  branch head), so it references the action by its floating major tag (`@v0`; change it to `@v1` in a pull
  request before releasing 1.0.0).
- Logic that talks to GitHub goes through the `Gh` interface so tests use the in-memory `FakeGh`.
- Prefer the `helpers4` package (`helpers4/commit`, `helpers4/promise`, `helpers4/version` …) over
  new code, and report missing helpers instead of duplicating them.
- Tests: `pnpm test` runs unit tests and builds real temporary git repositories; it needs no network
  except `npm install --package-lock-only` in the build fixtures. End-to-end runs use the sandbox repository
  `helpers4/test-action-release-public`; never publish to npm for real without the maintainer's agreement.

## Commands

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```
