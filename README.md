# helpers4 release

Releases a TypeScript, Rust or mixed repository in one step: version from Conventional Commits,
changelog, release commit on `main`, tag, GitHub Release, and publication to **npm**,
**crates.io** and **JSR** with each registry's own tool and OIDC trusted publishing.

```text
your checks ──► prepare ──► verify ──► commit ──► publish ──► finalize
                version,     build +    signed     npm,        GitHub
                changelog,   dry-run    commit on  cargo,      Release
                @since       of each    main, tag  jsr
                             registry
```

Nothing is written before every build and every registry dry-run has passed. Running the release
again finishes what is missing.

With `dry-run: true` the release does everything but write: the job summary (and the log) tells the
version and why, what each registry's dry-run checked, the files the release commit would write and
the Release notes.

## Quick start

```yaml
# .github/workflows/release.yml
name: Release

on:
  workflow_dispatch:
    inputs:
      bump:
        type: choice
        default: auto
        options: [auto, patch, minor, major, alpha, beta, rc, resume]
      dry-run:
        type: boolean
        default: false

permissions: {}

jobs:
  checks:
    uses: ./.github/workflows/ci.yml        # your blockers (add `on: workflow_call:` to it)
    permissions: { contents: read }

  release:
    needs: checks
    runs-on: ubuntu-latest
    environment: release                    # the one declared to the trusted publishers
    permissions: { contents: write, id-token: write }
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0, persist-credentials: false }
      - uses: actions/setup-node@v7           # and your usual setup: pnpm, Rust, wasm-bindgen…
        with: { node-version: 24 }
      - uses: helpers4/action-release@v0
        with:
          bump: ${{ inputs.bump }}
          dry-run: ${{ inputs.dry-run }}
          app-id: ${{ vars.HELPERS4_BOT_ID }}
          app-key: ${{ secrets.HELPERS4_BOT_KEY }}
```

### One-time setup

1. **A GitHub App** that may push to the protected branch: install
   [helpers4-bot](https://github.com/apps/helpers4-bot) (or your own App with *Contents: read and
   write*), add it as a bypass actor of the ruleset of `main`, and store its client ID and private
   key as `HELPERS4_BOT_ID` (variable) and `HELPERS4_BOT_KEY` (secret).
2. **Trusted publishers**, one per registry, all pointing at this repository, the workflow file
   `release.yml` and the `release` environment:
   - npm: package settings → *Trusted publisher* (the package must already exist);
   - crates.io: crate settings → *Trusted Publishing* (the crate must already exist);
   - JSR: package settings → link the GitHub repository.
3. **Only one protection on the branch, or the App allowed in each.** A classic branch protection
   (Settings → Branches) works next to the rulesets and is not lifted by their bypass list; GitHub's
   branch API reports `protected: true` for both. Delete the classic one or let the App bypass it too.
4. Optional: enable *immutable releases* (Settings → General → Releases).

## What a release does

