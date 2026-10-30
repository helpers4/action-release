/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A real git repository in a temporary directory. */
export class TempRepo {
  readonly dir = mkdtempSync(join(tmpdir(), 'h4-release-'));
  private count = 0;

  constructor() {
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'user.name', 'Test');
    this.git('config', 'commit.gpgsign', 'false');
    this.git('config', 'tag.gpgsign', 'false');
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8' }).trim();
  }

  write(path: string, content: string): this {
    const file = join(this.dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return this;
  }

  read(path: string): string {
    return readFileSync(join(this.dir, path), 'utf8');
  }

  /** Commits the given message, with a change so that the commit is never empty. */
  commit(message: string, files: Record<string, string> = {}): string {
    for (const [path, content] of Object.entries(files)) this.write(path, content);
    this.write('.count', String(++this.count));
    this.git('add', '-A');
    this.git('commit', '-q', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }

  tag(name: string): this {
    this.git('tag', name);
    return this;
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** A Cargo workspace like folioscope's: core, bake (needs core), cli (needs both) and wasm (`publish = false`). */
export function cargoWorkspace(version = '0.0.6'): Record<string, string> {
  const crate = (name: string, extra: string, deps: string) =>
    [
      '[package]',
      `name = "${name}"`,
      'description = "A crate"',
      'version.workspace = true',
      'edition.workspace = true',
      'license.workspace = true',
      'repository.workspace = true',
      extra,
      '[dependencies]',
      deps,
      '',
    ].join('\n');
  return {
    'Cargo.toml': [
      '[workspace]',
      'resolver = "3"',
      'members = ["crates/*"]',
      '',
      '[workspace.package]',
      `version = "${version}"`,
      'edition = "2024"',
      'license = "AGPL-3.0-or-later"',
      'repository = "https://github.com/baxyz/h4x"',
      '',
      '[workspace.dependencies]',
      `h4x-core = { path = "crates/core", version = "${version}" }`,
      `h4x-bake = { path = "crates/bake", version = "${version}" } # the baker`,
      '',
    ].join('\n'),
    'crates/core/Cargo.toml': crate('h4x-core', '', ''),
    'crates/core/src/lib.rs': 'pub fn a() {}\n',
    'crates/bake/Cargo.toml': crate('h4x-bake', '', 'h4x-core.workspace = true'),
    'crates/bake/src/lib.rs': 'pub fn b() {}\n',
    'crates/cli/Cargo.toml': crate('h4x', '', 'h4x-core.workspace = true\nh4x-bake.workspace = true'),
    'crates/cli/src/main.rs': 'fn main() {}\n',
    'crates/wasm/Cargo.toml': crate('h4x-wasm', 'publish = false', 'h4x-bake.workspace = true'),
    'crates/wasm/src/lib.rs': 'pub fn w() {}\n',
  };
}
