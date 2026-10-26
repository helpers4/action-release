/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import * as semver from './semver.js';
import { git, isAncestor } from './git.js';

export interface ReleaseTag {
  /** Tag name, with its leading v. */
  tag: string;
  version: string;
}

export interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
}

/** Every `v<semver>` tag of the repository, highest version first. */
export function listReleaseTags(cwd: string): ReleaseTag[] {
  const names = git(cwd, 'tag', '--list', 'v*').split('\n').filter(Boolean);
  const tags: ReleaseTag[] = [];
  for (const tag of names) {
    const version = tag.slice(1);
    if (semver.isValid(version)) tags.push({ tag, version });
  }
  const order = semver.sortDescending(tags.map((t) => t.version));
  return tags.sort((a, b) => order.indexOf(a.version) - order.indexOf(b.version));
}

/**
 * A release commit lives on no branch, so a tag belongs to the line ending at `head` when the
 * tag itself (maintenance branch cut from a tag) or its parent (the published commit of the
 * branch) is an ancestor of `head`.
 */
export function belongsToLine(cwd: string, tag: string, head: string): boolean {
  return isAncestor(cwd, tag, head) || isAncestor(cwd, `${tag}^`, head);
}

/**
 * The highest release tag of the line ending at `head`. Stable releases ignore prerelease
 * tags: the changelog of 1.3.0 covers everything since 1.2.3, betas included.
 */
export function findLastRelease(
  cwd: string,
  options: { head?: string; prerelease?: boolean } = {},
): ReleaseTag | undefined {
  const head = options.head ?? 'HEAD';
  return listReleaseTags(cwd).find(
    ({ tag, version }) =>
      (options.prerelease || semver.isStable(version)) && belongsToLine(cwd, tag, head),
  );
}

/** Commits reachable from `head` and not from `last`, oldest first. */
export function commitsInRange(cwd: string, last: string | undefined, head = 'HEAD'): CommitInfo[] {
  const range = last ? `${last}..${head}` : head;
  const out = git(cwd, 'log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', range);
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f');
      return { sha, subject, body: body.trim() };
    });
}
