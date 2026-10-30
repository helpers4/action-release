/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'vitest';
import { detectTargets, loadConfig } from '../src/lib/config.ts';
import { readVersion, setCargoVersion, setInternalVersions, setJsonVersion, updateCargoLock, writeVersion } from '../src/lib/manifests.ts';
import { crateProblems, dryRun, dryRunCrates, oversizedCrates, versionToPublish } from '../src/lib/registries.ts';
import { DEFAULT_SINCE_FILES, replaceSince } from '../src/lib/since.ts';
import { cargoWorkspace, TempRepo } from './helpers/repo.ts';

let repo: TempRepo | undefined;
afterEach(() => repo?.dispose());

describe('setJsonVersion', () => {
  it('replaces the version and keeps the formatting', () => {
    const text = '{\n    "name": "pkg",\n    "version": "0.0.0",\n    "dependencies": { "x": { "version": "9" } }\n}\n';
    expect(setJsonVersion(text, '1.2.3', 'package.json')).toBe(text.replace('"0.0.0"', '"1.2.3"'));
  });

  it('adds the version after the name when missing, and reads JSONC', () => {
    const out = setJsonVersion('{\n  // the package\n  "name": "@h4/pkg",\n  "exports": "./mod.ts"\n}\n', '0.1.0', 'deno.jsonc');
    expect(out).toContain('"name": "@h4/pkg",\n  "version": "0.1.0",\n  "exports"');
  });
});

describe('setCargoVersion', () => {
  const toml = '[package]\nname = "h4"\nversion = "0.0.9" # kept\nedition = "2021"\n\n[dependencies]\nserde = { version = "1" }\n';

  it('replaces the version of the section only', () => {
    expect(setCargoVersion(toml, '0.1.0', 'package', 'Cargo.toml')).toBe(toml.replace('"0.0.9"', '"0.1.0"'));
  });

  it('fails clearly without a version', () => {
    expect(() => setCargoVersion('[package]\nname = "h4"\n', '1.0.0', 'package', 'Cargo.toml')).toThrow(/no version in \[package\]/);
  });
});

describe('writeVersion and Cargo.lock', () => {
  it('writes the workspace version when the crate inherits it, then refreshes the lock with cargo', () => {
    repo = new TempRepo();
    repo.commit('chore: init', {
      'Cargo.toml': '[workspace]\nmembers = ["crates/core"]\nresolver = "2"\n\n[workspace.package]\nversion = "0.1.0"\n',
      'crates/core/Cargo.toml': '[package]\nname = "h4-core"\nversion.workspace = true\nedition = "2021"\n',
      'crates/core/src/lib.rs': 'pub fn a() {}\n',
    });
    repo.git('rm', '-q', '--cached', '.count');
    expect(writeVersion(repo.dir, 'crates/core/Cargo.toml', '0.2.0')).toEqual(['Cargo.toml']);
    expect(repo.read('Cargo.toml')).toContain('[workspace.package]\nversion = "0.2.0"');
    repo.write('Cargo.lock', '');
    expect(updateCargoLock(repo.dir, 'crates/core/Cargo.toml')).toEqual(['Cargo.lock']);
    expect(repo.read('Cargo.lock')).toMatch(/name = "h4-core"\nversion = "0\.2\.0"/);
  });

  it('reads the version cargo will publish, inherited from the workspace', () => {
    repo = new TempRepo();
    repo.write('Cargo.toml', '[workspace]\nmembers = ["crates/core"]\nresolver = "2"\n\n[workspace.package]\nversion = "0.3.0"\n');
    repo.write('crates/core/Cargo.toml', '[package]\nname = "h4-core"\nversion.workspace = true\nedition = "2021"\n');
    repo.write('crates/core/src/lib.rs', 'pub fn a() {}\n');
    expect(readVersion(repo.dir, 'crates/core/Cargo.toml')).toBeUndefined();
    expect(versionToPublish({ registry: 'crates', path: 'crates/core', manifest: 'crates/core/Cargo.toml' }, repo.dir)).toBe('0.3.0');
  });

  it('never publishes an npm tarball of another version', () => {
    repo = new TempRepo();
    repo.write('package.json', '{ "name": "h4-pack-test", "version": "0.0.0-development" }');
    const target = { registry: 'npm' as const, path: '.', manifest: 'package.json' };
    expect(() => dryRun(target, '0.0.5', 'latest', { cwd: repo!.dir, env: process.env, log: () => {} })).toThrow(/has version 0\.0\.0-development, not 0\.0\.5: it is not published/);
  });

  it('reads the version of each kind of manifest', () => {
    repo = new TempRepo();
    repo.write('package.json', '{ "name": "a", "version": "1.0.0" }').write('Cargo.toml', '[package]\nname = "a"\nversion = "2.0.0"\n');
    expect(readVersion(repo.dir, 'package.json')).toBe('1.0.0');
    expect(readVersion(repo.dir, 'Cargo.toml')).toBe('2.0.0');
    expect(readVersion(repo.dir, 'jsr.json')).toBeUndefined();
  });
});

