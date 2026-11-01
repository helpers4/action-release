/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Target } from './config.ts';
import { ReleaseError } from './version.ts';

interface Manifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * The npm packages a `dir/*` target stands for, once the build generated them. The private ones
 * are left out. A package that depends on another of the release goes after it (a bundle after
 * its categories), as cargo does for the crates; the others keep the alphabetical order.
 */
export function expandGenerated(cwd: string, target: Target): Target[] {
  const root = target.path.slice(0, -2);
  const dir = join(cwd, root);
  const found = existsSync(dir)
    ? readdirSync(dir)
        .sort()
        .filter((entry) => statSync(join(dir, entry)).isDirectory() && existsSync(join(dir, entry, 'package.json')))
        .map((entry) => ({ entry, manifest: JSON.parse(readFileSync(join(dir, entry, 'package.json'), 'utf8')) as Manifest }))
        .filter(({ manifest }) => manifest.private !== true)
    : [];
  if (found.length === 0) {
    throw new ReleaseError(`The build generated no package in ${root}/ (${target.path} expects ${root}/<package>/package.json). Nothing was written.`);
  }

  const names = new Set(found.map(({ manifest }) => manifest.name));
  const needs = (manifest: Manifest) =>
    Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies }).filter((name) => names.has(name) && name !== manifest.name);
  const ordered: typeof found = [];
  const placed = new Set<string | undefined>();
  while (ordered.length < found.length) {
    const ready = found.filter((p) => !ordered.includes(p) && needs(p.manifest).every((name) => placed.has(name)));
    // A cycle cannot be ordered: the rest goes in the alphabetical order.
    const batch = ready.length > 0 ? ready : found.filter((p) => !ordered.includes(p));
    for (const p of batch) {
      ordered.push(p);
      placed.add(p.manifest.name);
    }
  }
  return ordered.map(({ entry }) => ({
    registry: target.registry,
    path: posix.join(root, entry),
    manifest: posix.join(root, entry, 'package.json'),
  }));
}
