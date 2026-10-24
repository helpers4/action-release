/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { join } from 'node:path';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { attestTarball } from '../lib/attest.js';
import { createGh } from '../lib/github.js';
import { npmVersion, publishToNpm } from '../lib/npm.js';
import { fetchNpmVersions } from '../lib/npm-registry.js';
import { publishRelease } from '../lib/publish.js';
import { ARTIFACT_NAME, readBump } from './build.js';

export async function runPublish(): Promise<void> {
  const token = core.getInput('github-token');
  const { owner, repo } = github.context.repo;
  const cwd = process.env.RUNNER_TEMP ?? '/tmp';
  const dir = join(cwd, 'h4-release');

  const client = new DefaultArtifactClient();
  const { artifact } = await client.getArtifact(ARTIFACT_NAME);
  await client.downloadArtifact(artifact.id, { path: dir });

  const branch = github.context.ref.replace(/^refs\/heads\//, '');
  const result = await publishRelease(
    {
      gh: createGh(github.getOctokit(token), owner, repo),
      fetchVersions: fetchNpmVersions,
      npmVersion: () => npmVersion(cwd),
      env: process.env,
      attest: (subject) => attestTarball(subject, token),
      publishNpm: (tarball, distTag) => publishToNpm(tarball, distTag, cwd),
      log: (message) => core.info(message),
      warn: (message) => core.warning(message),
    },
    { dir, branch, dryRun: core.getBooleanInput('dry-run') && readBump() !== 'resume' },
  );

  core.setOutput('version', result.version);
  core.setOutput('tag', result.tag);
  core.setOutput('release-url', result.releaseUrl ?? '');
  core.setOutput('published', JSON.stringify(result.published));
}
