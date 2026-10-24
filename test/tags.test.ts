/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'vitest';
import { commitsInRange, findLastRelease, listReleaseTags } from '../src/lib/tags.js';
import { TempRepo } from './helpers/repo.js';

let repo: TempRepo;
afterEach(() => repo.dispose());

/**
 * The scenario of the design document: v1.0.0 and v1.2.3 sit off main, release/1.0.x is cut
 * from v1.0.0, and v1.0.1 is released from it.
 */
function scenario() {
  repo = new TempRepo();
  repo.commit('feat: initial');
  repo.release('v1.0.0');
  repo.commit('feat: second line work');
  repo.commit('fix: more work');
  repo.release('v1.2.3');
  const mainHead = repo.commit('feat: after 1.2.3');
  repo.git('switch', '-q', '-c', 'release/1.0.x', 'v1.0.0');
  const fix = repo.commit('fix: backported fix');
  repo.release('v1.0.1');
  repo.git('switch', '-q', 'main');
  return { mainHead, fix };
}

describe('findLastRelease', () => {
  it('lists release tags from the highest version', () => {
    scenario();
    expect(listReleaseTags(repo.dir).map((t) => t.tag)).toEqual(['v1.2.3', 'v1.0.1', 'v1.0.0']);
  });

  it('ignores tags that are not v<semver>', () => {
    scenario();
    repo.git('tag', 'vnext');
    repo.git('tag', 'v1.0');
    expect(listReleaseTags(repo.dir)).toHaveLength(3);
  });

  it('finds v1.2.3 from main, whose tag is not an ancestor but whose parent is', () => {
    scenario();
    expect(findLastRelease(repo.dir, { head: 'main' })?.tag).toBe('v1.2.3');
  });

  it('finds v1.0.1 from the maintenance branch and ignores v1.2.3', () => {
    scenario();
    expect(findLastRelease(repo.dir, { head: 'release/1.0.x' })?.tag).toBe('v1.0.1');
  });

  it('finds v1.0.0 on a maintenance branch cut from it, before v1.0.1 exists', () => {
    repo = new TempRepo();
    repo.commit('feat: initial');
    repo.release('v1.0.0');
    repo.commit('feat: later');
    repo.release('v1.2.3');
    repo.git('switch', '-q', '-c', 'release/1.0.x', 'v1.0.0');
    repo.commit('fix: patch');
    expect(findLastRelease(repo.dir)?.tag).toBe('v1.0.0');
  });

  it('returns undefined when no tag applies', () => {
    repo = new TempRepo();
    repo.commit('feat: initial');
    expect(findLastRelease(repo.dir)).toBeUndefined();
  });

  it('skips prereleases for a stable release but not when asked', () => {
    repo = new TempRepo();
    repo.commit('feat: a');
    repo.release('v1.0.0');
    repo.commit('feat: b');
    repo.release('v1.1.0-beta.1');
    repo.commit('fix: c');
    expect(findLastRelease(repo.dir)?.tag).toBe('v1.0.0');
    expect(findLastRelease(repo.dir, { prerelease: true })?.tag).toBe('v1.1.0-beta.1');
  });
});

describe('commitsInRange', () => {
  it('returns only the commits since the last release on main', () => {
    const { mainHead } = scenario();
    const last = findLastRelease(repo.dir, { head: 'main' });
    const commits = commitsInRange(repo.dir, last?.tag, 'main');
    expect(commits.map((c) => c.sha)).toEqual([mainHead]);
  });

  it('excludes the history of the release line from the maintenance range', () => {
    const { fix } = scenario();
    const commits = commitsInRange(repo.dir, 'v1.0.0', 'release/1.0.x');
    expect(commits.map((c) => c.sha)).toEqual([fix]);
  });

  it('returns the whole history, oldest first, when there is no release', () => {
    repo = new TempRepo();
    repo.commit('feat: one');
    repo.commit('fix: two\n\nBREAKING CHANGE: body');
    const commits = commitsInRange(repo.dir, undefined);
    expect(commits.map((c) => c.subject)).toEqual(['feat: one', 'fix: two']);
    expect(commits[1]?.body).toBe('BREAKING CHANGE: body');
  });
});
