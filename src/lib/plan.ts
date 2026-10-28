/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { Target } from './config.ts';

/**
 * - `new`: a version to release (commit, tag, publications, Release).
 * - `resume`: the version is tagged, but a publication or the Release is missing.
 * - `done`: the version is tagged, published everywhere, and its Release is published.
 */
export type State = 'new' | 'resume' | 'done';

export interface PlannedTarget extends Target {
  /** Name of the package on its registry. */
  name: string;
  /** Whether the registry already serves the version (filled for `resume`). */
  published: boolean;
}

/** What `prepare` decides, read by every following step. */
export interface Plan {
  state: State;
  version: string;
  tag: string;
  previousTag: string | undefined;
  /** The branch being released, the one the release commit goes to. */
  branch: string;
  /** The tested commit: parent of the release commit. */
  base: string;
  /** Files written by prepare, to commit (repository-relative paths). */
  files: string[];
  /** Notes of the GitHub Release. */
  notes: string;
  prerelease: boolean;
  /** Whether the Release is the latest one (a stable version, the highest). */
  latest: boolean;
  /** npm dist-tag of the version. */
  distTag: string;
  targets: PlannedTarget[];
  /** The release commit, once it exists. */
  commit?: string;
}

export const PLAN_FILE = 'plan.json';
