/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'vitest';
import { loadJson } from '../src/lib/actions.ts';
import { GitHubError } from '../src/lib/github.ts';
import { PLAN_FILE, type Plan } from '../src/lib/plan.ts';
import { commit } from '../src/steps/commit.ts';
import { finalize, summary } from '../src/steps/finalize.ts';
import { prepare } from '../src/steps/prepare.ts';
import { publish } from '../src/steps/publish.ts';
import { preflight } from '../src/steps/verify.ts';
import { FakeGh, fakeRegistry, fakeRuntime } from './helpers/fake.ts';
import { TempRepo } from './helpers/repo.ts';

let repo: TempRepo;
afterEach(() => repo?.dispose());

/** mozlz4-like: an npm library with tags and a hand-written Keep a Changelog. */
function library(): TempRepo {
  repo = new TempRepo();
  repo.commit('feat: first', {
    'package.json': '{\n  "name": "mozlz4",\n  "version": "0.2.4"\n}\n',
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [0.2.4] - 2026-07-19\n\n- older\n',
    'src/index.ts': '/** @since 0.2.4 */\nexport const a = 1;\n',
  });
  repo.tag('v0.2.4');
  repo.commit('feat(api): ✨ add decode', {
    'src/decode.ts': '/** @since 0.2.0 */\nexport const decode = 1;\n',
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\nDecoding is now streamed.\n\n## [0.2.4] - 2026-07-19\n\n- older\n',
  });
  return repo;
}

const today = () => '2026-10-28';

