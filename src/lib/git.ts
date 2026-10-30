/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { run, succeeds } from './exec.ts';

export interface Commit {
  sha: string;
  subject: string;
  body: string;
}

export const git = (cwd: string, ...args: string[]): string => run('git', args, { cwd });

export const headSha = (cwd: string): string => git(cwd, 'rev-parse', 'HEAD');

/**
 * `v*` tags released from the history of HEAD: their commit is in it (release tags are on the
 * branch), or its parent is (the release commits of action-release 0.1.x were on no branch).
 */
export const tagsMergedInHead = (cwd: string): string[] => {
  const merged = new Set(git(cwd, 'tag', '--merged', 'HEAD', '--list', 'v*').split('\n').filter(Boolean));
  return allTags(cwd).filter((tag) => merged.has(tag) || isAncestor(cwd, `refs/tags/${tag}^{commit}^`, 'HEAD'));
};

/** Every `v*` tag of the repository, whatever the branch (prerelease counters use them all). */
export const allTags = (cwd: string): string[] =>
  git(cwd, 'tag', '--list', 'v*').split('\n').filter(Boolean);

export const tagCommit = (cwd: string, tag: string): string | undefined => {
  try {
    return git(cwd, 'rev-parse', `refs/tags/${tag}^{commit}`);
  } catch {
    return undefined;
  }
};

export const isAncestor = (cwd: string, ancestor: string, descendant: string): boolean =>
  succeeds('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd });

/** Commits of `from..HEAD` (all of HEAD's history without `from`), newest first. */
export function commitsSince(cwd: string, from: string | undefined): Commit[] {
  const separator = '\u001e';
  const field = '\u001f';
  const range = from ? [`${from}..HEAD`] : ['HEAD'];
  const out = git(cwd, 'log', `--format=%H${field}%s${field}%b${separator}`, ...range);
  return out
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = '', subject = '', body = ''] = entry.split(field);
      return { sha, subject, body: body.trim() };
    });
}

/** Files tracked by git (paths relative to the repository root). */
export const trackedFiles = (cwd: string): string[] =>
  git(cwd, 'ls-files').split('\n').filter(Boolean);

