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

/** A list input: one item per line (or separated by commas). */
const list = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Reads the configuration from the inputs of the action (`INPUT_TARGETS`, `INPUT_VERSION_FILES` …)
 * and completes it with what can be detected. `since-files` unset means the default globs; set
 * to an empty value, it replaces no marker.
 */
export function loadConfig(cwd: string, env: NodeJS.ProcessEnv): Config {
  const raw = env.INPUT_TARGETS?.trim() ? (parseYaml(env.INPUT_TARGETS) as unknown) : [];
  if (!Array.isArray(raw)) throw new ReleaseError('targets must be a YAML list, such as "- npm: packages/lib".');

  const targets = (raw as RawTarget[]).map((entry, i): Target => {
    const registries = REGISTRIES.filter((r) => typeof entry?.[r] === 'string');
    if (registries.length !== 1) {
      throw new ReleaseError(`targets[${i}] must have exactly one of ${REGISTRIES.join(', ')}.`);
    }
    const registry = registries[0]!;
    const dir = clean(entry[registry]!);
    return { registry, path: dir, manifest: manifestOf(cwd, registry, dir), ...(entry.build ? { build: entry.build } : {}) };
  });

  return {
    targets: targets.length > 0 ? targets : detectTargets(cwd),
    versionFiles: list(env.INPUT_VERSION_FILES ?? '').map(clean),
    changelog: clean(env.INPUT_CHANGELOG?.trim() || 'CHANGELOG.md'),
    since: {
      marker: env.INPUT_SINCE_MARKER?.trim() || 'next',
      files: env.INPUT_SINCE_FILES === undefined ? DEFAULT_SINCE_FILES : list(env.INPUT_SINCE_FILES),
      json: list(env.INPUT_SINCE_JSON ?? '').map(clean),
    },
    floatingMajor: env.INPUT_FLOATING_MAJOR?.trim() === 'true',
  };
}