describe('crates of a workspace', () => {
  const names = new Set(['h4x-core', 'h4x-bake']);

  it('sets the version of the dependencies on the crates released together', () => {
    const text = [
      '[workspace.dependencies]',
      'h4x-core = { path = "crates/core", version = "0.0.6" }',
      'h4x-bake = { path = "crates/bake", version = "0.0.6" } # the baker',
      'other = { path = "crates/other", version = "0.0.6" }',
      'serde = { version = "1", features = ["derive"] }',
      'renamed = { package = "h4x-core", path = "../core", version = "0.0.6", rust-version = "1.80" }',
      'h4x-core = "0.0.6"',
    ].join('\n');
    expect(setInternalVersions(text, names, '0.1.0').split('\n')).toEqual([
      '[workspace.dependencies]',
      'h4x-core = { path = "crates/core", version = "0.1.0" }',
      'h4x-bake = { path = "crates/bake", version = "0.1.0" } # the baker',
      'other = { path = "crates/other", version = "0.0.6" }',
      'serde = { version = "1", features = ["derive"] }',
      'renamed = { package = "h4x-core", path = "../core", version = "0.1.0", rust-version = "1.80" }',
      'h4x-core = "0.0.6"',
    ]);
  });

  it('expands crates: . into the members that may go to crates.io, building once', () => {
    repo = new TempRepo();
    for (const [path, content] of Object.entries(cargoWorkspace())) repo.write(path, content);
    const config = loadConfig(repo.dir, { INPUT_TARGETS: '- crates: .\n  build: echo built\n' });
    expect(config.targets.map((t) => t.manifest).sort()).toEqual(['crates/bake/Cargo.toml', 'crates/cli/Cargo.toml', 'crates/core/Cargo.toml']);
    expect(config.targets.filter((t) => t.build)).toHaveLength(1);
    expect(config.targets.every((t) => t.registry === 'crates' && t.path === t.manifest.replace('/Cargo.toml', ''))).toBe(true);

    repo.write('Cargo.toml', '[workspace]\nmembers = ["crates/wasm"]\nresolver = "3"\n');
    repo.write('crates/wasm/Cargo.toml', '[package]\nname = "h4x-wasm"\nversion = "0.0.1"\nedition = "2024"\npublish = false\n');
    expect(() => loadConfig(repo!.dir, { INPUT_TARGETS: '- crates: .\n' })).toThrow(/every crate has publish = false/);
  });

  it('refuses a crate crates.io would refuse, before anything is written', () => {
    repo = new TempRepo();
    const files = cargoWorkspace();
    files['crates/core/Cargo.toml'] = files['crates/core/Cargo.toml']!.replace('description = "A crate"\n', '');
    files['crates/bake/Cargo.toml'] = files['crates/bake/Cargo.toml']!.replace('repository.workspace = true\n', '').replace('license.workspace = true\n', '');
    for (const [path, content] of Object.entries(files)) repo.write(path, content);
    const targets = ['core', 'bake'].map((dir) => ({ registry: 'crates' as const, path: `crates/${dir}`, manifest: `crates/${dir}/Cargo.toml`, name: `h4x-${dir}` }));
    const { problems, warnings } = crateProblems(targets, repo.dir);
    expect(problems).toEqual([expect.stringMatching(/h4x-core: no description/), expect.stringMatching(/h4x-bake: no license/)]);
    expect(warnings).toEqual([expect.stringMatching(/h4x-bake: no repository/)]);
  });

  it('dry-runs the crates together, even when the first one is not on crates.io yet', () => {
    repo = new TempRepo();
    for (const [path, content] of Object.entries(cargoWorkspace())) repo.write(path, content);
    const targets = ['core', 'bake', 'cli'].map((dir) => ({
      registry: 'crates' as const,
      path: `crates/${dir}`,
      manifest: `crates/${dir}/Cargo.toml`,
      name: dir === 'cli' ? 'h4x' : `h4x-${dir}`,
    }));
    const logs: string[] = [];
    dryRunCrates(targets, { cwd: repo.dir, env: { ...process.env }, log: (m) => logs.push(m) });
    expect(oversizedCrates(targets, '0.0.6', repo.dir)).toEqual([]);
  });
});

