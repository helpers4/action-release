# helpers4 release

Signed releases of JS/TS packages **without a GitHub App, without a secret, and without ever
writing to the release branch**.

A release creates one *release commit* through the GitHub API, on no branch, whose parent is the
tested commit of your branch. It differs from that commit only by the version and the generated
changelog. The tag points at it, the Release is attached to the tag, and the package is published
from the very same tarball that was built, dry-run and attested.

```text
main ── a1b2 ── c3d4 ── e5f6          normal commits
                           \
                            9f8e      release commit: on no branch, parent e5f6
                             ↑          = e5f6 + "version": "1.2.3" + CHANGELOG.md
                           v1.2.3     the tag, and the immutable GitHub Release
```

- **No bypass, no pull request to approve**: the branch is never written, so no branch protection
  applies. Everything uses `GITHUB_TOKEN`.
- **Signed**: the release commit is created by GitHub (`github-actions[bot]`, *Verified*), the
  tarball is attested (SLSA provenance) and npm publishes with OIDC trusted publishing.
- **Safe by construction**: the job that runs your code (install, scripts, build) has
  `contents: read` and nothing else. The job that can write and sign runs none of your code.
- **Recoverable**: the tag is the lock and is created *before* anything is published. If a
  registry fails, run the release again with `bump: resume`: the same tarball is published.

## Quick start (level 1: reusable workflow)

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
    uses: ./.github/workflows/ci.yml        # your own blockers, unchanged
    permissions: { contents: read }

  release:
    needs: checks
    uses: helpers4/action-release/.github/workflows/release.yml@v0
    permissions: { contents: write, id-token: write, attestations: write, issues: write, pull-requests: write }
    with:
      bump: ${{ inputs.bump }}
      dry-run: ${{ inputs.dry-run }}
```

`ci.yml` needs an `on: workflow_call:` trigger to serve as a blocker. Everything else is
detected; the optional inputs only correct the detection.

### One-time setup

1. Keep a placeholder version on your branch: `"version": "0.0.0-development"`. The release
   writes the real version into the release commit only.
2. Publish a first version of the package by hand, then register the trusted publisher on
   npmjs.com (workflow file `release.yml`, and your environment if any). npm can only configure a
   trusted publisher on an existing package, and an unvalidated configuration expires after 48 h,
   so run the first release right away. Remove any `NPM_TOKEN` secret afterwards.
3. Enable *immutable releases* (Settings → General → Releases). Optional, but they make the tag and
   the assets permanent.
4. Do not add a tag ruleset that restricts creations: immutable releases already protect release
   tags.

The release starts from your latest `v*` tag; existing tags remain the base.

## Level 2: the action, in your own jobs

When the build does not fit the reusable workflow (matrix, container, several packages), write the
jobs yourself and call the action twice:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0, persist-credentials: false }
      # … any setup you need (Node, Rust, wasm-bindgen …) …
      - uses: helpers4/action-release@v0
        with: { mode: build, bump: "${{ inputs.bump }}" }

  publish:
    needs: build
    runs-on: ubuntu-latest
    permissions: { contents: write, id-token: write, attestations: write, issues: write, pull-requests: write }
    steps:
      - uses: actions/setup-node@v7
        with: { node-version: lts/* }         # npm 11.5.1 or later
      - uses: helpers4/action-release@v0
        with: { mode: publish, bump: "${{ inputs.bump }}" }
```

The two modes pass the build through an artifact (`h4-release`). A third mode, `check`, runs the
checks that do not depend on the next version: put it in your pull request CI.

## Examples

### mozlz4: a simple library

Before: version written by hand, `NPM_TOKEN` secret, hand-written changelog. After: the workflow
above, and one standard pnpm line in `package.json` instead of `pnpm publish dist`:

```json
"publishConfig": { "directory": "dist" }
```

Detected: pnpm and its version (`packageManager`), Node (`engines`), `pnpm run build` (the script
exists and already copies the version and the changelog into `dist/`).

### folioscope: pnpm monorepo, Rust and WebAssembly

```yaml
  release:
    needs: checks
    uses: helpers4/action-release/.github/workflows/release.yml@v0
    permissions: { contents: write, id-token: write, attestations: write, issues: write, pull-requests: write }
    with:
      bump: ${{ inputs.bump }}
      environment: npm                     # the one of the npm trusted publisher
      package: packages/folioscope
      setup: cargo install wasm-bindgen-cli --version 0.2.129 --locked
      build: pnpm --filter folioscope build:wasm && pnpm --filter folioscope build
```

