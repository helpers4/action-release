/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface SinceConfig {
  /** The placeholder written in place of a version (`@since 0.2.0`). */
  marker: string;
  /** Globs of the files whose `@since <marker>` tags get the version. */
  files: string[];
  /** JSON files whose string values equal to the marker get the version (`api-since.json`). */
  json: string[];
}

export const DEFAULT_SINCE_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,rs}'];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces the `@since` placeholders by the version, in the tracked files only. Returns the
 * paths it changed.
 */
export function replaceSince(cwd: string, tracked: readonly string[], config: SinceConfig, version: string): string[] {
  const changed: string[] = [];
  const tag = new RegExp(`(@since\\s+)${escape(config.marker)}\\b`, 'g');
  const value = new RegExp(`(:\\s*)"${escape(config.marker)}"`, 'g');

  const rewrite = (path: string, pattern: RegExp, replacement: string) => {
    const file = join(cwd, path);
    const before = readFileSync(file, 'utf8');
    const after = before.replace(pattern, replacement);
    if (after !== before) {
      writeFileSync(file, after);
      if (!changed.includes(path)) changed.push(path);
    }
  };

  for (const path of tracked) {
    if (config.files.some((glob) => posix.matchesGlob(path, glob))) rewrite(path, tag, `$1${version}`);
  }
  for (const path of config.json) {
    if (tracked.includes(path)) rewrite(path, value, `$1"${version}"`);
  }
  return changed;
}
