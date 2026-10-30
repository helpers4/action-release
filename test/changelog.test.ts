/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'vitest';
import { generateList, updateChangelog } from '../src/lib/changelog.ts';
import { TempRepo } from './helpers/repo.ts';

let repo: TempRepo | undefined;
afterEach(() => repo?.dispose());

const update = { version: '0.2.5', previousTag: 'v0.2.4', tag: 'v0.2.5', date: '2026-10-28', generated: '### Features\n\n- **api**: Add it' };

describe('generateList', () => {
  it('lists the changes since the last release, without a heading or chores', () => {
    repo = new TempRepo();
    repo.commit('feat: before');
    repo.tag('v0.2.4');
    repo.commit('feat(api): ✨ add the thing');
    repo.commit('fix: 🐛 repair it');
    repo.commit('chore(deps): bump');
    const list = generateList({ cwd: repo.dir, from: 'v0.2.4', tag: 'v0.2.5' });
    expect(list).not.toMatch(/^## /m);
    expect(list).toContain('### Features');
    expect(list).toContain('**api**: ✨ add the thing');
    expect(list).toContain('### Bug fixes');
    expect(list).not.toContain('before');
    expect(list).not.toContain('bump');
  });

  it('uses the repository cliff.toml when there is one, and the whole history without a tag', () => {
    repo = new TempRepo();
    repo.commit('feat: one', {
      'cliff.toml': '[changelog]\nbody = "custom {{ commits | length }}"\n[git]\nconventional_commits = true\n',
    });
    expect(generateList({ cwd: repo.dir, from: undefined, tag: 'v0.1.0' })).toBe('custom 1');
  });
});

describe('updateChangelog', () => {
  const keepAChangelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Changed',
    '',
    '- The package now ships its changelog',
    '',
    '## [0.2.4] — 2026-07-19',
    '',
    '- older',
    '',
    '[Unreleased]: https://github.com/baxyz/mozlz4/compare/v0.2.4...HEAD',
    '[0.2.4]: https://github.com/baxyz/mozlz4/compare/v0.2.3...v0.2.4',
    '',
  ].join('\n');

  it('moves the human summary into the new section, above the generated list', () => {
    const out = updateChangelog(keepAChangelog, update);
    expect(out.summary).toBe('### Changed\n\n- The package now ships its changelog');
    expect(out.notes).toBe(`${out.summary}\n\n${update.generated}`);
    expect(out.content).toContain(
      '## [Unreleased]\n\n## [0.2.5] - 2026-10-28\n\n### Changed\n\n- The package now ships its changelog\n\n### Features\n\n- **api**: Add it\n\n## [0.2.4] — 2026-07-19',
    );
  });

  it('keeps the link references in step', () => {
    const out = updateChangelog(keepAChangelog, update).content;
    expect(out).toContain('[Unreleased]: https://github.com/baxyz/mozlz4/compare/v0.2.5...HEAD');
    expect(out).toContain('[0.2.5]: https://github.com/baxyz/mozlz4/compare/v0.2.4...v0.2.5');
    expect(out).toContain('[0.2.4]: https://github.com/baxyz/mozlz4/compare/v0.2.3...v0.2.4');
  });

  it('uses only the generated list when there is no summary', () => {
    const out = updateChangelog('# Changelog\n\n## [Unreleased]\n\n## [0.2.4] - 2026-07-19\n\n- older\n', update);
    expect(out.summary).toBe('');
    expect(out.notes).toBe(update.generated);
  });

  it('creates the file, or the [Unreleased] heading, when missing', () => {
    expect(updateChangelog(undefined, update).content).toMatch(/^# Changelog\n[\s\S]*## \[Unreleased\]\n\n## \[0\.2\.5\] - 2026-10-28\n/);
    const noUnreleased = updateChangelog('# Changelog\n\n## [0.2.4] - 2026-07-19\n\n- older\n', update).content;
    expect(noUnreleased).toContain('## [Unreleased]\n\n## [0.2.5] - 2026-10-28\n\n### Features');
    expect(noUnreleased).toContain('## [0.2.4] - 2026-07-19');
  });

  it('says so when there is nothing notable', () => {
    const empty = updateChangelog(undefined, { ...update, generated: '' });
    expect(empty.content).toContain('_No notable change._');
    expect(empty.notes).toBe('_No notable change._');
  });
});