describe('replaceSince', () => {
  it('replaces the markers in tracked sources and in the JSON maps', () => {
    repo = new TempRepo();
    repo.commit('feat: a', {
      'src/a.ts': '/**\n * @since next\n */\nexport const a = 1; // @since nextgen stays\n',
      'src/lib.rs': '/// @since next\npub fn b() {}\n',
      'README.md': '@since next is documented here\n',
      'api-since.json': '{\n  "a": "0.0.1",\n  "b": "next"\n}\n',
    });
    const changed = replaceSince(repo.dir, repo.git('ls-files').split('\n'), { marker: 'next', files: DEFAULT_SINCE_FILES, json: ['api-since.json'] }, '0.1.0');
    expect(changed.sort()).toEqual(['api-since.json', 'src/a.ts', 'src/lib.rs']);
    expect(repo.read('src/a.ts')).toBe('/**\n * @since 0.1.0\n */\nexport const a = 1; // @since nextgen stays\n');
    expect(repo.read('api-since.json')).toContain('"b": "0.1.0"');
    expect(repo.read('README.md')).toContain('@since next');
  });
});

describe('config', () => {
  it('detects the targets at the root', () => {
    repo = new TempRepo();
    repo.write('package.json', '{ "name": "a", "version": "1.0.0" }');
    repo.write('Cargo.toml', '[package]\nname = "a"\nversion = "1.0.0"\n');
    repo.write('jsr.json', '{ "name": "@h4/a", "version": "1.0.0", "exports": "./mod.ts" }');
    expect(detectTargets(repo.dir).map((t) => `${t.registry}:${t.manifest}`)).toEqual(['npm:package.json', 'crates:Cargo.toml', 'jsr:jsr.json']);
  });

  it('skips private and unpublished packages', () => {
    repo = new TempRepo();
    repo.write('package.json', '{ "name": "a", "private": true }');
    repo.write('Cargo.toml', '[package]\nname = "a"\nversion = "1.0.0"\npublish = false\n');
    expect(detectTargets(repo.dir)).toEqual([]);
  });

  it('reads the targets, version files and since from the inputs', () => {
    repo = new TempRepo();
    repo.write('packages/player/package.json', '{ "name": "folioscope" }');
    const config = loadConfig(repo.dir, {
      INPUT_TARGETS: '- npm: ./packages/player/\n  build: pnpm --filter folioscope build\n',
      INPUT_VERSION_FILES: 'crates/core/Cargo.toml\n',
      INPUT_SINCE_JSON: 'api-since.json',
      INPUT_CHANGELOG: '',
    });
    expect(config.targets).toEqual([{ registry: 'npm', path: 'packages/player', manifest: 'packages/player/package.json', build: 'pnpm --filter folioscope build' }]);
    expect(config.versionFiles).toEqual(['crates/core/Cargo.toml']);
    expect(config.since).toEqual({ marker: 'next', files: DEFAULT_SINCE_FILES, json: ['api-since.json'] });
    expect(config.changelog).toBe('CHANGELOG.md');
    expect(config.floatingMajor).toBe(false);
    expect(loadConfig(repo.dir, { INPUT_SINCE_FILES: '' }).since.files).toEqual([]);
    expect(loadConfig(repo.dir, { INPUT_SINCE_FILES: 'src/**/*.ts, lib/*.rs' }).since.files).toEqual(['src/**/*.ts', 'lib/*.rs']);
  });

  it('explains a wrong target', () => {
    repo = new TempRepo();
    expect(() => loadConfig(repo!.dir, { INPUT_TARGETS: 'npm: a' })).toThrow(/targets must be a YAML list/);
    expect(() => loadConfig(repo!.dir, { INPUT_TARGETS: '- npm: a\n  crates: b\n' })).toThrow(/targets\[0\] must have exactly one of npm, crates, jsr/);
    expect(() => loadConfig(repo!.dir, { INPUT_TARGETS: '- jsr: lib\n' })).toThrow(/The jsr target "lib" has no jsr.json or deno.json or deno.jsonc/);
  });
});
