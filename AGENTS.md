# AGENTS.md — action-release

Inherits the org-wide rules from [helpers4/.dev AGENTS.md](https://github.com/helpers4/.dev/blob/main/AGENTS.md)
(English only, LGPL-3.0-or-later header on every source file, commit format, scopes from `scopes.json`).

Versions 0.1.x were a different design (release commit on no branch, npm only). Nothing of it is
kept; this code starts at 0.2.0.

## What the action does

One `uses: helpers4/action-release@v0` step, in the release job of the project, after the
project's own setup steps. In order:

1. **prepare**: compute the next version (last `v*` tag, Conventional Commits, `bump`), write it in
   the manifests, update `CHANGELOG.md` (`[Unreleased]` + generated list) and the `@since` markers.
2. **verify**: build and dry-run every target with its standard tool.
3. **commit**: signed commit through the API with the token of a GitHub App (the only actor
   allowed to bypass the branch protection), fast-forward of the branch, tag, draft Release.
4. **publish**: `npm publish`, `cargo publish`, `jsr publish`, with OIDC trusted publishing; a target
   that already serves the version is skipped.
5. **finalize**: publish the Release (human summary + generated list).

Running it again resumes: what is already done is skipped.

## Layout

- `action.yml` — composite action; each step runs `node src/main.ts <step>`
- `src/install.sh` — checks Node and installs the runtime dependencies (`npm ci --omit=dev`)
- `src/steps/` — one file per step (`prepare`, `verify`, `commit`, `publish`, `finalize`); they
  share `plan.json` in `$RUNNER_TEMP/h4-release`
- `src/lib/` — `version`, `changelog` (git-cliff + `[Unreleased]`), `manifests`, `since`, `config`,
  `registries` (npm, cargo, jsr commands and lookups), `github` (the `Gh` interface over the REST API)
- `docs/troubleshooting.md` — one section per message; keep it in step with the errors
- `test/` — vitest; real temporary git repositories, `FakeGh` and a fake registry
- `.github/workflows/release.yml` — this action releases itself with `uses: ./` (no registry,
  `floating-major: true` moves `v0`, `since-files: ""` keeps the `@since next` examples)
- No configuration file: everything is an input of the action (`action.yml` → `INPUT_*` →
  `src/lib/config.ts`)

## Rules specific to this repo

- Erasable TypeScript only (`erasableSyntaxOnly`): no `enum`, no `namespace`, no parameter
  properties. Relative imports end with `.ts`.
- npm (not pnpm) for this repository: the action installs its dependencies at run time with
  `npm ci`, and npm is the only package manager every runner has.
- Use each ecosystem's standard tool (`npm`/`pnpm`, `cargo`, `jsr`); never re-implement what they do.
- Prefer the `helpers4` package (`helpers4/commit`, `helpers4/version` …) over new code.
- Third-party actions are pinned by commit SHA.
- GitHub calls go through the `Gh` interface; the registries' lookups take an injectable `fetch`.
- Never publish to a registry for real without the maintainer's agreement. End-to-end runs use
  the sandbox repository `helpers4/test-action-release-public` (its `release.yml` calls the branch
  under test; `release-all.yml` dry-runs npm, crates and JSR).

## Commands

```bash
npm ci
npm run typecheck
npm test
```
