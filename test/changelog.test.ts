/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { carryChangelog, generateSection } from '../src/lib/changelog.js';
import { TempRepo } from './helpers/repo.js';

let repo: TempRepo;
afterEach(() => repo.dispose());

const cliff = [new URL('../node_modules/.bin/git-cliff', import.meta.url).pathname];

describe('generateSection', () => {
  it('renders the range as a section for the tag, from the last release', () => {
    repo = new TempRepo();
    repo.commit('feat(api): ✨ before the release');
    repo.release('v1.0.0');
    repo.commit('feat(api): ✨ add the thing');
    repo.commit('fix: 🐛 repair it');
    repo.commit('chore(deps): ⬆️ bump');
    const section = generateSection({ cwd: repo.dir, last: 'v1.0.0', tag: 'v1.1.0', cliff });
    expect(section).toMatch(/^## \[1\.1\.0\] - \d{4}-\d{2}-\d{2}/);
    expect(section).toContain('**api**: ✨ add the thing');
    expect(section).toContain('🐛 repair it');
    expect(section).not.toContain('before the release');
    expect(section).not.toContain('bump');
    expect(section).not.toContain('# Changelog');
  });

  it('does not run the tool from the repository (npx would obey its package manager pins)', () => {
    repo = new TempRepo();
    repo.commit('feat: one');
    writeFileSync(`${repo.dir}/package.json`, '{"devEngines":{"packageManager":{"name":"pnpm"}}}');
    const fromAnotherDirectory = ['sh', '-c', 'test ! -e package.json && exec "$0" "$@"', cliff[0]!];
    const section = generateSection({ cwd: repo.dir, last: undefined, tag: 'v0.1.0', cliff: fromAnotherDirectory });
    expect(section).toContain('One');
  });

  it('prefers the repository cliff.toml', () => {
    repo = new TempRepo();
    repo.commit('feat: one');
    const toml = `[changelog]\nbody = "custom {{ version }}"\n[git]\nconventional_commits = true\ncommit_parsers = [{ message = ".*", group = "All" }]\n`;
    writeFileSync(`${repo.dir}/cliff.toml`, toml);
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'feat: config');
    expect(generateSection({ cwd: repo.dir, last: undefined, tag: 'v0.1.0', cliff })).toContain('custom v0.1.0');
  });
});

describe('carryChangelog', () => {
  const section = '## [1.1.0] - 2026-10-24\n\n### Features\n- new\n';

  it('creates the file with a header when there is no previous one', () => {
    const out = carryChangelog(undefined, section);
    expect(out.startsWith('# Changelog')).toBe(true);
    expect(out).toContain('## [1.1.0]');
  });

  it('puts the new section before the previous sections and keeps the preamble', () => {
    const previous = '# Changelog\n\nIntro text.\n\n## [1.0.0] - 2026-01-01\n\n- old\n';
    const out = carryChangelog(previous, section);
    expect(out.indexOf('Intro text.')).toBeLessThan(out.indexOf('## [1.1.0]'));
    expect(out.indexOf('## [1.1.0]')).toBeLessThan(out.indexOf('## [1.0.0]'));
    expect(out).toContain('- old');
    expect(out.endsWith('\n')).toBe(true);
  });

  it('appends when the previous file has no version section', () => {
    expect(carryChangelog('# Changelog\n', section)).toBe(`# Changelog\n\n${section}`);
  });

  it('accumulates over several releases', () => {
    const first = carryChangelog(undefined, '## [1.0.0] - 2026-01-01\n- a\n');
    const second = carryChangelog(first, '## [1.1.0] - 2026-02-01\n- b\n');
    expect(second.indexOf('1.1.0')).toBeLessThan(second.indexOf('1.0.0'));
  });
});
