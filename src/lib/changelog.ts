/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CLIFF_CONFIG } from './default-cliff.js';

export interface SectionInput {
  cwd: string;
  /** Previous release tag, or undefined for the first release. */
  last: string | undefined;
  /** Tag of the release being prepared, e.g. v1.2.3. */
  tag: string;
  /** Command running git-cliff. */
  cliff?: string[];
}

/**
 * The changelog section for `last..HEAD`, rendered by git-cliff with an explicit range (tags
 * are not ancestors of the branch, so cliff cannot discover the range itself). Uses the
 * repository's cliff.toml when there is one. The tool runs from a scratch directory, not from the
 * repository: `npx` there would obey the project's package manager pins (devEngines, packageManager)
 * and refuse to run.
 */
export function generateSection(input: SectionInput): string {
  const { cwd, last, tag, cliff = ['git-cliff'] } = input;
  const scratch = mkdtempSync(join(tmpdir(), 'h4-cliff-'));
  try {
    let config = join(cwd, 'cliff.toml');
    if (!existsSync(config)) {
      config = join(scratch, 'cliff.toml');
      writeFileSync(config, DEFAULT_CLIFF_CONFIG);
    }
    const [command, ...prefix] = cliff;
    return execFileSync(
      command!,
      [...prefix, '--repository', cwd, '--config', config, '--tag', tag, '--strip', 'all', '--unreleased', ...(last ? [`${last}..HEAD`] : [])],
      { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const DEFAULT_HEADER = '# Changelog\n\nAll notable changes to this project are documented in this file.\n';

/**
 * Adds `section` on top of the previous release's CHANGELOG.md (the file carried from tag to
 * tag), right before its first version section. Without a previous file, writes a new one.
 */
export function carryChangelog(previous: string | undefined, section: string): string {
  const added = `${section.trim()}\n`;
  if (!previous?.trim()) return `${DEFAULT_HEADER}\n${added}`;
  const lines = previous.replace(/\s+$/, '').split('\n');
  const first = lines.findIndex((line) => line.startsWith('## '));
  if (first === -1) return `${lines.join('\n')}\n\n${added}`;
  return `${lines.slice(0, first).join('\n')}\n${added}\n${lines.slice(first).join('\n')}\n`;
}
