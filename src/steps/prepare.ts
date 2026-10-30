/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compare, parse } from 'helpers4/version';
import { saveJson, workspace, type Runtime } from '../lib/actions.ts';
import { generateList, sectionOf, updateChangelog } from '../lib/changelog.ts';
import { loadConfig, type Config } from '../lib/config.ts';
import { allTags, commitsSince, git, headSha, tagCommit, tagsMergedInHead, trackedFiles } from '../lib/git.ts';
import type { Gh } from '../lib/github.ts';
import { readVersion, updateCargoLock, writeVersion } from '../lib/manifests.ts';
import { PLAN_FILE, type Plan, type PlannedTarget, type State } from '../lib/plan.ts';
import { distTag, isPublished, packageName, type Fetch } from '../lib/registries.ts';
import { replaceSince } from '../lib/since.ts';
import { assertNew, isBump, nextVersion, ReleaseError, versionsOfTags } from '../lib/version.ts';

export interface PrepareDeps {
  runtime: Runtime;
  /** Reads the Releases; only needed to resume. */
  gh: () => Gh;
  fetchImpl?: Fetch;
  today?: () => string;
}

export const releaseMessage = (tag: string): string => `chore(release): 🔖 ${tag}`;

/** Decides what this run releases, and writes the version, the changelog and `@since` for a new one. */
export async function prepare(deps: PrepareDeps): Promise<Plan> {
  const { env, log } = deps.runtime;
  const cwd = workspace(env);

  if (git(cwd, 'rev-parse', '--is-shallow-repository') === 'true') {
    throw new ReleaseError('The checkout is shallow: the release needs the history and the tags. Set fetch-depth: 0 on actions/checkout.');
  }
  if (!env.GITHUB_REF?.startsWith('refs/heads/')) {
    throw new ReleaseError(`A release runs from a branch, not from ${env.GITHUB_REF ?? 'an unknown ref'}.`);
  }
  const branch = env.GITHUB_REF.slice('refs/heads/'.length);
  const bump = (env.INPUT_BUMP || 'auto').trim();
  if (!isBump(bump)) throw new ReleaseError(`Unknown bump "${bump}": use auto, patch, minor, major, alpha, beta, rc or resume.`);

  const config = loadConfig(cwd, env.INPUT_CONFIG || '.github/release.yml');
  if (config.targets.length === 0) log('No package to publish: the release only tags and creates the GitHub Release.');

  const base = headSha(cwd);
  const all = versionsOfTags(allTags(cwd));

  if (bump === 'resume') {
    const latest = all[0];
    if (!latest) throw new ReleaseError('Nothing to resume: the repository has no release tag.');
    return save(deps, await resumePlan(deps, cwd, config, branch, `v${latest}`, all));
  }

  // A run started again after its release commit was tagged (Re-run failed jobs): finish it.
  const rerun = all.map((v) => `v${v}`).find((t) => tagCommit(cwd, `${t}^`) === base);
  if (rerun) {
    log(`${rerun} was already released from this commit: resuming it.`);
    return save(deps, await resumePlan(deps, cwd, config, branch, rerun, all));
  }

  const merged = versionsOfTags(tagsMergedInHead(cwd));
  const primary = config.targets[0]?.manifest ?? config.versionFiles[0];
  const lastStable = merged.find((v) => parse(v).prerelease.length === 0);
  const { version, previous } = nextVersion({
    bump,
    merged,
    all,
    commitsSinceStable: commitsSince(cwd, lastStable ? `v${lastStable}` : undefined),
    commitsSinceLast: commitsSince(cwd, merged[0] ? `v${merged[0]}` : undefined),
    manifestVersion: primary ? readVersion(cwd, primary) : undefined,
  });
  const tag = `v${version}`;
  assertNew(version, all);

  log(`Releasing ${tag}${previous ? ` (after v${previous})` : ''}.`);
  const files = new Set<string>();
  const manifests = [...new Set([...config.targets.map((t) => t.manifest), ...config.versionFiles])];
  for (const manifest of manifests) for (const path of writeVersion(cwd, manifest, version)) files.add(path);
  for (const cargo of manifests.filter((m) => basename(m) === 'Cargo.toml').slice(0, 1)) {
    for (const path of updateCargoLock(cwd, cargo)) if (trackedFiles(cwd).includes(path)) files.add(path);
  }
  for (const path of replaceSince(cwd, trackedFiles(cwd), config.since, version)) files.add(path);

  const changelogFile = join(cwd, config.changelog);
  const update = updateChangelog(existsSync(changelogFile) ? readFileSync(changelogFile, 'utf8') : undefined, {
    version,
    tag,
    previousTag: previous ? `v${previous}` : undefined,
    date: (deps.today ?? (() => new Date().toISOString().slice(0, 10)))(),
    generated: generateList({ cwd, from: previous ? `v${previous}` : undefined, tag }),
  });
  writeFileSync(changelogFile, update.content);
  files.add(config.changelog);

  const prerelease = parse(version).prerelease.length > 0;
  const stable = all.filter((v) => parse(v).prerelease.length === 0);
  return save(deps, {
    state: 'new',
    version,
    tag,
    previousTag: previous ? `v${previous}` : undefined,
    branch,
    base,
    files: [...files].sort(),
    notes: update.notes,
    prerelease,
    latest: !prerelease && !stable.some((v) => compare(v, version) > 0),
    distTag: distTag(version, stable),
    targets: config.targets.map((t) => ({ ...t, name: packageName(cwd, t), published: false })),
    ...(config.floatingMajor && !prerelease && !stable.some((v) => compare(v, version) > 0) ? { floatingTag: `v${parse(version).major}` } : {}),
  });
}

