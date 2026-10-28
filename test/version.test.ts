/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import type { Commit } from '../src/lib/git.ts';
import { assertNew, levelFromCommits, nextVersion, versionsOfTags, type NextVersionInput } from '../src/lib/version.ts';

const c = (subject: string, body = ''): Commit => ({ sha: subject, subject, body });

const input = (over: Partial<NextVersionInput>): NextVersionInput => ({
  bump: 'auto',
  merged: ['1.2.3'],
  all: ['1.2.3'],
  commitsSinceStable: [c('fix: a')],
  commitsSinceLast: [c('fix: a')],
  manifestVersion: '1.2.3',
  ...over,
});

describe('levelFromCommits', () => {
  it('follows Conventional Commits from 1.0.0', () => {
    expect(levelFromCommits([c('fix: a')], '1.0.0')).toBe('patch');
    expect(levelFromCommits([c('fix: a'), c('feat: b')], '1.0.0')).toBe('minor');
    expect(levelFromCommits([c('feat!: b')], '1.0.0')).toBe('major');
    expect(levelFromCommits([c('fix: a', 'BREAKING CHANGE: gone')], '1.0.0')).toBe('major');
  });

  it('shifts every level down before 1.0.0', () => {
    expect(levelFromCommits([c('feat: b')], '0.2.4')).toBe('patch');
    expect(levelFromCommits([c('feat!: b')], '0.2.4')).toBe('minor');
  });
});

describe('versionsOfTags', () => {
  it('keeps valid versions, highest first', () => {
    expect(versionsOfTags(['v1.9.0', 'v1.10.0', 'vnext', 'v1.10.0-beta.0'])).toEqual(['1.10.0', '1.10.0-beta.0', '1.9.0']);
  });
});

describe('nextVersion', () => {
  it('computes auto from the last stable release', () => {
    expect(nextVersion(input({ commitsSinceStable: [c('feat: a')] })).version).toBe('1.3.0');
    expect(nextVersion(input({})).previous).toBe('1.2.3');
  });

  it('forces a level, even without commits', () => {
    expect(nextVersion(input({ bump: 'major', commitsSinceLast: [] })).version).toBe('2.0.0');
  });

  it('refuses to release nothing', () => {
    expect(() => nextVersion(input({ commitsSinceLast: [] }))).toThrow(/Nothing to release: no commit since v1.2.3/);
  });

  it('numbers prereleases from .0 across all tags of the same target', () => {
    const feat = { commitsSinceStable: [c('feat: a')] };
    expect(nextVersion(input({ ...feat, bump: 'beta' })).version).toBe('1.3.0-beta.0');
    expect(nextVersion(input({ ...feat, bump: 'beta', all: ['1.2.3', '1.3.0-beta.0', '1.3.0-beta.1'] })).version).toBe('1.3.0-beta.2');
    expect(nextVersion(input({ ...feat, bump: 'rc', all: ['1.3.0-beta.1'] })).version).toBe('1.3.0-rc.0');
    expect(nextVersion(input({ ...feat, bump: 'beta', all: ['1.4.0-beta.3'] })).version).toBe('1.3.0-beta.0');
  });

  it('turns a prerelease line into its stable version with auto', () => {
    const v = nextVersion(input({ merged: ['1.3.0-beta.1', '1.2.3'], commitsSinceStable: [c('feat: a'), c('fix: b')] }));
    expect(v).toEqual({ version: '1.3.0', previous: '1.3.0-beta.1' });
  });

  it('starts from the manifest version when there is no tag', () => {
    const none = { merged: [], all: [], manifestVersion: '0.2.0' };
    expect(nextVersion(input({ ...none, commitsSinceStable: [c('feat: a')] })).version).toBe('0.2.1');
    expect(nextVersion(input({ ...none, manifestVersion: undefined })).version).toBe('0.0.1');
    expect(() => nextVersion(input({ ...none, manifestVersion: 'next' }))).toThrow(/not a valid SemVer/);
  });
});

describe('assertNew', () => {
  it('refuses a version that already has a tag', () => {
    expect(() => assertNew('1.2.3', ['1.2.3'])).toThrow(/v1.2.3 already exists.*resume/);
    expect(() => assertNew('1.2.4', ['1.2.3'])).not.toThrow();
  });
});
