/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { distTagFor } from '../src/lib/dist-tag.js';
import { parseRegistries, planResume } from '../src/lib/registries.js';

describe('distTagFor', () => {
  it('uses latest for the highest stable version', () => {
    expect(distTagFor('1.3.0', ['1.2.3', '1.0.0'])).toEqual({ tag: 'latest', latest: true });
    expect(distTagFor('0.0.1', [])).toEqual({ tag: 'latest', latest: true });
  });
  it('ignores published prereleases when deciding latest', () => {
    expect(distTagFor('1.2.3', ['1.2.2', '1.3.0-beta.1']).tag).toBe('latest');
  });
  it('never uses latest for a prerelease', () => {
    expect(distTagFor('1.3.0-beta.2', [])).toEqual({ tag: 'beta', latest: false });
    expect(distTagFor('2.0.0-rc.1', ['1.2.3']).tag).toBe('rc');
  });
  it('uses a line tag for a version below the highest published', () => {
    expect(distTagFor('1.0.1', ['1.2.3', '1.0.0'])).toEqual({ tag: 'release-1.0', latest: false });
    expect(distTagFor('1.2.3', ['1.2.3']).tag).toBe('release-1.2');
  });
});

describe('parseRegistries', () => {
  it('parses lists and optional markers', () => {
    expect(parseRegistries('npm')).toEqual([{ name: 'npm', optional: false }]);
    expect(parseRegistries('npm?')).toEqual([{ name: 'npm', optional: true }]);
  });
  it('rejects unknown, empty and mixed targets', () => {
    expect(() => parseRegistries('jsr')).toThrow(/Unknown registry/);
    expect(() => parseRegistries(' ')).toThrow(/empty/);
    expect(() => parseRegistries('npm, none')).toThrow(/cannot be combined/);
  });
});

describe('planResume', () => {
  const npm = parseRegistries('npm');
  it('keeps what is missing', () => {
    expect(planResume(npm, {})).toEqual({ pending: npm, complete: false });
  });
  it('is idempotent once everything is published', () => {
    const plan = planResume(npm, { npm: true });
    expect(plan).toEqual({ pending: [], complete: true });
    expect(planResume(npm, { npm: true })).toEqual(plan);
  });
  it('does not block on an optional registry', () => {
    expect(planResume(parseRegistries('npm?'), {}).complete).toBe(true);
  });
  it('has nothing to publish for the none target', () => {
    expect(planResume(parseRegistries('none'), {})).toEqual({ pending: [], complete: true });
  });
});