/** Plan to finish a tagged release: check out its commit, see what is still missing. */
async function resumePlan(deps: PrepareDeps, cwd: string, config: Config, branch: string, tag: string, all: string[]): Promise<Plan> {
  const commit = tagCommit(cwd, tag);
  if (!commit) throw new ReleaseError(`${tag} does not exist.`);
  git(cwd, 'checkout', '-q', '--detach', commit);
  const version = tag.slice(1);
  const after = loadConfig(cwd, deps.runtime.env.INPUT_CONFIG || '.github/release.yml');

  const targets: PlannedTarget[] = [];
  for (const target of after.targets) {
    const name = packageName(cwd, target);
    targets.push({ ...target, name, published: await isPublished(target.registry, name, version, deps.fetchImpl) });
  }
  const release = await deps.gh().releaseByTag(tag);
  const missing = targets.filter((t) => !t.published).map((t) => `${t.registry} (${t.name})`);
  const state: State = missing.length === 0 && release && !release.draft ? 'done' : 'resume';
  deps.runtime.log(
    state === 'done'
      ? `${tag} is complete: published everywhere, with its Release. Nothing to do.`
      : `Resuming ${tag}: ${[...missing, ...(release && !release.draft ? [] : ['the GitHub Release'])].join(', ')}.`,
  );

  const changelog = join(cwd, config.changelog);
  const prerelease = parse(version).prerelease.length > 0;
  const stable = all.filter((v) => parse(v).prerelease.length === 0);
  return {
    state,
    version,
    tag,
    previousTag: undefined,
    branch,
    base: git(cwd, 'rev-parse', `${commit}^`),
    files: [],
    notes: sectionOf(existsSync(changelog) ? readFileSync(changelog, 'utf8') : undefined, version) ?? '',
    prerelease,
    latest: !prerelease && stable[0] === version,
    distTag: distTag(version, stable),
    targets,
    commit,
  };
}

function save(deps: PrepareDeps, plan: Plan): Plan {
  const { env, setOutput } = deps.runtime;
  saveJson(env, PLAN_FILE, plan);
  setOutput('state', plan.state);
  setOutput('version', plan.version);
  setOutput('tag', plan.tag);
  setOutput('crates', String(plan.targets.some((t) => t.registry === 'crates' && !t.published)));
  return plan;
}