Explicit because it cannot be guessed: `package` (monorepo), `environment` (declared by the
trusted publisher), `setup` (`wasm-bindgen`), `build` (the root script builds the whole monorepo).

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `mode` | `build` | `build`, `publish` or `check` |
| `bump` | `auto` | `auto`, `patch`, `minor`, `major`, `alpha`, `beta`, `rc` or `resume` |
| `dry-run` | `false` | Run everything up to, and excluding, the tag |
| `package` | repository root | Path of the published package (monorepo) |
| `setup` | – | Shell command run before the build (undetectable tooling) |
| `build` | `<pm> run build` | Build command, if not the `build` script |
| `registries` | `npm` | `npm` or `none` (tag and Release only); `npm?` makes a failure non-blocking |
| `environment` | – | Environment of the npm trusted publisher (reusable workflow) |
| `carry` | `CHANGELOG.md` | Files carried from tag to tag |
| `prepare` | – | Command run with `RELEASE_VERSION`; it may only modify carried files |
| `include-build` | `auto` | Add the build output to the release commit (actions only) |

Outputs: `version`, `tag`, `release-url`, `published` (JSON, per registry).

## What the action computes

**Last release.** Tags are not ancestors of the branch (the release commit is on no branch), so the
action lists the `v*` tags from the highest SemVer and keeps the first whose commit *or its parent*
is an ancestor of `HEAD`. Tags of other lines are ignored, so a `release/1.0.x` branch cut from
`v1.0.0` releases `1.0.1` while `v1.2.3` exists. The commits are `$last..HEAD`.

**Version.** `auto` reads Conventional Commits: `feat!`/`BREAKING CHANGE` is a major, `feat` a minor,
the rest a patch. Before 1.0.0 a `feat` is a patch and a breaking change a minor. Prereleases are
`X.Y.Z-<alpha|beta|rc>.N`, numbered across all tags. With no tag, the base is the version in
`package.json` without its prerelease suffix.

**npm dist-tag.** `latest` only for a stable version not lower than the highest stable one
published. A prerelease uses its identifier (`beta`), and a release of an older line uses
`release-1.0`. The Release is marked *latest* only in the first case.

**Changelog.** Generated by [git-cliff](https://git-cliff.org) over the explicit range, with your
`cliff.toml` if there is one. The full `CHANGELOG.md` is carried from tag to tag: the previous
release's file plus the new section, written into the release commit only.

**Golden rule.** The release never rewrites what a human wrote. It writes the version, the
generated changelog and files you list in `carry`. A `prepare` command that touches anything else
stops the release.

## Order of operations and failures

`version → build → dry-run on each registry → release commit → workflows check → tag (lock) →
attestation → publish → Release → comments`

- Dry-runs run before the tag: a content or configuration problem blocks the release while it is
  still reversible.
- GitHub refuses a tag on a commit whose `.github/workflows` match no branch head. If the branch
  received a workflow change during the release, it stops **before the tag** and asks you to rerun.
- After the tag, a failing required registry leaves a draft Release and the tag. Fix the cause and
  rerun with `bump: resume`: it finishes the latest draft, publishing only what is missing.
- A published version is never replaced and you never roll back: you fix forward.

Every preflight message links to [docs/troubleshooting.md](docs/troubleshooting.md).

## Releasing an action

If `action.yml` is at the repository root, `include-build: auto` adds the build output (`dist/`) to
the release commit, so `dist/` lives in tags only and never on your branch, and the floating major
tag (`v1`) is moved to each stable release. This action releases itself this way.

## Verifying a release

```bash
gh release download v1.2.3 --pattern '*.tgz'
gh attestation verify pkg-1.2.3.tgz --owner <owner>
# or, with the reusable workflow, name the signer explicitly:
gh attestation verify pkg-1.2.3.tgz --repo <owner>/<repo> --signer-repo helpers4/action-release
```

With the reusable workflow, the signing certificate is the one of `helpers4/action-release`, which
is why `--repo` alone does not match. The Release also carries `release.json`, the SBOM
(`sbom.cdx.json`) and the Sigstore bundle (`*.sigstore.json`).

## Requirements and limits

- GitHub-hosted runners (trusted publishing does not support self-hosted), npm 11.5.1 or later,
  Node 22.14 or later for publishing.
- Artifact attestations need a public repository, or a plan that includes them for private ones.
- Packing with Yarn or Bun goes through `npm pack`, which does not resolve `workspace:` or
  `catalog:` ranges; pnpm does. Deno projects are not supported.
- npm is the only registry in this version, plus `none`.

## License

LGPL-3.0-or-later.
