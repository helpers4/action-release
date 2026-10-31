/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare } from 'helpers4/version';
import { isTrue, loadJson, workspace, type Runtime } from '../lib/actions.ts';
import { run } from '../lib/exec.ts';
import { PLAN_FILE, type Plan, type PlannedTarget } from '../lib/plan.ts';
import { build, crateProblems, dryRun, dryRunCrates, oversizedCrates, versionToPublish, type CrateTarget } from '../lib/registries.ts';
import { ReleaseError } from '../lib/version.ts';
import { dryRunReport } from './report.ts';

/** npm publishes with OIDC trusted publishing from this version on. */
export const NPM_MIN_VERSION = '11.5.1';

export interface VerifyDeps {
  runtime: Runtime;
  /** Version of the npm on the PATH. */
  npmVersion?: () => string;
}

/** Problems that would only show up after the release commit: found now, while nothing is written. */
export function preflight(plan: Plan, env: NodeJS.ProcessEnv, npmVersion: () => string): string[] {
  const problems: string[] = [];
  const pending = plan.targets.filter((t) => !t.published);
  if (pending.length > 0 && !env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    problems.push('The job cannot request an OIDC token, needed by trusted publishing: add `id-token: write` to its permissions.');
  }
  if (pending.some((t) => t.registry === 'npm')) {
    const version = npmVersion();
    if (compare(version, NPM_MIN_VERSION) < 0) {
      problems.push(`npm ${version} cannot publish with trusted publishing (${NPM_MIN_VERSION} or later): use Node 24 with actions/setup-node.`);
    }
  }
  if (plan.state === 'new' && !isTrue(env.INPUT_HAS_APP)) {
    problems.push('No GitHub App to push the release commit: set the app-id and app-key inputs.');
  }
  return problems;
}

/**
 * Targets whose manifest carries another version than the release: a resumed release whose
 * commit was made without that target, for instance. Publishing them would publish that version.
 */
export function wrongVersions(cwd: string, plan: Plan): string[] {
  return plan.targets
    .filter((t) => !t.published)
    .flatMap((t) => {
      const found = versionToPublish(t, cwd);
      return found !== undefined && found !== plan.version ? [`${t.manifest} has version ${found}, not ${plan.version}`] : [];
    });
}

/** Builds every target still to publish, and runs its registry's dry-run on the result. */
export function verify(deps: VerifyDeps): void {
  const { env, log, warn } = deps.runtime;
  const cwd = workspace(env);
  const plan = loadJson<Plan>(env, PLAN_FILE);
  const npmVersion =
    deps.npmVersion ??
    (() => {
      const scratch = mkdtempSync(join(tmpdir(), 'h4-npm-'));
      try {
        return run('npm', ['--version'], { cwd: scratch });
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    });

  const problems = preflight(plan, env, npmVersion);
  if (problems.length > 0) {
    if (!isTrue(env.INPUT_DRY_RUN)) throw new ReleaseError(`The release cannot run:\n- ${problems.join('\n- ')}`);
    for (const problem of problems) warn(`${problem} (the release would stop here)`);
  }

  const wrong = wrongVersions(cwd, plan);
  if (wrong.length > 0) {
    throw new ReleaseError(
      `${wrong.join('; ')}: the commit of ${plan.tag} cannot publish ${plan.version}. Nothing was published: release the next version (bump: patch).`,
    );
  }

  const pending = plan.targets.filter((t) => !t.published);
  const crates = pending.filter((t): t is PlannedTarget & CrateTarget => t.registry === 'crates');
  if (crates.length > 0) {
    const { problems: missing, warnings } = crateProblems(crates, cwd);
    for (const warning of warnings) warn(warning);
    if (missing.length > 0) throw new ReleaseError(`crates.io would refuse:\n- ${missing.join('\n- ')}\nNothing was written.`);
  }

  // The crates of a workspace are checked and published together, at the place of the first one.
  let cratesDone = false;
  for (const target of pending) {
    if (target.registry === 'crates') {
      if (cratesDone) continue;
      cratesDone = true;
    }
    const batch: PlannedTarget[] = target.registry === 'crates' ? crates : [target];
    const label = `${target.registry}: ${batch.map((t) => t.name).join(', ')}`;
    log(`::group::${label}@${plan.version}`);
    try {
      for (const t of batch) build(t, { cwd, env, log });
    } catch {
      throw new ReleaseError(`The build of ${batch.map((t) => t.name).join(', ')} failed (see the log above). Nothing was written.`);
    } finally {
      log('::endgroup::');
    }
    log(`::group::${target.registry} dry-run: ${batch.map((t) => t.name).join(', ')}@${plan.version}`);
    try {
      if (target.registry === 'crates') dryRunCrates(crates, { cwd, env, log });
      else dryRun(target, plan.version, plan.distTag, { cwd, env, log });
    } catch {
      throw new ReleaseError(
        `The ${target.registry} dry-run of ${batch.map((t) => t.name).join(', ')} failed: fix what it reports in the log above. Nothing was written.`,
      );
    } finally {
      log('::endgroup::');
    }
    if (target.registry === 'crates') {
      const oversized = oversizedCrates(crates, plan.version, cwd);
      if (oversized.length > 0) throw new ReleaseError(`crates.io would refuse:\n- ${oversized.join('\n- ')}\nNothing was written.`);
    }
  }
  if (isTrue(env.INPUT_DRY_RUN)) {
    const report = dryRunReport(plan, env.INPUT_BUMP || 'auto');
    log(report);
    log(`::notice::Dry run: ${plan.tag} ${plan.state === 'new' ? 'would be released' : 'is already tagged'}; everything passed, nothing was written.`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report);
  }
}
