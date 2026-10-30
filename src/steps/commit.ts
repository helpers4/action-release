/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadJson, saveJson, workspace, type Runtime } from '../lib/actions.ts';
import { git } from '../lib/git.ts';
import type { FileChange, Gh } from '../lib/github.ts';
import { PLAN_FILE, type Plan } from '../lib/plan.ts';
import { ReleaseError } from '../lib/version.ts';
import { releaseMessage } from './prepare.ts';

export interface CommitDeps {
  runtime: Runtime;
  /** With the App's token: the only actor allowed to push to the protected branch. */
  appGh: Gh;
  /** With the job's token: the Release. */
  gh: Gh;
  /** Brings the release commit into the local checkout. */
  checkout?: (cwd: string, sha: string) => void;
}

/** Mode of a file in git, `100644` for a new one. */
function modeOf(cwd: string, path: string): string {
  const entry = git(cwd, 'ls-files', '--stage', '--', path);
  return entry.split(/\s+/)[0] || '100644';
}

/**
 * Creates the release commit on top of the tested commit, moves the branch to it (fast-forward
 * only), tags it and drafts the Release. Finishes a commit a previous run already pushed.
 */
export async function commit(deps: CommitDeps): Promise<Plan> {
  const { env, log } = deps.runtime;
  const cwd = workspace(env);
  const plan = loadJson<Plan>(env, PLAN_FILE);
  const message = releaseMessage(plan.tag);

  const head = await deps.appGh.branchHead(plan.branch);
  let sha: string;
  if (head.parents[0] === plan.base && head.message.trim() === message) {
    sha = head.sha;
    log(`The release commit ${sha} is already on ${plan.branch}.`);
  } else if (head.sha !== plan.base) {
    throw new ReleaseError(
      `${plan.branch} moved during the release (it is at ${head.sha}, the release was tested on ${plan.base}). Nothing was released: run the release again.`,
    );
  } else {
    const files: FileChange[] = plan.files.map((path) => ({ path, mode: modeOf(cwd, path), content: readFileSync(join(cwd, path), 'utf8') }));
    sha = await deps.appGh.createCommit(plan.base, files, message);
    if (!(await deps.appGh.fastForward(plan.branch, sha))) {
      throw new ReleaseError(`${plan.branch} moved during the release. Nothing was released: run the release again.`);
    }
    log(`Pushed the release commit ${sha} to ${plan.branch}.`);
  }

  if (!(await deps.appGh.createTag(plan.tag, sha))) {
    const existing = git(cwd, 'ls-remote', '--tags', 'origin', `refs/tags/${plan.tag}`).split(/\s+/)[0];
    if (existing && existing !== sha) throw new ReleaseError(`${plan.tag} already exists on another commit (${existing}).`);
  }
  const release =
    (await deps.gh.releaseByTag(plan.tag)) ??
    (await deps.gh.createDraftRelease({ tag: plan.tag, name: plan.tag, body: plan.notes, prerelease: plan.prerelease }));
  log(`Tagged ${plan.tag}.`);

  (deps.checkout ?? checkoutCommit(env))(cwd, sha);
  const done = { ...plan, commit: sha, releaseId: release.id };
  saveJson(env, PLAN_FILE, done);
  return done;
}

/** Fetches the release commit with the job's token (the checkout keeps no credentials) and checks it out. */
const checkoutCommit = (env: NodeJS.ProcessEnv) => (cwd: string, sha: string) => {
  const basic = Buffer.from(`x-access-token:${env.GITHUB_TOKEN ?? ''}`).toString('base64');
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  git(cwd, '-c', `http.${server}/.extraheader=AUTHORIZATION: basic ${basic}`, 'fetch', '-q', '--no-tags', 'origin', sha);
  git(cwd, 'reset', '-q', '--hard');
  git(cwd, 'checkout', '-q', '--detach', sha);
};
