# Troubleshooting

Each section starts with the message of the action.

## Before anything is written

These stop the release in `prepare` or `verify`: fix the cause and run it again.

### "The checkout is shallow"

`actions/checkout` fetches one commit by default. The release needs the history and the tags:
`with: { fetch-depth: 0 }`.

### "A release runs from a branch"

Run the workflow from a branch (the one the release commit goes to), not from a tag.

### "Nothing to release: no commit since vX.Y.Z"

No commit since the last release. To release anyway (a rebuild, a dependency), choose `patch`,
`minor` or `major`.

### "vX.Y.Z already exists"

The computed version is taken by a tag that is not in the history of this branch. If it is the
release you are finishing, run with `bump: resume`; otherwise choose another `bump`.

### "The job cannot request an OIDC token"

Trusted publishing (npm, crates.io, JSR) needs `permissions: { id-token: write }` on the release job.

### "npm X cannot publish with trusted publishing"

npm publishes with OIDC from 11.5.1. Node 24 ships a recent enough npm: `actions/setup-node` with
`node-version: 24`.

### "No GitHub App to push the release commit"

Set the `app-id` and `app-key` inputs (see *One-time setup* in the README).

### "The build of … failed" / "The npm (cargo, jsr) dry-run of … failed"

The registry's own tool reports the problem in the log above the message (a missing license for
JSR, a file missing from the package, a wrong name…). Nothing was written.

### "… moved during the release"

Someone pushed to the branch between the start of the release and its commit. The release only
moves the branch as a fast-forward, so it stopped without writing: run it again.

## After the commit

The version is on the branch and tagged. Never delete the tag: fix the cause, then *Re-run failed
jobs* or run with `bump: resume`.

### "vX.Y.Z is tagged but not published on …"

The registry refused the publication. Usually the trusted publisher: it must name this repository,
the workflow file (`release.yml`) and the environment of the job, exactly. For npm and crates.io,
the package must exist already (publish the first version by hand).

### "… has version X, not Y: the commit of vY cannot publish Y"

The release commit of vY did not write the version in that manifest (the target was added after
it was tagged, for instance). Publishing it would publish version X. Nothing was published: release
the next version, which writes the version in every manifest.

### "No crates.io token"

`rust-lang/crates-io-auth-action` could not exchange the OIDC token: check the trusted publisher of
the crate on crates.io.

### "vX.Y.Z belonged to an immutable Release that was deleted"

GitHub keeps the tag of a deleted immutable Release reserved forever: that version can never get a
Release again. The version itself (commit, tag, packages) is released; the next one gets a Release.
