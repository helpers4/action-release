/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Bump } from './version.js';
import type { RegistryRequest } from './registries.js';

export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  engines?: { node?: string };
  devEngines?: { runtime?: unknown; packageManager?: unknown };
  publishConfig?: { directory?: string };
  packageManager?: string;
}

export function readPackageJson(file: string): PackageJson {
  return JSON.parse(readFileSync(file, 'utf8')) as PackageJson;
}

/** Sets `version` in a package.json while keeping the file's indentation and final newline. */
export function writeVersion(file: string, version: string): void {
  const raw = readFileSync(file, 'utf8');
  const indent = /^(\s+)"/m.exec(raw)?.[1] ?? '  ';
  const json = JSON.parse(raw) as Record<string, unknown>;
  json.version = version;
  writeFileSync(file, `${JSON.stringify(json, null, indent)}${raw.endsWith('\n') ? '\n' : ''}`);
}

/** What the build job tells the publish job, stored as release.json in the artifact. */
export interface ReleaseManifest {
  schema: 1;
  version: string;
  tag: string;
  /** Commit the release commit is a child of: the HEAD the build ran on. */
  baseSha: string;
  /** Previous release tag of the line, if any. */
  last?: string;
  bump: Exclude<Bump, 'resume'>;
  package: { name: string; dir: string };
  /** Tarball file name inside the artifact. */
  tarball: string;
  /** SHA-256 of the tarball: the publish job refuses bytes that differ from what was built. */
  sha256: string;
  distTag: string;
  latest: boolean;
  prerelease: boolean;
  registries: RegistryRequest[];
  /** Repository-relative paths of the files the release commit adds or replaces, stored under files/. */
  files: string[];
  notes: string;
  sbom?: string;
  /** Directory of build output added to the release commit (actions only); enables the floating major tag. */
  includeBuild?: string;
}

/** A `resume` run rebuilds nothing: the publish job works from the tag and its draft Release. */
export interface ResumeManifest {
  schema: 1;
  resume: true;
}
