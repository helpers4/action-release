/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import semver from 'semver';
import { analyzeCommits } from '@helpers4/commit';
import type { CommitInfo } from './tags.js';

export type Level = 'major' | 'minor' | 'patch';
export type PrereleaseId = 'alpha' | 'beta' | 'rc';
export type Bump = 'auto' | Level | PrereleaseId | 'resume';

export const BUMPS: readonly Bump[] = ['auto', 'patch', 'minor', 'major', 'alpha', 'beta', 'rc', 'resume'];

export class NothingToReleaseError extends Error {
  constructor(last: string | undefined) {
    super(`No commit since ${last ?? 'the beginning of history'}: there is nothing to release.`);
  }
}

/**
 * Level implied by Conventional Commits. Before 1.0.0 a feature only bumps the patch and a
 * breaking change only bumps the minor, since 0.y.z has no stable API to break.
 */
export function levelFromCommits(commits: readonly CommitInfo[], base: string): Level {
  const preMajor = semver.major(base) === 0;
  const { hasBreakingChanges, hasFeatures } = analyzeCommits(commits);
  if (hasBreakingChanges) return preMajor ? 'minor' : 'major';
  return hasFeatures && !preMajor ? 'minor' : 'patch';
}

/**
 * The version a package without any release tag starts from: the manifest version without its
 * prerelease suffix (a `0.0.0-development` placeholder starts from `0.0.0`).
 */
export function baseFromManifest(manifestVersion: string | undefined): string {
  const parsed = manifestVersion ? semver.parse(manifestVersion) : null;
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : '0.0.0';
}

export interface NextVersionInput {
  /** Highest stable release of the line, or the manifest base when there is none. */
  base: string;
  bump: Exclude<Bump, 'resume'>;
  /** Commits of `last..HEAD`, `last` being the stable release `base` comes from. */
  commits: readonly CommitInfo[];
  /** Whether `base` comes from a release tag. Without one, a first release needs no commit. */
  hasRelease: boolean;
  /** Every release version of the repository, whatever the line: prerelease counters use all of them. */
  existing: readonly string[];
}

/** Computes the next version. Throws when `auto` finds nothing to release. */
export function nextVersion(input: NextVersionInput): string {
  const { base, bump, commits, hasRelease, existing } = input;
  if (bump === 'patch' || bump === 'minor' || bump === 'major') {
    return semver.inc(base, bump)!;
  }
  if (commits.length === 0 && hasRelease) throw new NothingToReleaseError(base);
  const target = semver.inc(base, levelFromCommits(commits, base))!;
  if (bump === 'auto') return target;
  const counter = existing
    .map((version) => semver.parse(version))
    .filter((v) => v && `${v.major}.${v.minor}.${v.patch}` === target && v.prerelease[0] === bump)
    .map((v) => Number(v!.prerelease[1] ?? 0))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${target}-${bump}.${counter + 1}`;
}