describe('prepare', () => {
  it('writes the version, the changelog and @since, and plans a new release', async () => {
    library();
    const runtime = fakeRuntime(repo.dir);
    const plan = await prepare({ runtime, gh: () => new FakeGh('main', 'x'), today });

    expect(plan).toMatchObject({ state: 'new', version: '0.2.5', tag: 'v0.2.5', previousTag: 'v0.2.4', branch: 'main', distTag: 'latest', latest: true, prerelease: false });
    expect(plan.files).toEqual(['CHANGELOG.md', 'package.json', 'src/decode.ts']);
    expect(plan.targets).toEqual([{ registry: 'npm', path: '.', manifest: 'package.json', name: 'mozlz4', published: false }]);
    expect(repo.read('package.json')).toContain('"version": "0.2.5"');
    expect(repo.read('src/decode.ts')).toContain('@since 0.2.5');
    expect(repo.read('CHANGELOG.md')).toContain('## [Unreleased]\n\n## [0.2.5] - 2026-10-28\n\nDecoding is now streamed.\n\n### Features');
    expect(plan.notes).toMatch(/^Decoding is now streamed\.\n\n### Features\n\n- \*\*api\*\*: ✨ add decode/);
    expect(runtime.outputs).toMatchObject({ state: 'new', version: '0.2.5', tag: 'v0.2.5', crates: 'false' });
    expect(loadJson<Plan>(runtime.env, PLAN_FILE).version).toBe('0.2.5');
  });

  it('plans a prerelease with its dist-tag, not latest', async () => {
    library();
    const plan = await prepare({ runtime: fakeRuntime(repo.dir, { INPUT_BUMP: 'beta' }), gh: () => new FakeGh('main', 'x'), today });
    expect(plan).toMatchObject({ version: '0.2.5-beta.0', distTag: 'beta', latest: false, prerelease: true });
  });

  it('stops when there is nothing to release, or on a shallow or tag checkout', async () => {
    library();
    repo.tag('v0.2.5');
    await expect(prepare({ runtime: fakeRuntime(repo.dir), gh: () => new FakeGh('main', 'x'), today })).rejects.toThrow(/Nothing to release/);
    await expect(prepare({ runtime: fakeRuntime(repo.dir, { GITHUB_REF: 'refs/tags/v1' }), gh: () => new FakeGh('main', 'x'), today })).rejects.toThrow(/runs from a branch/);
  });

  it('resumes a tagged release with what is still missing, from its commit', async () => {
    library();
    const tested = repo.git('rev-parse', 'HEAD');
    const released = repo.commit('chore(release): 🔖 v0.2.5', {
      'package.json': '{\n  "name": "mozlz4",\n  "version": "0.2.5"\n}\n',
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [0.2.5] - 2026-10-28\n\nStreamed.\n\n## [0.2.4] - 2026-07-19\n',
    });
    repo.tag('v0.2.5');
    repo.git('checkout', '-q', '--detach', tested);

    const gh = new FakeGh('main', released);
    // Re-run of the same job: the computed version is already tagged on a child of the tested commit.
    const rerun = await prepare({ runtime: fakeRuntime(repo.dir), gh: () => gh, fetchImpl: fakeRegistry(), today });
    expect(rerun).toMatchObject({ state: 'resume', version: '0.2.5', commit: released, base: tested, notes: 'Streamed.' });
    expect(repo.git('rev-parse', 'HEAD')).toBe(released);

    await gh.createDraftRelease({ tag: 'v0.2.5', name: 'v0.2.5', body: '', prerelease: false });
    await gh.publishRelease(gh.releases[0]!.id, { body: '', latest: true });
    const resume = await prepare({ runtime: fakeRuntime(repo.dir, { INPUT_BUMP: 'resume' }), gh: () => gh, fetchImpl: fakeRegistry(['mozlz4@0.2.5']), today });
    expect(resume.state).toBe('done');
  });
});

describe('preflight', () => {
  const plan = { state: 'new', targets: [{ registry: 'npm', published: false }] } as unknown as Plan;

  it('requires OIDC, a recent npm and the App before writing anything', () => {
    expect(preflight(plan, {}, () => '10.9.0')).toEqual([
      expect.stringContaining('id-token: write'),
      expect.stringContaining('npm 10.9.0 cannot publish with trusted publishing'),
      expect.stringContaining('app-id and app-key'),
    ]);
    expect(preflight(plan, { ACTIONS_ID_TOKEN_REQUEST_URL: 'x', INPUT_HAS_APP: 'true' }, () => '11.6.0')).toEqual([]);
  });
});

describe('commit, publish, finalize', () => {
  async function prepared() {
    library();
    const runtime = fakeRuntime(repo.dir);
    const tested = repo.git('rev-parse', 'HEAD');
    const gh = new FakeGh('main', tested);
    await prepare({ runtime, gh: () => gh, today });
    return { runtime, gh, tested };
  }

  it('pushes the release commit with the App, tags it and drafts the Release', async () => {
    const { runtime, gh, tested } = await prepared();
    const checkouts: string[] = [];
    const plan = await commit({ runtime, appGh: gh, gh, checkout: (_, sha) => checkouts.push(sha) });

    expect(gh.commits).toHaveLength(1);
    expect(gh.commits[0]).toMatchObject({ parent: tested, message: 'chore(release): 🔖 v0.2.5' });
    expect(gh.commits[0]!.files.map((f) => `${f.mode} ${f.path}`)).toEqual(['100644 CHANGELOG.md', '100644 package.json', '100644 src/decode.ts']);
    expect(gh.heads.main!.sha).toBe(plan.commit);
    expect(gh.tags.get('v0.2.5')).toBe(plan.commit);
    expect(gh.releases[0]).toMatchObject({ tag: 'v0.2.5', draft: true });
    expect(checkouts).toEqual([plan.commit]);
  });

  it('moves the floating major tag of an action to a stable release', async () => {
    library();
    repo.commit('chore: config', { '.github/release.yml': 'floating-major: true\n' });
    const runtime = fakeRuntime(repo.dir);
    const gh = new FakeGh('main', repo.git('rev-parse', 'HEAD'));
    expect((await prepare({ runtime, gh: () => gh, today })).floatingTag).toBe('v0');
    const plan = await commit({ runtime, appGh: gh, gh, checkout: () => {} });
    expect(gh.tags.get('v0')).toBe(plan.commit);

    const beta = await prepare({ runtime: fakeRuntime(repo.dir, { INPUT_BUMP: 'beta' }), gh: () => gh, today });
    expect(beta.floatingTag).toBeUndefined();
  });

  it('stops before writing when the branch moved', async () => {
    const { runtime, gh } = await prepared();
    gh.heads.main = { sha: 'someone-else', message: 'fix: other', parents: ['x'] };
    await expect(commit({ runtime, appGh: gh, gh, checkout: () => {} })).rejects.toThrow(/main moved during the release.*Nothing was released/);
    expect(gh.commits).toHaveLength(0);
    expect(gh.tags.size).toBe(0);
  });

  it('reuses the release commit a previous run already pushed', async () => {
    const { runtime, gh, tested } = await prepared();
    gh.heads.main = { sha: 'pushed', message: 'chore(release): 🔖 v0.2.5\n', parents: [tested] };
    const plan = await commit({ runtime, appGh: gh, gh, checkout: () => {} });
    expect(plan.commit).toBe('pushed');
    expect(gh.commits).toHaveLength(0);
    expect(gh.tags.get('v0.2.5')).toBe('pushed');
  });

  it('publishes what is missing, keeps going on a failure, and asks for a rerun', async () => {
    const { runtime, gh } = await prepared();
    await commit({ runtime, appGh: gh, gh, checkout: () => {} });
    const calls: string[] = [];
    await expect(
      publish({
        runtime,
        fetchImpl: fakeRegistry(),
        publish: (t) => {
          calls.push(t.name);
          throw new Error('E403 forbidden\nmore');
        },
      }),
    ).rejects.toThrow(/v0.2.5 is tagged but not published on npm \(mozlz4@0.2.5\).*run the release again/);
    expect(runtime.warnings[0]).toBe('npm (mozlz4@0.2.5) was not published: E403 forbidden');

    const again = await publish({ runtime, fetchImpl: fakeRegistry(['mozlz4@0.2.5']), publish: () => calls.push('again') });
    expect(calls).toEqual(['mozlz4']);
    expect(again.targets[0]!.published).toBe(true);
  });

  it('publishes the draft it created, even when the listing does not show it yet', async () => {
    const { runtime, gh } = await prepared();
    await commit({ runtime, appGh: gh, gh, checkout: () => {} });
    gh.staleListing = true;
    await finalize({ runtime, gh });
    expect(gh.releases).toHaveLength(1);
    expect(gh.releases[0]!.draft).toBe(false);
  });

  it('explains that a tag of a deleted immutable Release can never have a Release again', async () => {
    const { runtime, gh } = await prepared();
    await commit({ runtime, appGh: gh, gh, checkout: () => {} });
    gh.publishRelease = async () => {
      throw new GitHubError(422, 'GitHub PATCH /releases/1: 422 {"message":"tag_name was used by an immutable release"}');
    };
    await expect(finalize({ runtime, gh })).rejects.toThrow(/v0.2.5 belonged to an immutable Release that was deleted/);
  });

  it('publishes the Release with the notes, as the latest one', async () => {
    const { runtime, gh } = await prepared();
    await commit({ runtime, appGh: gh, gh, checkout: () => {} });
    const url = await finalize({ runtime, gh });
    expect(gh.releases[0]).toMatchObject({ draft: false, latest: true });
    expect(gh.releases[0]!.body).toMatch(/^Decoding is now streamed\./);
    expect(runtime.outputs['release-url']).toBe(url);
    const plan = loadJson<Plan>(runtime.env, PLAN_FILE);
    expect(summary(plan, url)).toContain('[`mozlz4@0.2.5`](https://www.npmjs.com/package/mozlz4/v/0.2.5)');
  });
});
