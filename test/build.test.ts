/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRelease, type BuildOptions } from '../src/lib/build.js';
import type { ReleaseManifest } from '../src/lib/manifest.js';
import { TempRepo } from './helpers/repo.js';

let repo: TempRepo;
const cleanup: string[] = [];
afterEach(() => {
  repo.dispose();
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const cliff = [new URL('../node_modules/.bin/git-cliff', import.meta.url).pathname];

const PACKAGE = {
  name: 'fixture-pkg',
  version: '0.0.0-development',
  scripts: { build: "node -e \"require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/hi.js','1')\"" },
  files: ['out'],
};

/** A repository holding a small npm package, with a lockfile so `npm ci` works. */
function fixture(extra: Record<string, string> = {}, pkg: object = PACKAGE): TempRepo {
  repo = new TempRepo();
  repo.write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  repo.write('.gitignore', 'out\ndist\nnode_modules\n');
  for (const [file, content] of Object.entries(extra)) repo.write(file, content);
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: repo.dir, stdio: 'ignore' });
  repo.git('add', '-A');
  repo.git('commit', '-q', '-m', 'feat: ✨ first feature');
  return repo;
}

function options(overrides: Partial<BuildOptions> = {}): BuildOptions {
  const outDir = mkdtempSync(join(tmpdir(), 'h4-out-'));
  cleanup.push(outDir);
  return {
    repoDir: repo.dir,
    outDir,
    bump: 'auto',
    packageRel: '',
    setup: '',
    build: '',
    registries: 'npm',
    carry: ['CHANGELOG.md'],
    prepare: '',
    includeBuild: 'auto',
    cliff,
    fetchVersions: async () => undefined,
    stdio: 'pipe',
    ...overrides,
  };
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');

describe('buildRelease', () => {
  it('computes the version, builds, packs and writes the release files', async () => {
    fixture();
    const opts = options();
    const manifest = (await buildRelease(opts)) as ReleaseManifest;

    expect(manifest.version).toBe('0.0.1');
    expect(manifest.tag).toBe('v0.0.1');
    expect(manifest.baseSha).toBe(repo.git('rev-parse', 'HEAD'));
    expect(manifest.distTag).toBe('latest');
    expect(manifest.latest).toBe(true);
    expect(manifest.tarball).toBe('fixture-pkg-0.0.1.tgz');
    expect(existsSync(join(opts.outDir, manifest.tarball))).toBe(true);
    expect(JSON.parse(read(opts.outDir, 'files/package.json')).version).toBe('0.0.1');
    expect(read(opts.outDir, 'files/CHANGELOG.md')).toContain('## [0.0.1]');
    expect(read(opts.outDir, 'notes.md')).toContain('first feature');
    expect(manifest.files).toEqual(['CHANGELOG.md', 'package.json']);
    expect(JSON.parse(read(opts.outDir, 'release.json'))).toEqual(JSON.parse(JSON.stringify(manifest)));
  });

  it('carries the changelog of the previous release and ranges from it', async () => {
    fixture();
    repo.release('v0.0.1', 'HEAD', {
      'CHANGELOG.md': '# Changelog\n\n## [0.0.1] - 2026-01-01\n\n- old entry\n',
    });
    repo.commit('fix: 🐛 later fix');
    const opts = options();
    const manifest = (await buildRelease(opts)) as ReleaseManifest;

    expect(manifest.version).toBe('0.0.2');
    expect(manifest.last).toBe('v0.0.1');
    const changelog = read(opts.outDir, 'files/CHANGELOG.md');
    expect(changelog.indexOf('## [0.0.2]')).toBeLessThan(changelog.indexOf('## [0.0.1]'));
    expect(changelog).toContain('old entry');
    expect(read(opts.outDir, 'notes.md')).not.toContain('first feature');
  });

  it('publishes a prerelease under its identifier', async () => {
    fixture();
    const manifest = (await buildRelease(options({ bump: 'beta' }))) as ReleaseManifest;
    expect(manifest.version).toBe('0.0.1-beta.0');
    expect(manifest.distTag).toBe('beta');
    expect(manifest.latest).toBe(false);
    expect(manifest.prerelease).toBe(true);
  });

  it('keeps latest away from an older line using the npm versions', async () => {
    fixture();
    const manifest = (await buildRelease(
      options({ bump: 'patch', fetchVersions: async () => ['0.0.1', '0.5.0'] }),
    )) as ReleaseManifest;
    expect(manifest.version).toBe('0.0.1');
    expect(manifest.distTag).toBe('release-0.0');
  });

  it('writes a resume marker without building', async () => {
    fixture();
    const opts = options({ bump: 'resume' });
    expect(await buildRelease(opts)).toEqual({ schema: 1, resume: true });
    expect(existsSync(join(opts.outDir, 'files'))).toBe(false);
  });

  it('stops when auto finds nothing to release', async () => {
    fixture();
    repo.release('v0.0.1');
    await expect(buildRelease(options())).rejects.toThrow(/nothing to release/);
  });

  it('refuses a prepare command that touches a file that is not carried', async () => {
    fixture({ 'src.txt': 'human' });
    await expect(
      buildRelease(options({ prepare: 'echo generated >> src.txt' })),
    ).rejects.toThrow(/not carried: src\.txt/);
  });

  it('lets prepare write carried files and passes RELEASE_VERSION', async () => {
    fixture();
    const opts = options({
      carry: ['CHANGELOG.md', 'since.json'],
      prepare: 'echo "{\\"v\\":\\"$RELEASE_VERSION\\"}" > since.json',
    });
    const manifest = (await buildRelease(opts)) as ReleaseManifest;
    expect(manifest.files).toContain('since.json');
    expect(JSON.parse(read(opts.outDir, 'files/since.json')).v).toBe('0.0.1');
  });

  it('fails when the tarball does not carry the release version', async () => {
    fixture(
      { 'dist/package.json': '{"name":"fixture-pkg","version":"9.9.9"}\n' },
      { ...PACKAGE, publishConfig: { directory: 'dist' } },
    );
    await expect(buildRelease(options({ build: 'true' }))).rejects.toThrow(/contains version 9\.9\.9/);
  });

  it('adds the build output to the files of an action repository', async () => {
    fixture({ 'action.yml': 'name: x\n' });
    const opts = options({ build: 'mkdir -p dist && echo bundle > dist/index.mjs' });
    const manifest = (await buildRelease(opts)) as ReleaseManifest;
    expect(manifest.files).toContain('dist/index.mjs');
    expect(read(opts.outDir, 'files/dist/index.mjs')).toBe('bundle\n');
  });

  it('does not include the build output of a regular package', async () => {
    fixture();
    const manifest = (await buildRelease(options({ build: 'mkdir -p dist && echo b > dist/x.js' }))) as ReleaseManifest;
    expect(manifest.files.some((f) => f.startsWith('dist/'))).toBe(false);
  });

  it('reads the package of a monorepo from its path', async () => {
    fixture({ 'packages/lib/package.json': JSON.stringify({ ...PACKAGE, name: 'mono-lib' }) });
    const opts = options({ packageRel: 'packages/lib' });
    const manifest = (await buildRelease(opts)) as ReleaseManifest;
    expect(manifest.package).toEqual({ name: 'mono-lib', dir: 'packages/lib' });
    expect(manifest.files).toContain('packages/lib/package.json');
    expect(JSON.parse(read(opts.outDir, 'files/packages/lib/package.json')).version).toBe('0.0.1');
  });
});
