/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectTooling, nodeVersionFile } from '../src/lib/detect.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'h4-detect-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('detectTooling', () => {
  it('reads pnpm from the packageManager field and the build script', async () => {
    const dir = project({
      'package.json': JSON.stringify({
        name: 'x',
        packageManager: 'pnpm@11.8.0',
        scripts: { build: 'tsc' },
        publishConfig: { directory: 'dist' },
      }),
    });
    const tooling = await detectTooling(dir, dir);
    expect(tooling).toMatchObject({ pm: 'pnpm', pinned: true, hasBuildScript: true, publishDir: 'dist' });
  });

  it('falls back to the lockfile, then to npm', async () => {
    const yarn = project({ 'package.json': '{"name":"x"}', 'yarn.lock': '' });
    expect((await detectTooling(yarn, yarn)).pm).toBe('yarn');
    const none = project({ 'package.json': '{"name":"x"}' });
    const tooling = await detectTooling(none, none);
    expect(tooling).toMatchObject({ pm: 'npm', pinned: false, hasBuildScript: false });
  });

  it('finds the lockfile of a monorepo root from the package', async () => {
    const root = project({ 'package.json': '{"name":"root"}', 'pnpm-lock.yaml': '' });
    const pkg = join(root, 'packages');
    mkdirSync(pkg);
    writeFileSync(join(pkg, 'package.json'), '{"name":"p"}');
    expect((await detectTooling(root, pkg)).pm).toBe('pnpm');
  });
});

describe('nodeVersionFile', () => {
  it('prefers dedicated files over package.json', () => {
    const dir = project({ '.nvmrc': '22', 'package.json': '{"engines":{"node":">=20"}}' });
    expect(nodeVersionFile([dir])).toBe(join(dir, '.nvmrc'));
  });
  it('uses engines.node or devEngines.runtime', () => {
    expect(nodeVersionFile([project({ 'package.json': '{"engines":{"node":">=20"}}' })])).toMatch(/package\.json$/);
    expect(nodeVersionFile([project({ 'package.json': '{"devEngines":{"runtime":{"name":"node"}}}' })])).toMatch(/package\.json$/);
  });
  it('returns undefined when nothing declares a version', () => {
    expect(nodeVersionFile([project({ 'package.json': '{}' })])).toBeUndefined();
  });
});
