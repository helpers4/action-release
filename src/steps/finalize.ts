/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { appendFileSync } from 'node:fs';
import { loadJson, type Runtime } from '../lib/actions.ts';
import { GitHubError, type Gh, type ReleaseInfo } from '../lib/github.ts';
import { PLAN_FILE, type Plan, type PlannedTarget } from '../lib/plan.ts';
import { ReleaseError } from '../lib/version.ts';

export interface FinalizeDeps {
  runtime: Runtime;
  gh: Gh;
}

export function packageUrl(target: PlannedTarget, version: string): string {
  if (target.registry === 'npm') return `https://www.npmjs.com/package/${target.name}/v/${version}`;
  if (target.registry === 'crates') return `https://crates.io/crates/${target.name}/${version}`;
  return `https://jsr.io/${target.name}@${version}`;
}

/** The job summary: what was released, and where. */
export function summary(plan: Plan, releaseUrl: string): string {
  const rows = plan.targets.map((t) => `| ${t.registry} | [\`${t.name}@${plan.version}\`](${packageUrl(t, plan.version)}) |`);
  return [
    `## 🎉 ${plan.tag} is released`,
    '',
    '| Where | Link |',
    '| --- | --- |',
    ...rows,
    `| GitHub Release | [${plan.tag}](${releaseUrl}) |`,
    '',
  ].join('\n');
}

/** The summary when the Release is left as a draft for the person to publish. */
export function draftSummary(plan: Plan, releasesUrl: string): string {
  return [
    `## ${plan.tag} is released, its Release is a draft`,
    '',
    `The commit, the tag and the packages are done. [Edit the draft](${releasesUrl}) (for a GitHub Action: tick *Publish this Action to the GitHub Marketplace* and pick the categories), then publish it.`,
    '',
  ].join('\n');
}

/**
 * Publishes the Release, with the human summary and the generated list as its notes. With
 * `publish-release: false` the draft is left for the person: a Release that is immutable once published
 * can no longer get its Marketplace categories.
 */
export async function finalize(deps: FinalizeDeps): Promise<string> {
  const { env, log, setOutput } = deps.runtime;
  const plan = loadJson<Plan>(env, PLAN_FILE);

  if (env.INPUT_PUBLISH_RELEASE === 'false') {
    const found = await deps.gh.releaseByTag(plan.tag);
    const draft = found ?? (await deps.gh.createDraftRelease({ tag: plan.tag, name: plan.tag, body: plan.notes, prerelease: plan.prerelease }));
    const releasesUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY ?? ''}/releases`;
    const url = draft.draft ? releasesUrl : draft.url;
    log(draft.draft ? `::notice::${plan.tag} is released; its Release is left as a draft for you to publish: ${releasesUrl}` : `::notice::${plan.tag} is released: ${url}`);
    setOutput('release-url', url);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, draft.draft ? draftSummary(plan, releasesUrl) : summary(plan, url));
    return url;
  }

  // The id saved by commit: a listing right after the creation of the draft may not show it yet.
  const existing = plan.releaseId === undefined ? await deps.gh.releaseByTag(plan.tag) : undefined;
  let release: ReleaseInfo;
  try {
    release =
      existing && !existing.draft
        ? existing
        : await deps.gh.publishRelease(
            plan.releaseId ??
              existing?.id ??
              (await deps.gh.createDraftRelease({ tag: plan.tag, name: plan.tag, body: plan.notes, prerelease: plan.prerelease })).id,
            { body: plan.notes, latest: plan.latest },
          );
  } catch (error) {
    if (error instanceof GitHubError && /used by an immutable release/.test(error.message)) {
      throw new ReleaseError(
        `${plan.tag} belonged to an immutable Release that was deleted: GitHub never lets that tag have a Release again. The version itself is released (commit, tag, packages); the next release gets a new Release.`,
      );
    }
    throw error;
  }

  for (const target of plan.targets) log(`${target.name}@${plan.version}: ${packageUrl(target, plan.version)}`);
  log(`::notice::${plan.tag} is released: ${release.url}`);
  setOutput('release-url', release.url);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(plan, release.url));
  return release.url;
}
