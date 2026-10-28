/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { analyzeCommits } from 'helpers4/commit';
import { compare, increment, isValid, parse, sortVersions } from 'helpers4/version';
import type { Commit } from './git.ts';

export const BUMPS = ['auto', 'patch', 'minor', 'major', 'alpha', 'beta', 'rc', 'resume'] as const;
export type Bump = (typeof BUMPS)[number];
export type Level = 'major' | 'minor' | 'patch';

export class ReleaseError extends Error {}

export const isBump = (value: string): value is Bump => (BUMPS as readonly string[]).includes(value);

/** The level the commits call for. Before 1.0.0 every level shifts down: breaking → minor, feat → patch. */
export function levelFromCommits(commits: readonly Commit[], base: string): Level {
  const analysis = analyzeCommits(commits);
  const level: Level = analysis.hasBreakingChanges ? 'major' : analysis.hasFeatures ? 'minor' : 'patch';
  if (parse(base).major > 0) return level;
  return level === 'major' ? 'minor' : 'patch';
}

const stripV = (tag: string) => tag.replace(/^v/, '');
const stable = (versions: string[]) => versions.filter((v) => parse(v).prerelease.length === 0);

/** Valid versions of the given `v*` tags, highest first. */
export function versionsOfTags(tags: readonly string[]): string[] {
  const versions = tags.map(stripV).filter((v) => isValid(v));
  return sortVersions(versions, { order: 'desc' });
}

export interface NextVersionInput {
  bump: Exclude<Bump, 'resume'>;
  /** Versions of the tags in the history of HEAD. */
  merged: string[];
  /** Versions of every tag of the repository (prerelease counters). */
  all: string[];
  /** Commits since the last stable release in the history of HEAD (all of them if none). */
  commitsSinceStable: Commit[];
  /** Commits since the last release tag of any kind in the history of HEAD. */
  commitsSinceLast: Commit[];
  /** Version written in the manifest, the base when there is no release tag yet. */
  manifestVersion: string | undefined;
}

export interface NextVersion {
  version: string;
  /** The release the version follows, if any. */
  previous: string | undefined;
}

/** Computes the next version, or throws a ReleaseError when there is nothing to release. */
export function nextVersion(input: NextVersionInput): NextVersion {
  const lastStable = stable(input.merged)[0];
  const previous = input.merged[0];
  const base = lastStable ?? input.manifestVersion ?? '0.0.0';
  if (!isValid(base)) throw new ReleaseError(`The version in the manifest (${base}) is not a valid SemVer version.`);

  const forced = input.bump === 'patch' || input.bump === 'minor' || input.bump === 'major';
  if (!forced && previous && input.commitsSinceLast.length === 0) {
    throw new ReleaseError(`Nothing to release: no commit since v${previous}.`);
  }

  const target = forced
    ? increment(base, input.bump as Level)
    : increment(base, levelFromCommits(input.commitsSinceStable, base));
  if (input.bump === 'auto' || forced) return { version: target, previous };

  const id = input.bump;
  const counter = input.all
    .map((v) => parse(v))
    .filter((v) => `${v.major}.${v.minor}.${v.patch}` === target && v.prerelease[0] === id)
    .map((v) => Number(v.prerelease[1] ?? 0))
    .reduce((max, n) => Math.max(max, n), -1);
  return { version: `${target}-${id}.${counter + 1}`, previous };
}

/** Whether `version` may be released after the existing ones (not already taken). */
export function assertNew(version: string, all: readonly string[]): void {
  if (all.some((v) => compare(v, version) === 0)) {
    throw new ReleaseError(`v${version} already exists. Run the release with bump: resume to finish it.`);
  }
}
