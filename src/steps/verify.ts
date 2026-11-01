/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare } from 'helpers4/version';
import { isTrue, loadJson, saveJson, workspace, type Runtime } from '../lib/actions.ts';
import { run } from '../lib/exec.ts';
import { expandGenerated } from '../lib/generated.ts';
import { PLAN_FILE, type Plan, type PlannedTarget } from '../lib/plan.ts';
import { build, crateProblems, dryRun, dryRunCrates, isPublished, isNewCrate, isNewPackage, oversizedCrates, packageName, versionToPublish, wasUnpublished, type CrateTarget, type Fetch } from '../lib/registries.ts';
import { ReleaseError } from '../lib/version.ts';
import { dryRunReport } from './report.ts';

const FIRST_RELEASE_DOC = 'https://github.com/helpers4/action-release#the-first-release-of-a-project';

/** npm publishes with OIDC trusted publishing from this version on. */
export const NPM_MIN_VERSION = '11.5.1';

export interface VerifyDeps {
  runtime: Runtime;
  /** Version of the npm on the PATH. */
  npmVersion?: () => string;
  fetchImpl?: Fetch;
}

/**
 * Builds the `dir/*` targets and replaces each by the packages the build generated, in the plan
 * that the next steps read. With a release already tagged, the ones the registry serves are marked.
 */
export async function expandGeneratedTargets(plan: Plan, deps: VerifyDeps, cwd: string): Promise<Plan> {
  const { env, log } = deps.runtime;
  const targets: PlannedTarget[] = [];
  for (const target of plan.targets) {
    if (!target.generated) {
      targets.push(target);
      continue;
    }
    log(`::group::Build of ${target.path}`);
    try {
      build(target, { cwd, env, log });
    } catch {
      throw new ReleaseError(`The build of ${target.path} failed (see the log above). Nothing was written.`);
    } finally {
      log('::endgroup::');
    }
    const packages = expandGenerated(cwd, target);
    for (const t of packages) {
      const name = packageName(cwd, t);
      targets.push({ ...t, name, published: plan.state !== 'new' && (await isPublished(t.registry, name, plan.version, deps.fetchImpl)) });
    }
    log(`${target.path}: ${packages.length} packages, to publish in this order: ${packages.map((t) => t.path).join(', ')}.`);
  }
  const expanded = { ...plan, targets };
  saveJson(env, PLAN_FILE, expanded);
  return expanded;
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
export async function verify(deps: VerifyDeps): Promise<void> {
  const { env, log, warn } = deps.runtime;
  const cwd = workspace(env);
  const loaded = loadJson<Plan>(env, PLAN_FILE);
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

  const problems = preflight(loaded, env, npmVersion);
  if (problems.length > 0) {
    if (!isTrue(env.INPUT_DRY_RUN)) throw new ReleaseError(`The release cannot run:\n- ${problems.join('\n- ')}`);
    for (const problem of problems) warn(`${problem} (the release would stop here)`);
  }

  const plan = await expandGeneratedTargets(loaded, deps, cwd);
  const wrong = wrongVersions(cwd, plan);
  if (wrong.length > 0) {
    throw new ReleaseError(
      `${wrong.join('; ')}: the commit of ${plan.tag} cannot publish ${plan.version}. Nothing was published: release the next version (bump: patch).`,
    );
  }

  const pending = plan.targets.filter((t) => !t.published);
  const lost: string[] = [];
  const created: string[] = [];
  for (const t of pending.filter((p) => p.registry === 'npm')) {
    if (await isNewPackage(t.name, deps.fetchImpl)) created.push(t.name);
    else if (await wasUnpublished(t.name, plan.version, deps.fetchImpl)) lost.push(t.name);
  }
  if (created.length > 0) {
    throw new ReleaseError(
      [
        `${created.join(', ')} ${created.length > 1 ? 'are' : 'is'} not on npm yet, and trusted publishing only works for an existing package. To do, once per package:`,
        '1. stage a first version, which is not public until approved: `npm stage publish` (from the folder of the built package);',
        '2. on npmjs.com, in the package settings, add this repository, this workflow file and this environment as its trusted publisher;',
        '3. run the release again.',
        `Nothing was written (${FIRST_RELEASE_DOC}).`,
      ].join('\n'),
    );
  }
  if (lost.length > 0) {
    throw new ReleaseError(
      `npm refuses ${plan.version} of ${lost.join(', ')}: that version was published and then unpublished, and can never be published again. Release the next version (bump: patch). Nothing was written.`,
    );
  }
  const crates = pending.filter((t): t is PlannedTarget & CrateTarget => t.registry === 'crates');
  if (crates.length > 0) {
    const fresh: string[] = [];
    for (const t of crates) if (await isNewCrate(t.name, deps.fetchImpl)) fresh.push(t.name);
    if (fresh.length > 0) {
      if (!isTrue(env.INPUT_HAS_CRATES_TOKEN)) {
        throw new ReleaseError(
          [
            `${fresh.join(', ')} ${fresh.length > 1 ? 'are' : 'is'} not on crates.io yet, and trusted publishing only works for an existing crate. Either, once per crate:`,
            '1. publish a first version by hand: `cargo login` then `cargo publish` (a token with the publish-new scope);',
            '2. on crates.io, in the crate settings, add this repository, this workflow file and this environment as its trusted publisher;',
            '3. run the release again.',
            'Or give the crates-token input a token with the publish-new and publish-update scopes for this one release (then remove it and add the trusted publisher).',
            `Nothing was written (${FIRST_RELEASE_DOC}).`,
          ].join('\n'),
        );
      }
      warn(`${fresh.join(', ')} ${fresh.length > 1 ? 'are' : 'is'} not on crates.io yet: published with the crates-token. Add the trusted publisher on crates.io, then remove the input.`);
    }
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
