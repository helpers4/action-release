# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

The new `publish-release` input leaves the GitHub Release as a draft, for an Action's Marketplace form.

## [0.5.2] - 2026-11-01

The refusal to move the branch now also points at a classic branch protection, which rulesets hide and which
the action cannot read (it needs the administration permission). The README also explains the order of a first release across npm, crates.io and JSR.

### Bug fixes

- **commit**: 📝 point at a classic branch protection when the branch refuses the release commit

## [0.5.1] - 2026-11-01

### Bug fixes

- **commit**: 🐛 report why GitHub refuses to move the branch

## [0.5.0] - 2026-11-01

### Features

- **config**: ✨ publish the npm packages a build generates (npm: dir/*)
- **verify**: ✨ stop before writing on an npm package that does not exist yet

### Bug fixes

- **since**: 🐛 keep @since next on a prerelease

## [0.4.4] - 2026-10-31

### Features

- **action**: ✨ report what a dry run found

## [0.4.3] - 2026-10-30

### Features

- **publish**: ✨ publish the crates of a workspace together

## [0.4.2] - 2026-10-30

### Bug fixes

- **publish**: 🐛 check the version the registry tool will publish
- **version**: 💬 say how to release when there is no commit since the last one
- **changelog**: 🐛 give a release with no change notes instead of an empty body

## [0.4.1] - 2026-10-30

### Bug fixes

- **publish**: 🐛 never publish a manifest that does not carry the version of the release

## [0.4.0] - 2026-10-30

### Breaking changes

- **action**: 💥 take the configuration as inputs, with no .github/release.yml

## [0.3.1] - 2026-10-30

### Bug fixes

- **version**: 🐛 continue after the tags that action-release 0.1.x left on no branch

## [0.3.0] - 2026-10-30

### Bug fixes

- **commit**: 🐛 check out the release commit over the files prepare created
- **since**: 🐛 keep the @since examples of this action's sources and tests

## [0.2.0] - 2026-10-30

### Features

- **action**: ✨ start the rewrite from a composite action run by Node
- **version**: ✨ prepare, verify, commit, publish and finalize a release
- **action**: ✨ move the floating major tag, release this action with itself, and document

### Bug fixes

- **commit**: 🐛 publish the draft Release by its id
- **publish**: 💬 explain why a tag of a deleted immutable Release cannot get a new one
