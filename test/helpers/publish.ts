/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ReleaseManifest } from '../../src/lib/manifest.js';
import type { PublishDeps } from '../../src/lib/publish.js';
import { FakeGh } from './fake-gh.js';

const dirs: string[] = [];
export function cleanupArtifacts(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Writes a build artifact like the build job does and returns its folder and manifest. */
export function artifact(overrides: Partial<ReleaseManifest> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'h4-artifact-'));
  dirs.push(dir);
  const tarball = Buffer.from('tarball-bytes');
  const manifest: ReleaseManifest = {
    schema: 1,
    version: '1.2.3',
    tag: 'v1.2.3',
    baseSha: 'base0',
    last: 'v1.2.2',
    bump: 'patch',
    package: { name: 'pkg', dir: '' },
    tarball: 'pkg-1.2.3.tgz',
    sha256: createHash('sha256').update(tarball).digest('hex'),
    distTag: 'latest',
    latest: true,
    prerelease: false,
    registries: [{ name: 'npm', optional: false }],
    files: ['CHANGELOG.md', 'package.json'],
    notes: 'notes.md',
    ...overrides,
  };
  const write = (file: string, content: string | Buffer) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  };
  write(manifest.tarball, tarball);
  write('notes.md', '## [1.2.3]\n\n- a change\n');
  for (const file of manifest.files) write(`files/${file}`, `content of ${file}`);
  write('release.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest, write };
}

export interface Harness {
  gh: FakeGh;
  deps: PublishDeps;
  npmPublished: Array<{ tarball: string; distTag: string }>;
  logs: string[];
  warnings: string[];
  /** Versions the fake npm registry serves; undefined means the package does not exist. */
  npm: { versions: string[] | undefined; failPublish: boolean };
}

export function harness(): Harness {
  const gh = new FakeGh();
  gh.tags.set('v1.2.2', 'old');
  const npm: Harness['npm'] = { versions: ['1.2.2'], failPublish: false };
  const npmPublished: Harness['npmPublished'] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const deps: PublishDeps = {
    gh,
    fetchVersions: async () => npm.versions,
    npmVersion: () => '11.6.0',
    env: { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.test' },
    attest: async (subject) => Buffer.from(JSON.stringify({ attested: subject.name })),
    publishNpm: (tarball, distTag) => {
      if (npm.failPublish) throw new Error('registry unavailable\nmore detail');
      npmPublished.push({ tarball, distTag });
      npm.versions = [...(npm.versions ?? []), '1.2.3'];
    },
    log: (m) => logs.push(m),
    warn: (m) => warnings.push(m),
  };
  return { gh, deps, npmPublished, logs, warnings, npm };
}
