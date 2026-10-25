# Troubleshooting

Every preflight and check message ends with a link to a section of this page. Each section tells
what the message means and how to fix it.

## missing-id-token

The publish job has no OIDC token. npm trusted publishing and attestations need `id-token: write`.
Grant it on the job that runs `helpers4/action-release` in publish mode, and, when you use the
reusable workflow, on the calling job too (`permissions` of a caller bound the called workflow).

## npm-too-old

Trusted publishing needs npm 11.5.1 or later and Node 22.14 or later on a GitHub-hosted runner.
Use a recent Node (`.node-version`), or run `npm install -g npm@latest` before publishing.

## package-missing

npm only lets you configure a trusted publisher on a package that already exists, so the very first
publish is manual: `npm publish` a first version from your machine, register the trusted publisher
(`npm trust github --file release.yml --repository owner/repo --yes`), then run the release. A
trusted publisher that is not validated by a publish expires after 48 hours.

## version-published

npm never frees a published version number. The computed version already exists on npm: another
release was published outside the pipeline. Release again; if npm is ahead of the tags, see
`npm-ahead`.

## npm-ahead

npm holds a higher stable version than every release tag, so the next version cannot be computed
safely. Tag the commit that was published (`git tag v1.2.3 <commit> && git push origin v1.2.3`), or
release with an explicit `bump`.

## attestation-failed

Signing the tarball failed after the tag was created, so the release is incomplete: the tag and a
draft Release remain. Typical causes: the job lacks `id-token: write` or `attestations: write`, or
the repository is private on a plan without artifact attestations (the API answers "Feature not
available for the organization"). Fix the cause (grant the permissions, upgrade the plan, or make
the repository public), then run the release again with `bump: resume`.

## immutable-releases

Immutable releases make a published release's tag and assets permanent. Enable them in
Settings → General → Releases. The release works without them, but nothing protects the tag.

## tag-ruleset

A tag ruleset forbids creating `v*` tags. Immutable releases already protect release tags, so
either remove the "restrict creations" rule or exclude `v*` from it. If the ruleset lists GitHub
Actions as a bypass actor, the warning can be ignored.

## placeholder-version

`package.json` on the released branch carries a real version. The release writes the version into
the release commit only, so main should keep a placeholder: `0.0.0-development`.

## changelog-unreleased

`CHANGELOG.md` on the released branch has an `[Unreleased]` section. The release carries the
changelog from tag to tag and cannot rename that section on the branch. Either delete the file from
the branch (it is generated), or prepare the section in a pull request before releasing.

## no-lockfile

Without a lockfile the build installs whatever versions are current. Commit one.

## private-package

`"private": true` makes npm refuse the publish. Remove it, or release with `registries: none`.

## invalid-registries, no-package, no-name, include-build

Input or manifest mistakes; the message names the exact field.
