# Changelog

All notable changes to this project are documented in this file.

## [0.1.3] - 2026-10-27

### Bug fixes
- **version**: 🐛 number prereleases from .0, and harden the resume and immutable checks

## [0.1.2] - 2026-10-27

### Features
- **publish**: ✨ show the version and the npm link when a release is done

## [0.1.1] - 2026-10-27

### Bug fixes
- **changelog**: 🐛 run git-cliff from outside the repository


### Documentation
- **docs**: 📝 make the action the main path, the reusable workflow a shortcut

## [0.1.0] - 2026-10-26

### Bug fixes
- **action**: 🐛 run on node24, the newest runtime the runner accepts
- **action**: 🐛 let fetch set the content-length of asset uploads
- **action**: 🥅 explain how to resume when the attestation fails


### Documentation
- 📝 write the readme, llms.txt and contributor notes
- 📝 write the readme with levels 1 and 2 and the examples


### Features
- **action**: ✨ scaffold the action, build, tests and docs
- **version**: ✨ add tag selection, version, dist-tag and changelog logic
- **action**: ✨ add the build mode and use helpers4 packages
- **action**: ✨ add the publish and check modes


### Refactoring
- **version**: ♻️ use helpers4 instead of semver and per-category packages
