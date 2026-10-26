/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as semver from './semver.js';
import type { Gh, ReleaseInfo } from './github.js';
import type { ReleaseManifest, ResumeManifest } from './manifest.js';
import { DOCS, preflight, workflowsUnchanged, type PreflightDeps } from './preflight.js';
import { planResume } from './registries.js';

export interface PublishDeps extends PreflightDeps {
  /** Signs the tarball (SLSA provenance) and returns the Sigstore bundle as JSON. */
  attest(subject: { name: string; sha256: string }): Promise<Buffer>;
  /** Publishes the tarball with npm; throws on failure. */
  publishNpm(tarball: string, distTag: string): void;
  log(message: string): void;
  warn(message: string): void;
}

export interface PublishOptions {
  /** Directory holding the downloaded build artifact. */
  dir: string;
  /** Branch the release was started from. */
  branch: string;
  dryRun: boolean;
}

export interface PublishResult {
  version: string;
  tag: string;
  releaseUrl?: string;
  /** Whether each requested registry serves the version. */
  published: Record<string, boolean>;
  dryRun: boolean;
}

const RELEASE_JSON = 'release.json';
const bundleName = (tarball: string) => `${tarball}.sigstore.json`;

export class ReleaseStoppedError extends Error {}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function renderBody(notes: string, missing: string[]): string {
  if (missing.length === 0) return notes;
  return `${notes}\n\n> ⚠️ **Publication incomplete**: not published on ${missing.join(', ')}. Run the release again with \`bump: resume\`.\n`;
}

/** Publish mode, from the build artifact (or the draft Release when resuming) to the published Release. */
export async function publishRelease(deps: PublishDeps, options: PublishOptions): Promise<PublishResult> {
  const raw = JSON.parse(readFileSync(join(options.dir, RELEASE_JSON), 'utf8')) as
    | ReleaseManifest
    | ResumeManifest;
  if ('resume' in raw) return resume(deps, options);

  const manifest = raw;
  const tarballPath = join(options.dir, manifest.tarball);
  const tarball = readFileSync(tarballPath);
  if (sha256(tarball) !== manifest.sha256) {
    throw new ReleaseStoppedError(
      `The tarball ${manifest.tarball} differs from the one the build job produced (sha256 mismatch). Nothing was released.`,
    );
  }

  const problems = await preflight(deps, manifest);
  for (const p of problems) (p.level === 'error' ? deps.warn : deps.log)(`[${p.code}] ${p.message}`);
  const errors = problems.filter((p) => p.level === 'error');
  if (errors.length > 0) {
    throw new ReleaseStoppedError(
      `Preflight failed, nothing was released:\n${errors.map((e) => `- ${e.message}`).join('\n')}`,
    );
  }

  const files = manifest.files.map((path) => ({
    path,
    content: readFileSync(join(options.dir, 'files', path)),
  }));
  const commit = await deps.gh.createCommit(manifest.baseSha, files, `chore(release): 🔖 ${manifest.tag}`);

  if (!(await workflowsUnchanged(deps.gh, manifest.baseSha, options.branch))) {
    throw new ReleaseStoppedError(
      `The branch ${options.branch} received a workflow change while the release was running, and GitHub would refuse a tag on the tested commit. Nothing was published: run the release again.`,
    );
  }

  if (options.dryRun) {
    deps.log(`Dry run: ${manifest.tag} would be released from commit ${commit}. Stopping before the tag.`);
    return { version: manifest.version, tag: manifest.tag, published: {}, dryRun: true };
  }

  // The tag is the lock: creating a ref is atomic, so a concurrent release stops here.
  if ((await deps.gh.createTag(manifest.tag, commit)) === 'exists') {
    throw new ReleaseStoppedError(
      `Tag ${manifest.tag} already exists: another release took this version. Nothing was published; run the release again.`,
    );
  }

  const draft = await deps.gh.createDraftRelease({
    tag: manifest.tag,
    commit,
    body: renderBody(await readNotes(options.dir, manifest), manifest.registries.map((r) => r.name).filter((n) => n !== 'none')),
    prerelease: manifest.prerelease,
  });
  await deps.gh.uploadAsset(draft.id, RELEASE_JSON, readFileSync(join(options.dir, RELEASE_JSON)));
  await deps.gh.uploadAsset(draft.id, manifest.tarball, tarball);
  if (manifest.sbom) {
    await deps.gh.uploadAsset(draft.id, manifest.sbom, readFileSync(join(options.dir, manifest.sbom)));
  }
  return finish(deps, manifest, tarballPath, tarball, draft, commit, await readNotes(options.dir, manifest));
}

function readNotes(dir: string, manifest: ReleaseManifest): string {
  return readFileSync(join(dir, manifest.notes), 'utf8').trim();
}

