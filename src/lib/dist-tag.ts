/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { parse } from 'helpers4/version';
import * as semver from './semver.js';

export interface DistTag {
  /** npm dist-tag to publish under. */
  tag: string;
  /** Whether the GitHub Release is the repository's latest one. */
  latest: boolean;
}

/**
 * Picks the npm dist-tag. `latest` is reserved for a stable version that is not lower than the
 * highest stable version already published; a prerelease uses its identifier, and a release of
 * an older line uses `release-<major>.<minor>`.
 */
export function distTagFor(version: string, published: readonly string[]): DistTag {
  if (semver.isPrerelease(version)) {
    const id = parse(version).prerelease[0];
    return { tag: typeof id === 'string' ? id : 'next', latest: false };
  }
  const highest = semver.sortDescending(published.filter(semver.isStable))[0];
  if (!highest || semver.gt(version, highest)) return { tag: 'latest', latest: true };
  return { tag: `release-${semver.major(version)}.${semver.minor(version)}`, latest: false };
}