1. **prepare**
   - **Version**: from the last `v*` tag in the history of the branch (or on a release commit whose
     parent is in it, as action-release 0.1.x made them) and the Conventional Commits since then: breaking change → major, `feat` → minor, otherwise patch. Before 1.0.0 everything
     shifts down: breaking → minor, `feat` → patch. `bump` forces a level, or a prerelease
     (`alpha`, `beta`, `rc`), numbered from `.0`. With no tag yet, the version of the manifest is the
     base.
   - **Manifests**: the version is written in `package.json`, `Cargo.toml` (and `Cargo.lock`, with
     `cargo update --workspace`; the requirements between crates released together follow), `jsr.json` / `deno.json`, and the `version-files`.
   - **Changelog**: the human summary written under `## [Unreleased]` of `CHANGELOG.md` becomes the
     top of the new `## [X.Y.Z] - date` section, followed by the list generated from the commits by
     [git-cliff](https://git-cliff.org) (your `cliff.toml` if any). An empty `[Unreleased]` stays on
     top for the next release. The Release notes are the same text.
   - **`@since next`** becomes `@since X.Y.Z` in the tracked sources (a prerelease keeps it: `next` is the next stable release), and `"next"` values of the
     JSON maps listed in `since.json` (such as `api-since.json`) become the version.
2. **verify**: your build, then `npm publish --dry-run` (on the tarball packed by your package
   manager), `cargo publish --dry-run`, `jsr publish --dry-run`. Also checked: the OIDC permission,
   npm 11.5.1 or later, the App inputs.
3. **commit**: the App's token is created only now, for this repository. One signed commit
   `chore(release): 🔖 vX.Y.Z` through the API, on top of the tested commit; the branch moves only as
   a fast-forward, so if someone pushed meanwhile, the release stops without writing anything.
   Then the tag, and a draft Release.
4. **publish**: `npm publish`, `cargo publish`, `jsr publish`, with OIDC. A registry that already
   serves the version is skipped.
5. **finalize**: the Release is published; the job summary lists the links.

## Inputs and outputs

Everything is an input of the step: no configuration file.

| Input | Default | Meaning |
| --- | --- | --- |
| `bump` | `auto` | `auto`, `patch`, `minor`, `major`, `alpha`, `beta`, `rc` or `resume` |
| `dry-run` | `false` | Prepare and verify everything, write nothing |
| `app-id` / `app-key` | – | Client ID and private key of the App that pushes to the branch |
| `targets` | detected | What is published, in this order (YAML list, see below) |
| `version-files` | – | Manifests that carry the version without being published (one per line) |
| `changelog` | `CHANGELOG.md` | Changelog file |
| `since-marker` | `next` | `@since next` |
| `since-files` | every tracked `.ts`, `.js`, `.rs`… file | Globs of the files whose `@since` markers get the version; `""` for none |
| `since-json` | – | JSON maps whose `"next"` values get the version, such as `api-since.json` |
| `floating-major` | `false` | `true` for a GitHub Action: move `v1` to each stable release |
| `publish-release` | `true` | `false` leaves the Release as a draft, to edit and publish by hand (see below) |
| `github-token` | `github.token` | Token for the GitHub Release |

Outputs: `version`, `tag`, `release-url`.

**Publishing a GitHub Action to the Marketplace.** The box *Publish this Action to the GitHub Marketplace* and the
categories are only in the form of the Release on github.com (not in the API, not in `action.yml`), and an immutable Release
can no longer be edited once published. With `publish-release: false` the release does everything else and leaves the Release as a
draft: edit it on github.com (tick the box, pick the categories), then publish it. The commit, the tag and the packages are
already done; `bump: resume` leaves the draft alone too while the input stays `false`.

Without `targets`, the root `package.json` (unless private), `Cargo.toml` (unless `publish = false`)
and `jsr.json` / `deno.json` are released. Otherwise:

```yaml
      - uses: helpers4/action-release@v0
        with:
          # …
          targets: |
            - npm: packages/folioscope
              build: pnpm --filter folioscope build:wasm && pnpm --filter folioscope build
            - crates: .                         # a workspace: every crate that may be published
            - jsr: .
```

`crates: .` on a workspace publishes all its crates that do not have `publish = false`; `crates: crates/core`
publishes one. The crates of a workspace go to a single `cargo publish`, which orders them by their
dependencies and checks each one, so the later ones need no earlier version on crates.io. The release writes
the version in `[workspace.package]` and in the `version` of the `{ path = "…", version = "…" }` dependencies
between them (one-line tables). A `build` on a workspace runs once.

**Order of the first release of a project** (npm, crates.io and JSR together): the trusted publishers can only be set on a package
that exists, so a package or crate new to its registry needs a first version published by hand (or, for JSR, the package created in
its scope) before it can be linked to this repository and workflow. Do that for every target, then run the release: `verify`
stops before writing anything on an npm package it does not find. Each registry must name the same workflow file and environment.

**Packages the build generates.** `npm: build/*` stands for every `build/<package>/package.json` that
the `build` command writes (a multi-package library with one version). They are not known before the
build: `verify` runs it once, lists the packages (the private ones are skipped), then dry-runs and publishes
them. A package that depends on another one of the release goes after it (a bundle after its categories).
The release does not write their version: the build takes it from the root `package.json`, which you list
in `version-files`, and the release refuses to publish a package that carries another one.

```yaml
          version-files: package.json
          targets: |
            - npm: build/*
              build: pnpm build && pnpm coherency
```

Without `build`, an npm package runs its `build` script with your package manager; crates and JSR
packages are built by their own dry-run.

## Failures and resuming

- Before the commit (build, dry-run, preflight, branch moved): nothing was written. Fix, run again.
- After the commit: the version is on `main` and tagged. Fix the cause (a trusted publisher, for
  instance) and *Re-run failed jobs*, or run with `bump: resume`: only what is missing is published,
  then the Release.
- A published version is never replaced: fix forward with the next one.

Every message is explained in [docs/troubleshooting.md](docs/troubleshooting.md).

## Examples

- **mozlz4** (TS library, npm + JSR): no input to add if `jsr.json` sits next to `package.json`;
  the hand-written `[Unreleased]` notes become the summary of each release.
- **folioscope** (pnpm monorepo, Rust → WebAssembly → npm): the release job sets up Rust and
  `wasm-bindgen`, then `targets` with `npm: packages/folioscope` and its build.
- **helpers4/typescript** (30 npm packages built from one source, one version): `npm: build/*` above.
- **helpers4/rust** (crate): no target to configure; `since-json: api-since.json`.

## Requirements and limits

- Node 22.18 or later on the runner (the action runs its TypeScript with Node itself).
- GitHub-hosted runners: trusted publishing does not support self-hosted ones.
- One version for the whole repository.
- Only `dir/*` patterns (npm); the packages must exist after the build.
- npm refuses for good a version that was published and then unpublished: the release stops before writing.
- npm and crates.io accept a trusted publisher only for an existing package: publish the first
  version by hand. An npm package that does not exist yet stops the release before it writes anything.

## License

LGPL-3.0-or-later.
