/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './exec.ts';

/** Used when the repository has no cliff.toml: one group per kind of change, chores left out. */
export const DEFAULT_CLIFF_CONFIG = `[changelog]
header = ""
body = """
{% for group, commits in commits | group_by(attribute="group") %}
### {{ group | striptags | trim | upper_first }}
{% for commit in commits %}
- {% if commit.scope %}**{{ commit.scope }}**: {% endif %}{{ commit.message | upper_first }}\\
{% endfor %}
{% endfor %}
"""
footer = ""
trim = true

[git]
conventional_commits = true
filter_unconventional = true
split_commits = false
filter_commits = true
commit_parsers = [
  { message = "^[a-z]+(\\\\(.*\\\\))?!:", group = "<!-- 0 -->Breaking changes" },
  { body = "BREAKING[ -]CHANGE", group = "<!-- 0 -->Breaking changes" },
  { message = "^feat", group = "<!-- 1 -->Features" },
  { message = "^fix", group = "<!-- 2 -->Bug fixes" },
  { message = "^perf", group = "<!-- 3 -->Performance" },
  { message = "^revert", group = "<!-- 4 -->Reverts" },
  { message = "^docs", group = "<!-- 5 -->Documentation" },
  { message = ".*", skip = true },
]
`;

const cliffBinary = (): string => fileURLToPath(import.meta.resolve('git-cliff/cli'));

export interface GenerateInput {
  cwd: string;
  /** Tag of the previous release; every commit of HEAD when there is none. */
  from: string | undefined;
  tag: string;
}

/**
 * The generated list of changes (no heading) for `from..HEAD`, by git-cliff with the repository's
 * cliff.toml or the default one. It runs from a scratch directory: in the repository, the tooling
 * would obey the project's package manager pins.
 */
export function generateList({ cwd, from, tag }: GenerateInput): string {
  const scratch = mkdtempSync(join(tmpdir(), 'h4-cliff-'));
  try {
    let config = join(cwd, 'cliff.toml');
    if (!existsSync(config)) {
      config = join(scratch, 'cliff.toml');
      writeFileSync(config, DEFAULT_CLIFF_CONFIG);
    }
    const args = ['--repository', cwd, '--config', config, '--tag', tag, '--strip', 'all', '--unreleased'];
    if (from) args.push(`${from}..HEAD`);
    const out = run(process.execPath, [cliffBinary(), ...args], { cwd: scratch });
    return out.replace(/^## .*\n+/, '').trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const DEFAULT_HEADER = '# Changelog\n\nAll notable changes to this project are documented in this file.\n';
const UNRELEASED = /^## \[?unreleased\]?[^\n]*$/im;

export interface ChangelogUpdate {
  /** The new content of the file. */
  content: string;
  /** The human summary written under [Unreleased], if any. */
  summary: string;
  /** Notes of the GitHub Release: the summary, then the generated list. */
  notes: string;
}

export interface UpdateInput {
  version: string;
  previousTag: string | undefined;
  tag: string;
  date: string;
  generated: string;
}

/**
 * Moves the human summary of `[Unreleased]` into a new `[X.Y.Z]` section followed by the
 * generated list, and leaves an empty `[Unreleased]` on top for the next release.
 */
export function updateChangelog(existing: string | undefined, input: UpdateInput): ChangelogUpdate {
  const text = existing?.trim() ? existing.replace(/\s+$/, '\n') : `${DEFAULT_HEADER}\n## [Unreleased]\n`;
  const lines = text.split('\n');
  let start = lines.findIndex((line) => UNRELEASED.test(line));
  if (start === -1) {
    const firstSection = lines.findIndex((line) => line.startsWith('## '));
    start = firstSection === -1 ? lines.length : firstSection;
    lines.splice(start, 0, '## [Unreleased]', '');
  }
  let end = lines.findIndex((line, i) => i > start && (line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line)));
  if (end === -1) end = lines.length;

  const summary = lines.slice(start + 1, end).join('\n').trim();
  const notes = [summary, input.generated].filter(Boolean).join('\n\n') || '_No notable change._';
  const section = [`## [${input.version}] - ${input.date}`, '', notes, ''];
  lines.splice(start, end - start, '## [Unreleased]', '', ...section);

  return { content: updateLinks(lines.join('\n'), input).replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n'), summary, notes };
}

/** The body of the `[version]` section of a changelog (the notes of a release being resumed). */
export function sectionOf(text: string | undefined, version: string): string | undefined {
  if (!text) return undefined;
  const lines = text.split('\n');
  const heading = new RegExp(`^## \\[?${version.replace(/[.+]/g, '\\$&')}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  let end = lines.findIndex((line, i) => i > start && (line.startsWith('## ') || /^\[[^\]]+\]:\s/.test(line)));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

/** Keeps Keep a Changelog link references in step: `[Unreleased]` compares from the new tag. */
function updateLinks(text: string, { version, previousTag, tag }: UpdateInput): string {
  const unreleased = /^\[unreleased\]:\s*(\S+)\/compare\/(\S+)\.\.\.HEAD\s*$/im;
  const match = unreleased.exec(text);
  if (!match) return text;
  const [line, base, from] = match;
  const replacement = `[Unreleased]: ${base}/compare/${tag}...HEAD\n[${version}]: ${base}/compare/${previousTag ?? from}...${tag}`;
  return text.replace(line, replacement);
}
