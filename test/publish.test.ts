/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'vitest';
import { publishRelease, ReleaseStoppedError } from '../src/lib/publish.js';
import { artifact, cleanupArtifacts, harness } from './helpers/publish.js';

afterEach(cleanupArtifacts);

const options = (dir: string, extra = {}) => ({ dir, branch: 'main', dryRun: false, ...extra });

describe('publishRelease', () => {
  it('releases: commit on top of the base, tag, assets, npm, published Release', async () => {
    const h = harness();
    const { dir } = artifact();
    const result = await publishRelease(h.deps, options(dir));

    expect(result).toMatchObject({ version: '1.2.3', tag: 'v1.2.3', published: { npm: true }, dryRun: false });
    expect(h.gh.commits).toHaveLength(1);
    expect(h.gh.commits[0]).toMatchObject({ parent: 'base0', message: 'chore(release): 🔖 v1.2.3' });
    expect(h.gh.commits[0]!.files.map((f) => f.path)).toEqual(['CHANGELOG.md', 'package.json']);
    expect(h.gh.tags.get('v1.2.3')).toBe('release1');
    expect(h.npmPublished).toEqual([{ tarball: expect.stringMatching(/pkg-1\.2\.3\.tgz$/), distTag: 'latest' }]);
    const release = h.gh.releases[0]!;
    expect(release).toMatchObject({ draft: false, latest: true, prerelease: false, commit: 'release1' });
    expect(release.body).toBe('## [1.2.3]\n\n- a change');
    expect(h.gh.assetNames(release.id)).toEqual(['release.json', 'pkg-1.2.3.tgz', 'pkg-1.2.3.tgz.sigstore.json']);
    expect(result.releaseUrl).toBe('https://example.test/releases/v1.2.3');
  });

  it('attests before publishing to the registry', async () => {
    const h = harness();
    const order: string[] = [];
    const { attest, publishNpm } = h.deps;
    h.deps.attest = async (s) => (order.push('attest'), attest(s));
    h.deps.publishNpm = (t, d) => (order.push('publish'), publishNpm(t, d));
    await publishRelease(h.deps, options(artifact().dir));
    expect(order).toEqual(['attest', 'publish']);
  });

  it('stops at the dry run before the tag, with nothing published', async () => {
    const h = harness();
    const result = await publishRelease(h.deps, options(artifact().dir, { dryRun: true }));
    expect(result.dryRun).toBe(true);
    expect(h.gh.tags.has('v1.2.3')).toBe(false);
    expect(h.gh.releases).toHaveLength(0);
    expect(h.npmPublished).toHaveLength(0);
  });

  it('stops before publishing when the tag is already taken', async () => {
    const h = harness();
    h.gh.tags.set('v1.2.3', 'someone-else');
    await expect(publishRelease(h.deps, options(artifact().dir))).rejects.toThrow(/another release took this version/);
    expect(h.gh.releases).toHaveLength(0);
    expect(h.npmPublished).toHaveLength(0);
  });

  it('stops before the lock when the branch received a workflow change', async () => {
    const h = harness();
    h.gh.workflows = { base0: 'wf-a', head1: 'wf-b' };
    h.gh.branches.main = 'head1';
    await expect(publishRelease(h.deps, options(artifact().dir))).rejects.toThrow(/workflow change/);
    expect(h.gh.tags.has('v1.2.3')).toBe(false);
    expect(h.npmPublished).toHaveLength(0);
  });

  it('proceeds when the branch moved but workflows are identical', async () => {
    const h = harness();
    h.gh.workflows = { base0: 'wf-a', head1: 'wf-a' };
    h.gh.branches.main = 'head1';
    await expect(publishRelease(h.deps, options(artifact().dir))).resolves.toMatchObject({ tag: 'v1.2.3' });
  });

  it('refuses a tarball that differs from the build output', async () => {
    const h = harness();
    const a = artifact();
    a.write(a.manifest.tarball, 'tampered');
    await expect(publishRelease(h.deps, options(a.dir))).rejects.toThrow(/sha256 mismatch/);
    expect(h.gh.commits).toHaveLength(0);
  });

  describe('preflight failures create nothing', () => {
    it.each([
      ['package missing from npm', (h: ReturnType<typeof harness>) => (h.npm.versions = undefined), /does not exist on npm/],
      ['npm ahead of the tags', (h: ReturnType<typeof harness>) => (h.npm.versions = ['1.2.2', '2.0.0']), /outside the pipeline/],
      ['version already on npm', (h: ReturnType<typeof harness>) => (h.npm.versions = ['1.2.2', '1.2.3']), /already on npm/],
      ['no OIDC token', (h: ReturnType<typeof harness>) => (h.deps.env = {}), /id-token: write/],
      ['old npm', (h: ReturnType<typeof harness>) => (h.deps.npmVersion = () => '10.9.0'), /11\.5\.1/],
      [
        'blocking tag ruleset',
        (h: ReturnType<typeof harness>) =>
          h.gh.rulesets.push({ name: 'tags', blocksCreation: true, include: ['refs/tags/v*'], exclude: [], hasBypass: false }),
        /Ruleset "tags"/,
      ],
    ])('%s', async (_name, arrange, expected) => {
      const h = harness();
      arrange(h);
      await expect(publishRelease(h.deps, options(artifact().dir))).rejects.toThrow(expected);
      expect(h.gh.commits).toHaveLength(0);
      expect(h.gh.tags.has('v1.2.3')).toBe(false);
    });
  });

  it('only warns about immutable releases and a real version on the branch', async () => {
    const h = harness();
    h.gh.immutable = false;
    h.gh.files['package.json'] = '{"name":"pkg","version":"0.2.4"}';
    await publishRelease(h.deps, options(artifact().dir));
    expect(h.logs.join('\n')).toMatch(/immutable-releases/);
    expect(h.logs.join('\n')).toMatch(/placeholder-version/);
  });

  it('publishes a prerelease without making it latest', async () => {
    const h = harness();
    await publishRelease(
      h.deps,
      options(artifact({ version: '1.3.0-beta.1', tag: 'v1.3.0-beta.1', distTag: 'beta', latest: false, prerelease: true }).dir),
    );
    expect(h.gh.releases[0]).toMatchObject({ prerelease: true, latest: false, draft: false });
    expect(h.npmPublished[0]!.distTag).toBe('beta');
  });

  it('posts "released in" comments once on pull requests and the issues they close', async () => {
    const h = harness();
    h.gh.range = ['c1', 'c2'];
    h.gh.pullRequests = { c1: [10], c2: [10, 11] };
    h.gh.closing = { 10: [5], 11: [5] };
    await publishRelease(h.deps, options(artifact().dir));
    expect(h.gh.comments.map((c) => c.number).sort((a, b) => a - b)).toEqual([5, 10, 11]);
    expect(h.gh.comments[0]!.body).toContain('v1.2.3');
  });

  describe('failed publication and resume', () => {
    it('keeps the draft and the tag, then resume finishes with the same tarball', async () => {
      const h = harness();
      h.npm.failPublish = true;
      await expect(publishRelease(h.deps, options(artifact().dir))).rejects.toThrow(/bump: resume/);
      const draft = h.gh.releases[0]!;
      expect(draft.draft).toBe(true);
      expect(draft.body).toContain('Publication incomplete');
      expect(h.gh.tags.has('v1.2.3')).toBe(true);

      h.npm.failPublish = false;
      const resumeDir = artifact();
      resumeDir.write('release.json', '{"schema":1,"resume":true}\n');
      const result = await publishRelease(h.deps, options(resumeDir.dir));
      expect(result).toMatchObject({ tag: 'v1.2.3', published: { npm: true } });
      expect(h.gh.releases[0]).toMatchObject({ draft: false, latest: true });
      expect(h.gh.releases[0]!.body).toBe('## [1.2.3]\n\n- a change');
      expect(h.npmPublished).toHaveLength(1);
      expect(h.gh.commits).toHaveLength(1);
      expect(h.gh.assetNames(draft.id).filter((n) => n.endsWith('.sigstore.json'))).toHaveLength(1);
    });

    it('keeps the draft and explains how to resume when the attestation fails', async () => {
      const h = harness();
      h.deps.attest = async () => {
        throw new Error('Feature not available for the organization');
      };
      await expect(publishRelease(h.deps, options(artifact().dir))).rejects.toThrow(
        /could not be attested: Feature not available.*bump: resume.*attestation-failed/s,
      );
      expect(h.gh.releases[0]!.draft).toBe(true);
      expect(h.npmPublished).toHaveLength(0);
      expect(h.gh.tags.has('v1.2.3')).toBe(true);
    });

    it('does not publish again what the registry already serves', async () => {
      const h = harness();
      h.npm.failPublish = true;
      await expect(publishRelease(h.deps, options(artifact().dir))).rejects.toThrow();
      h.npm.versions = ['1.2.2', '1.2.3'];
      const resume = artifact();
      resume.write('release.json', '{"schema":1,"resume":true}\n');
      await publishRelease(h.deps, options(resume.dir));
      expect(h.npmPublished).toHaveLength(0);
      expect(h.gh.releases[0]!.draft).toBe(false);
    });

    it('has nothing to resume once the release is published', async () => {
      const h = harness();
      await publishRelease(h.deps, options(artifact().dir));
      const resume = artifact();
      resume.write('release.json', '{"schema":1,"resume":true}\n');
      await expect(publishRelease(h.deps, options(resume.dir))).rejects.toThrow(ReleaseStoppedError);
    });

    it('publishes the Release when only an optional registry failed', async () => {
      const h = harness();
      h.npm.failPublish = true;
      const result = await publishRelease(
        h.deps,
        options(artifact({ registries: [{ name: 'npm', optional: true }] }).dir),
      );
      expect(result.published.npm).toBe(false);
      expect(h.gh.releases[0]!.draft).toBe(false);
      expect(h.gh.releases[0]!.body).toContain('Not published on npm (optional)');
      expect(h.warnings.join('\n')).toMatch(/optional/);
    });
  });

  it('publishes nothing to a registry for the none target', async () => {
    const h = harness();
    h.deps.env = {};
    const result = await publishRelease(h.deps, options(artifact({ registries: [{ name: 'none', optional: false }] }).dir));
    expect(h.npmPublished).toHaveLength(0);
    expect(result.published).toEqual({});
    expect(h.gh.releases[0]!.draft).toBe(false);
  });

  describe('floating major tag of actions', () => {
    const withBuild = { includeBuild: 'dist', registries: [{ name: 'none' as const, optional: false }] };

    it('moves v1 to the release commit', async () => {
      const h = harness();
      h.gh.tags.set('v1', 'older');
      await publishRelease(h.deps, options(artifact(withBuild).dir));
      expect(h.gh.tags.get('v1')).toBe('release1');
    });

    it('leaves it alone for an older line, a prerelease, or a regular package', async () => {
      const older = harness();
      older.gh.tags.set('v1', 'newer');
      older.gh.tags.set('v1.9.0', 'x');
      await publishRelease(older.deps, options(artifact(withBuild).dir));
      expect(older.gh.tags.get('v1')).toBe('newer');

      const pre = harness();
      await publishRelease(
        pre.deps,
        options(artifact({ ...withBuild, version: '1.3.0-rc.1', tag: 'v1.3.0-rc.1', prerelease: true, latest: false }).dir),
      );
      expect(pre.gh.tags.has('v1')).toBe(false);

      const plain = harness();
      await publishRelease(plain.deps, options(artifact({ registries: withBuild.registries }).dir));
      expect(plain.gh.tags.has('v1')).toBe(false);
    });
  });
});
