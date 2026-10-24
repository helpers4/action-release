/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkRepo } from '../src/lib/check.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'h4-check-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const base = { packageRel: '', registries: 'npm', includeBuild: 'auto' };
const codes = (dir: string, extra = {}) => checkRepo({ repoDir: dir, ...base, ...extra }).map((p) => `${p.level}:${p.code}`);

describe('checkRepo', () => {
  it('passes a well-formed repository', () => {
    const dir = repo({ 'package.json': '{"name":"x","version":"0.0.0-development"}', 'package-lock.json': '{}' });
    expect(codes(dir)).toEqual([]);
  });
  it('reports a real version, an Unreleased changelog and a missing lockfile as warnings', () => {
    const dir = repo({ 'package.json': '{"name":"x","version":"0.2.4"}', 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' });
    expect(codes(dir).sort()).toEqual(['warning:changelog-unreleased', 'warning:no-lockfile', 'warning:placeholder-version']);
  });
  it('reports blocking mistakes as errors', () => {
    expect(codes(repo({ 'package.json': '{"version":"0.0.0","private":true}', 'package-lock.json': '{}' }))).toEqual([
      'error:no-name',
      'error:private-package',
    ]);
    expect(codes(repo({ 'package.json': '{"name":"x"}', 'package-lock.json': '{}' }), { registries: 'jsr' })).toEqual(['error:invalid-registries']);
    expect(codes(repo({ 'package.json': '{"name":"x"}', 'package-lock.json': '{}' }), { includeBuild: 'true' })).toEqual(['error:include-build']);
    expect(codes(repo({}), { packageRel: 'pkg' })).toEqual(['error:no-package']);
  });
  it('allows a private package for the none target', () => {
    const dir = repo({ 'package.json': '{"name":"x","private":true}', 'package-lock.json': '{}' });
    expect(codes(dir, { registries: 'none' })).toEqual([]);
  });
});
