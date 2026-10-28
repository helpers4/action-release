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
- `src/` — the engine, TypeScript run by Node's type stripping (no build, no `dist/`)
- `test/` — vitest

## Rules specific to this repo

- Erasable TypeScript only (`erasableSyntaxOnly`): no `enum`, no `namespace`, no parameter
  properties. Relative imports end with `.ts`.
- npm (not pnpm) for this repository: the action installs its dependencies at run time with
  `npm ci`, and npm is the only package manager every runner has.
- Use each ecosystem's standard tool (`npm`/`pnpm`, `cargo`, `jsr`); never re-implement what they do.
- Prefer the `helpers4` package (`helpers4/commit`, `helpers4/version` …) over new code.
- Third-party actions are pinned by commit SHA.
- Never publish to a registry for real without the maintainer's agreement. End-to-end runs use
  the sandbox repository `helpers4/test-action-release-public`.

## Commands

```bash
npm ci
npm run typecheck
npm test
```
