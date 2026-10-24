/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { parseCommit } from '../src/lib/conventional.js';
import { NothingToReleaseError, baseFromManifest, levelFromCommits, nextVersion } from '../src/lib/version.js';

const c = (subject: string, body = '') => ({ sha: 'x', subject, body });

describe('parseCommit', () => {
  it('parses type, scope and breaking marker', () => {
    expect(parseCommit(c('feat(api)!: ✨ add thing'))).toEqual({
      type: 'feat', scope: 'api', breaking: true, description: '✨ add thing',
    });
  });
  it('detects a BREAKING CHANGE footer', () => {
    expect(parseCommit(c('fix: x', 'details\n\nBREAKING CHANGE: gone'))?.breaking).toBe(true);
  });
  it('rejects other messages', () => {
    expect(parseCommit(c('Merge pull request #1'))).toBeUndefined();
  });
});

describe('levelFromCommits', () => {
  it('maps feat to minor and breaking to major from 1.0.0', () => {
    expect(levelFromCommits([c('fix: a'), c('feat: b')], '1.2.3')).toBe('minor');
    expect(levelFromCommits([c('feat!: b')], '1.2.3')).toBe('major');
    expect(levelFromCommits([c('chore: a')], '1.2.3')).toBe('patch');
  });
  it('maps feat to patch and breaking to minor before 1.0.0', () => {
    expect(levelFromCommits([c('feat: b')], '0.2.4')).toBe('patch');
    expect(levelFromCommits([c('feat!: b')], '0.2.4')).toBe('minor');
    expect(levelFromCommits([c('fix: a', 'BREAKING CHANGE: x')], '0.0.7')).toBe('minor');
  });
});

describe('baseFromManifest', () => {
  it('drops the prerelease suffix of a placeholder', () => {
    expect(baseFromManifest('0.0.0-development')).toBe('0.0.0');
    expect(baseFromManifest('0.2.4')).toBe('0.2.4');
    expect(baseFromManifest(undefined)).toBe('0.0.0');
    expect(baseFromManifest('garbage')).toBe('0.0.0');
  });
});

describe('nextVersion', () => {
  const base = { hasRelease: true, existing: [] as string[] };

  it('applies explicit bumps literally, even before 1.0.0', () => {
    expect(nextVersion({ ...base, base: '0.2.4', bump: 'minor', commits: [] })).toBe('0.3.0');
    expect(nextVersion({ ...base, base: '0.2.4', bump: 'major', commits: [] })).toBe('1.0.0');
    expect(nextVersion({ ...base, base: '1.2.3', bump: 'patch', commits: [] })).toBe('1.2.4');
  });

  it('derives auto from commits', () => {
    expect(nextVersion({ ...base, base: '1.2.3', bump: 'auto', commits: [c('feat: a')] })).toBe('1.3.0');
    expect(nextVersion({ ...base, base: '0.2.4', bump: 'auto', commits: [c('feat: a')] })).toBe('0.2.5');
    expect(nextVersion({ ...base, base: '0.2.4', bump: 'auto', commits: [c('feat!: a')] })).toBe('0.3.0');
  });

  it('refuses auto without commits but allows a first release', () => {
    expect(() => nextVersion({ ...base, base: '1.0.0', bump: 'auto', commits: [] })).toThrow(NothingToReleaseError);
    expect(nextVersion({ base: '0.0.0', bump: 'auto', commits: [c('feat: a')], hasRelease: false, existing: [] })).toBe('0.0.1');
  });

  it('numbers prereleases from the highest existing one of the same target', () => {
    const input = { ...base, base: '1.2.3', commits: [c('feat: a')] };
    expect(nextVersion({ ...input, bump: 'beta' })).toBe('1.3.0-beta.1');
    expect(nextVersion({ ...input, bump: 'beta', existing: ['1.3.0-beta.1', '1.3.0-beta.2', '1.2.3'] })).toBe('1.3.0-beta.3');
    expect(nextVersion({ ...input, bump: 'rc', existing: ['1.3.0-beta.2'] })).toBe('1.3.0-rc.1');
  });

  it('counts prereleases of other lines too, but only for the same target', () => {
    const input = { ...base, base: '1.2.3', commits: [c('feat: a')], bump: 'beta' as const };
    expect(nextVersion({ ...input, existing: ['1.4.0-beta.9'] })).toBe('1.3.0-beta.1');
  });

  it('starts a new target when a breaking change arrives', () => {
    expect(nextVersion({ ...base, base: '1.2.3', bump: 'alpha', commits: [c('feat!: a')], existing: ['1.3.0-alpha.1'] })).toBe('2.0.0-alpha.1');
  });

  it('builds prereleases before 1.0.0 on the pre-1.0 rule', () => {
    expect(nextVersion({ ...base, base: '0.2.4', bump: 'beta', commits: [c('feat: a')] })).toBe('0.2.5-beta.1');
  });
});
