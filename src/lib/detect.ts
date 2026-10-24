/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detect, type AgentName } from 'package-manager-detector';
import { readPackageJson, type PackageJson } from './manifest.js';

export interface Tooling {
  /** Package manager, npm when nothing identifies one. */
  pm: AgentName;
  /** Whether the project pins its package manager (packageManager or devEngines). */
  pinned: boolean;
  /** File to hand to setup-node's node-version-file, if the project declares a Node version. */
  nodeVersionFile?: string;
  hasBuildScript: boolean;
  /** Directory to pack, relative to the package, from publishConfig.directory. */
  publishDir?: string;
  manifest: PackageJson;
}

/** Looks for the Node version declaration of a project: dedicated files first, then package.json. */
export function nodeVersionFile(dirs: readonly string[]): string | undefined {
  for (const dir of dirs) {
    for (const name of ['.node-version', '.nvmrc']) {
      if (existsSync(join(dir, name))) return join(dir, name);
    }
  }
  for (const dir of dirs) {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) continue;
    const { engines, devEngines } = readPackageJson(file);
    if (engines?.node || devEngines?.runtime) return file;
  }
  return undefined;
}

/**
 * Detects the tooling of a package. The package manager is searched from the package up to the
 * repository root, where a monorepo keeps its lockfile.
 */
export async function detectTooling(repoDir: string, packageDir: string): Promise<Tooling> {
  const manifest = readPackageJson(join(packageDir, 'package.json'));
  const detected = await detect({ cwd: packageDir, stopDir: repoDir });
  const rootManifest = packageDir === repoDir ? manifest : readPackageJson(join(repoDir, 'package.json'));
  const pinned = Boolean(
    manifest.packageManager ||
      manifest.devEngines?.packageManager ||
      rootManifest.packageManager ||
      rootManifest.devEngines?.packageManager,
  );
  return {
    pm: detected?.name ?? 'npm',
    pinned,
    nodeVersionFile: nodeVersionFile(packageDir === repoDir ? [repoDir] : [packageDir, repoDir]),
    hasBuildScript: Boolean(manifest.scripts?.build ?? rootManifest.scripts?.build),
    publishDir: manifest.publishConfig?.directory,
    manifest,
  };
}
