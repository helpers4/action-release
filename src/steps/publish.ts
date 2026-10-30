/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { loadJson, saveJson, workspace, type Runtime } from '../lib/actions.ts';
import { PLAN_FILE, type Plan, type PlannedTarget } from '../lib/plan.ts';
import { isPublished as registryServes, publish as registryPublish, publishCrates as registryPublishCrates, type CrateTarget, type Fetch } from '../lib/registries.ts';
import { ReleaseError } from '../lib/version.ts';

export interface PublishDeps {
  runtime: Runtime;
  fetchImpl?: Fetch;
  publish?: (target: PlannedTarget, plan: Plan, cwd: string) => void;
  /** Publishes the crates of the plan together. */
  publishCrates?: (targets: Array<PlannedTarget & CrateTarget>, plan: Plan, cwd: string) => void;
}

/** Publishes every target the registries do not serve yet; all of them are attempted. */
export async function publish(deps: PublishDeps): Promise<Plan> {
  const { env, log, warn } = deps.runtime;
  const cwd = workspace(env);
  const plan = loadJson<Plan>(env, PLAN_FILE);
  const doPublishCrates = deps.publishCrates ?? ((targets, p, dir) => registryPublishCrates(targets, { cwd: dir, env, log }));
  const doPublish = deps.publish ?? ((target, p, dir) => registryPublish(target, p.version, p.distTag, { cwd: dir, env, log }));

  const failures: string[] = [];
  const results = new Map<PlannedTarget, PlannedTarget>();
  const pending: PlannedTarget[] = [];
  for (const target of plan.targets) {
    if (target.published || (await registryServes(target.registry, target.name, plan.version, deps.fetchImpl))) {
      log(`${target.registry} (${target.name}@${plan.version}) is already published.`);
      results.set(target, { ...target, published: true });
    } else {
      pending.push(target);
    }
  }

  // The crates go to one cargo call, at the place of the first one: cargo publishes them in
  // dependency order, and a failure in the middle leaves the first ones published.
  const crates = pending.filter((t): t is PlannedTarget & CrateTarget => t.registry === 'crates');
  let cratesDone = false;
  for (const target of pending) {
    const batch: PlannedTarget[] = target.registry === 'crates' ? crates : [target];
    if (target.registry === 'crates') {
      if (cratesDone) continue;
      cratesDone = true;
    }
    const label = `${target.registry} (${batch.map((t) => `${t.name}@${plan.version}`).join(', ')})`;
    try {
      log(`::group::Publishing ${label}`);
      if (target.registry === 'crates') doPublishCrates(crates, plan, cwd);
      else doPublish(target, plan, cwd);
      for (const t of batch) results.set(t, { ...t, published: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      warn(`${label} was not published: ${reason}`);
      for (const t of batch) {
        // Some crates of a batch may have gone out before the failure.
        const served = target.registry === 'crates' && (await registryServes(t.registry, t.name, plan.version, deps.fetchImpl));
        results.set(t, { ...t, published: served });
        if (!served) failures.push(`${t.registry} (${t.name}@${plan.version})`);
      }
    } finally {
      log('::endgroup::');
    }
  }
  const targets = plan.targets.map((t) => results.get(t) ?? t);

  const done = { ...plan, targets };
  saveJson(env, PLAN_FILE, done);
  if (failures.length > 0) {
    throw new ReleaseError(
      `${plan.tag} is tagged but not published on ${failures.join(', ')}. Fix the cause, then run the release again (Re-run failed jobs, or bump: resume): only what is missing is published.`,
    );
  }
  return done;
}
