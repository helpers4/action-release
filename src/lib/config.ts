/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { cargoPublishes, JSR_MANIFESTS } from './manifests.ts';
import { DEFAULT_SINCE_FILES, type SinceConfig } from './since.ts';
import { ReleaseError } from './version.ts';

export const REGISTRIES = ['npm', 'crates', 'jsr'] as const;
export type Registry = (typeof REGISTRIES)[number];

export interface Target {
  registry: Registry;
  /** Directory of the package, relative to the repository root (`.` for the root). */
  path: string;
  /** Manifest that carries the version (package.json, Cargo.toml, jsr.json or deno.json). */
  manifest: string;
  /** Command run before the dry-run and the publication (the project's build). */
  build?: string;
}

export interface Config {
  targets: Target[];
  /** Other manifests that carry the version without being published. */
  versionFiles: string[];
  changelog: string;
  since: SinceConfig;
  /** Move the major tag (`v1`) to each stable release, as GitHub Actions are referenced. */
  floatingMajor: boolean;
}

interface RawTarget {
  npm?: string;
  crates?: string;
  jsr?: string;
  build?: string;
}

interface RawConfig {
  targets?: RawTarget[];
  'version-files'?: string[];
  changelog?: string;
  since?: { marker?: string; files?: string[]; json?: string[] };
  'floating-major'?: boolean;
}

const clean = (path: string) => posix.normalize(path.replace(/^\.\/+/, '').replace(/\/+$/, '') || '.');

function manifestOf(cwd: string, registry: Registry, path: string): string {
  const candidates = registry === 'npm' ? ['package.json'] : registry === 'crates' ? ['Cargo.toml'] : JSR_MANIFESTS;
  const found = candidates.map((name) => posix.join(path, name)).find((file) => existsSync(join(cwd, file)));
  if (!found) {
    throw new ReleaseError(`The ${registry} target "${path}" has no ${candidates.join(' or ')}.`);
  }
  return found;
}

/** Targets found at the repository root when the configuration lists none. */
export function detectTargets(cwd: string): Target[] {
  const targets: Target[] = [];
  const pkg = join(cwd, 'package.json');
  if (existsSync(pkg) && (JSON.parse(readFileSync(pkg, 'utf8')) as { private?: boolean }).private !== true) {
    targets.push({ registry: 'npm', path: '.', manifest: 'package.json' });
  }
  const cargo = join(cwd, 'Cargo.toml');
  if (existsSync(cargo)) {
    const text = readFileSync(cargo, 'utf8');
    if (text.includes('[package]') && cargoPublishes(text)) targets.push({ registry: 'crates', path: '.', manifest: 'Cargo.toml' });
  }
  const jsr = JSR_MANIFESTS.find((name) => existsSync(join(cwd, name)) && /"name"\s*:/.test(readFileSync(join(cwd, name), 'utf8')));
  if (jsr) targets.push({ registry: 'jsr', path: '.', manifest: jsr });
  return targets;
}

/** Reads the configuration file (optional) and completes it with what can be detected. */
export function loadConfig(cwd: string, file: string): Config {
  const path = join(cwd, file);
  const raw: RawConfig = existsSync(path) ? ((parseYaml(readFileSync(path, 'utf8')) as RawConfig | null) ?? {}) : {};

  const targets = (raw.targets ?? []).map((entry, i): Target => {
    const registries = REGISTRIES.filter((r) => typeof entry[r] === 'string');
    if (registries.length !== 1) {
      throw new ReleaseError(`${file}: targets[${i}] must have exactly one of ${REGISTRIES.join(', ')}.`);
    }
    const registry = registries[0]!;
    const dir = clean(entry[registry]!);
    return { registry, path: dir, manifest: manifestOf(cwd, registry, dir), ...(entry.build ? { build: entry.build } : {}) };
  });

  return {
    targets: targets.length > 0 ? targets : detectTargets(cwd),
    versionFiles: (raw['version-files'] ?? []).map(clean),
    changelog: clean(raw.changelog ?? 'CHANGELOG.md'),
    since: {
      marker: raw.since?.marker ?? 'next',
      files: raw.since?.files ?? DEFAULT_SINCE_FILES,
      json: (raw.since?.json ?? []).map(clean),
    },
    floatingMajor: raw['floating-major'] === true,
  };
}
