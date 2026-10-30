/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { appendFileSync } from 'node:fs';
import { loadJson, type Runtime } from '../lib/actions.ts';
import type { Gh } from '../lib/github.ts';
import { PLAN_FILE, type Plan, type PlannedTarget } from '../lib/plan.ts';

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

/** Publishes the Release, with the human summary and the generated list as its notes. */
export async function finalize(deps: FinalizeDeps): Promise<string> {
  const { env, log, setOutput } = deps.runtime;
  const plan = loadJson<Plan>(env, PLAN_FILE);

  // The id saved by commit: a listing right after the creation of the draft may not show it yet.
  const existing = plan.releaseId === undefined ? await deps.gh.releaseByTag(plan.tag) : undefined;
  const release =
    existing && !existing.draft
      ? existing
      : await deps.gh.publishRelease(
          plan.releaseId ??
            existing?.id ??
            (await deps.gh.createDraftRelease({ tag: plan.tag, name: plan.tag, body: plan.notes, prerelease: plan.prerelease })).id,
          { body: plan.notes, latest: plan.latest },
        );

  for (const target of plan.targets) log(`${target.name}@${plan.version}: ${packageUrl(target, plan.version)}`);
  log(`::notice::${plan.tag} is released: ${release.url}`);
  setOutput('release-url', release.url);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(plan, release.url));
  return release.url;
}
