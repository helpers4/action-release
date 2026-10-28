/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'vitest';
import { detectTargets, loadConfig } from '../src/lib/config.ts';
import { readVersion, setCargoVersion, setJsonVersion, updateCargoLock, writeVersion } from '../src/lib/manifests.ts';
import { DEFAULT_SINCE_FILES, replaceSince } from '../src/lib/since.ts';
import { TempRepo } from './helpers/repo.ts';

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

  it('reads the version of each kind of manifest', () => {
    repo = new TempRepo();
    repo.write('package.json', '{ "name": "a", "version": "1.0.0" }').write('Cargo.toml', '[package]\nname = "a"\nversion = "2.0.0"\n');
    expect(readVersion(repo.dir, 'package.json')).toBe('1.0.0');
    expect(readVersion(repo.dir, 'Cargo.toml')).toBe('2.0.0');
    expect(readVersion(repo.dir, 'jsr.json')).toBeUndefined();
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

  it('reads the configured targets, version files and since', () => {
    repo = new TempRepo();
    repo.write('packages/player/package.json', '{ "name": "folioscope" }');
    repo.write('.github/release.yml', [
      'targets:',
      '  - npm: ./packages/player/',
      '    build: pnpm --filter folioscope build',
      'version-files: [crates/core/Cargo.toml]',
      'since: { json: [api-since.json] }',
    ].join('\n'));
    const config = loadConfig(repo.dir, '.github/release.yml');
    expect(config.targets).toEqual([{ registry: 'npm', path: 'packages/player', manifest: 'packages/player/package.json', build: 'pnpm --filter folioscope build' }]);
    expect(config.versionFiles).toEqual(['crates/core/Cargo.toml']);
    expect(config.since).toEqual({ marker: 'next', files: DEFAULT_SINCE_FILES, json: ['api-since.json'] });
    expect(config.changelog).toBe('CHANGELOG.md');
  });

  it('explains a wrong target', () => {
    repo = new TempRepo();
    repo.write('.github/release.yml', 'targets:\n  - npm: a\n    crates: b\n');
    expect(() => loadConfig(repo!.dir, '.github/release.yml')).toThrow(/targets\[0\] must have exactly one of npm, crates, jsr/);
    repo.write('.github/release.yml', 'targets:\n  - jsr: lib\n');
    expect(() => loadConfig(repo!.dir, '.github/release.yml')).toThrow(/The jsr target "lib" has no jsr.json or deno.json or deno.jsonc/);
  });
});