/** The steps after the lock, shared with `resume`: attest, publish what is missing, release. */
async function finish(
  deps: PublishDeps,
  manifest: ReleaseManifest,
  tarballPath: string,
  tarball: Buffer,
  draft: ReleaseInfo,
  commit: string,
  notes: string,
): Promise<PublishResult> {
  const { gh } = deps;
  const assets = await gh.listAssets(draft.id);
  if (!assets.some((a) => a.name === bundleName(manifest.tarball))) {
    let bundle: Buffer;
    try {
      bundle = await deps.attest({ name: manifest.tarball, sha256: manifest.sha256 });
    } catch (error) {
      throw new ReleaseStoppedError(
        `The tarball could not be attested: ${error instanceof Error ? error.message : String(error)}\n` +
          `The tag ${manifest.tag} and the draft Release are kept: fix the cause and run the release again with bump: resume. ` +
          `See ${DOCS}#attestation-failed`,
      );
    }
    await gh.uploadAsset(draft.id, bundleName(manifest.tarball), bundle);
  }

  const published: Record<string, boolean> = {};
  const live = (await deps.fetchVersions(manifest.package.name)) ?? [];
  for (const registry of manifest.registries) {
    if (registry.name === 'npm') published.npm = live.includes(manifest.version);
  }
  const failures: string[] = [];
  for (const registry of planResume(manifest.registries, published).pending) {
    try {
      deps.publishNpm(tarballPath, manifest.distTag);
      published[registry.name] = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      if (registry.optional) {
        deps.warn(`${registry.name} (optional) was not published: ${reason}`);
      } else {
        failures.push(`${registry.name}: ${reason}`);
      }
    }
  }

  const plan = planResume(manifest.registries, published);
  const missing = plan.pending.map((r) => r.name);
  if (!plan.complete) {
    await gh.updateRelease(draft.id, { body: renderBody(notes, missing) });
    throw new ReleaseStoppedError(
      `Publication is incomplete (${failures.join('; ')}). The Release stays a draft and the tag ${manifest.tag} is kept: fix the cause and run the release again with bump: resume.`,
    );
  }

  const optionalMissing = missing.length > 0 ? `\n\n> Not published on ${missing.join(', ')} (optional).\n` : '';
  const released = await gh.updateRelease(draft.id, {
    body: `${notes}${optionalMissing}`,
    draft: false,
    latest: manifest.latest,
  });
  deps.log(`Released ${manifest.tag}: ${released.url}`);

  await afterRelease(deps, manifest, commit, released.url);
  return {
    version: manifest.version,
    tag: manifest.tag,
    releaseUrl: released.url,
    published,
    dryRun: false,
  };
}

/** Non-blocking follow-ups: the floating major tag of actions, and the "released in" comments. */
async function afterRelease(
  deps: PublishDeps,
  manifest: ReleaseManifest,
  commit: string,
  releaseUrl: string,
): Promise<void> {
  try {
    if (manifest.includeBuild && !manifest.prerelease) {
      const major = semver.major(manifest.version);
      const siblings = (await deps.gh.listTags(`v${major}.`))
        .map((t) => t.slice(1))
        .filter(semver.isStable);
      if (siblings.every((v) => !semver.gt(v, manifest.version))) {
        await deps.gh.forceTag(`v${major}`, commit);
        deps.log(`Moved the floating tag v${major} to ${manifest.tag}.`);
      }
    }
  } catch (error) {
    deps.warn(`The floating major tag was not moved: ${String(error)}`);
  }

  try {
    const seen = new Set<number>();
    const shas = await deps.gh.commitsBetween(manifest.last, manifest.baseSha);
    for (const sha of shas) {
      for (const pr of await deps.gh.mergedPullRequests(sha)) {
        const targets = [pr, ...(await deps.gh.closingIssues(pr))];
        for (const number of targets) {
          if (seen.has(number)) continue;
          seen.add(number);
          await deps.gh.comment(number, `🎉 Included in [${manifest.tag}](${releaseUrl}).`);
        }
      }
    }
  } catch (error) {
    deps.warn(`The "released in" comments were not all posted: ${String(error)}`);
  }
}

/** Finishes the most recent draft Release: what an interrupted release still lacks. */
async function resume(deps: PublishDeps, options: PublishOptions): Promise<PublishResult> {
  const draft = await deps.gh.latestDraft();
  if (!draft) {
    throw new ReleaseStoppedError('There is no incomplete release to resume: no draft Release exists.');
  }
  const assets = await deps.gh.listAssets(draft.id);
  const manifestAsset = assets.find((a) => a.name === RELEASE_JSON);
  if (!manifestAsset) {
    throw new ReleaseStoppedError(`The draft Release ${draft.tag} has no ${RELEASE_JSON}: it was not created by this action.`);
  }
  const manifest = JSON.parse((await deps.gh.downloadAsset(manifestAsset.id)).toString('utf8')) as ReleaseManifest;
  const tarballAsset = assets.find((a) => a.name === manifest.tarball);
  if (!tarballAsset) {
    throw new ReleaseStoppedError(`The draft Release ${draft.tag} lost its tarball ${manifest.tarball}.`);
  }
  const tarball = await deps.gh.downloadAsset(tarballAsset.id);
  if (sha256(tarball) !== manifest.sha256) {
    throw new ReleaseStoppedError(`The tarball of the draft Release ${draft.tag} does not match its recorded sha256.`);
  }
  const dir = join(options.dir, 'resume');
  mkdirSync(dir, { recursive: true });
  const tarballPath = join(dir, manifest.tarball);
  writeFileSync(tarballPath, tarball);
  deps.log(`Resuming ${manifest.tag}.`);

  const commit = (await deps.gh.tagCommit(manifest.tag)) ?? manifest.baseSha;
  return finish(deps, manifest, tarballPath, tarball, draft, commit, draft.body.split('\n\n> ⚠️')[0]!.trim());
}
