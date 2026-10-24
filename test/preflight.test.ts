/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { blockingRulesets, matchesRef, workflowsUnchanged } from '../src/lib/preflight.js';
import { FakeGh } from './helpers/fake-gh.js';

describe('matchesRef', () => {
  it('matches fnmatch-like patterns', () => {
    expect(matchesRef('refs/tags/v*', 'refs/tags/v1.2.3')).toBe(true);
    expect(matchesRef('refs/tags/v*', 'refs/tags/x1')).toBe(false);
    expect(matchesRef('refs/tags/**', 'refs/tags/a/b')).toBe(true);
    expect(matchesRef('refs/tags/v1.2.3', 'refs/tags/v1x2x3')).toBe(false);
    expect(matchesRef('~ALL', 'refs/tags/anything')).toBe(true);
  });
});

describe('blockingRulesets', () => {
  const rule = { name: 'r', blocksCreation: true, include: ['refs/tags/v*'], exclude: [] as string[], hasBypass: false };
  it('keeps rulesets that forbid creating the tag', () => {
    expect(blockingRulesets([rule], 'v1.0.0')).toHaveLength(1);
  });
  it('ignores rulesets that do not apply or do not restrict creation', () => {
    expect(blockingRulesets([{ ...rule, include: ['refs/tags/release-*'] }], 'v1.0.0')).toHaveLength(0);
    expect(blockingRulesets([{ ...rule, exclude: ['refs/tags/v*'] }], 'v1.0.0')).toHaveLength(0);
    expect(blockingRulesets([{ ...rule, blocksCreation: false }], 'v1.0.0')).toHaveLength(0);
  });
});

describe('workflowsUnchanged', () => {
  it('is true when the branch head is the tested commit', async () => {
    const gh = new FakeGh();
    expect(await workflowsUnchanged(gh, 'base0', 'main')).toBe(true);
  });
  it('compares the workflow trees when the branch moved', async () => {
    const gh = new FakeGh();
    gh.branches.main = 'head1';
    gh.workflows = { base0: 'a', head1: 'a' };
    expect(await workflowsUnchanged(gh, 'base0', 'main')).toBe(true);
    gh.workflows.head1 = 'b';
    expect(await workflowsUnchanged(gh, 'base0', 'main')).toBe(false);
  });
  it('treats two commits without workflows as identical', async () => {
    const gh = new FakeGh();
    gh.branches.main = 'head1';
    expect(await workflowsUnchanged(gh, 'base0', 'main')).toBe(true);
  });
});
