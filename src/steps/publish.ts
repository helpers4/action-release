/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { loadJson, saveJson, workspace, type Runtime } from '../lib/actions.ts';
import { PLAN_FILE, type Plan, type PlannedTarget } from '../lib/plan.ts';
import { isPublished as registryServes, publish as registryPublish, type Fetch } from '../lib/registries.ts';
import { ReleaseError } from '../lib/version.ts';

export interface PublishDeps {
  runtime: Runtime;
  fetchImpl?: Fetch;
  publish?: (target: PlannedTarget, plan: Plan, cwd: string) => void;
}

/** Publishes every target the registries do not serve yet; all of them are attempted. */
export async function publish(deps: PublishDeps): Promise<Plan> {
  const { env, log, warn } = deps.runtime;
  const cwd = workspace(env);
  const plan = loadJson<Plan>(env, PLAN_FILE);
  const doPublish = deps.publish ?? ((target, p, dir) => registryPublish(target, p.distTag, { cwd: dir, env, log }));

  const failures: string[] = [];
  const targets: PlannedTarget[] = [];
  for (const target of plan.targets) {
    const label = `${target.registry} (${target.name}@${plan.version})`;
    if (target.published || (await registryServes(target.registry, target.name, plan.version, deps.fetchImpl))) {
      log(`${label} is already published.`);
      targets.push({ ...target, published: true });
      continue;
    }
    try {
      log(`::group::Publishing ${label}`);
      doPublish(target, plan, cwd);
      targets.push({ ...target, published: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      warn(`${label} was not published: ${reason}`);
      failures.push(label);
      targets.push(target);
    } finally {
      log('::endgroup::');
    }
  }

  const done = { ...plan, targets };
  saveJson(env, PLAN_FILE, done);
  if (failures.length > 0) {
    throw new ReleaseError(
      `${plan.tag} is tagged but not published on ${failures.join(', ')}. Fix the cause, then run the release again (Re-run failed jobs, or bump: resume): only what is missing is published.`,
    );
  }
  return done;
}
