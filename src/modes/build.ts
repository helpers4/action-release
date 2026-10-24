/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { join } from 'node:path';
import { DefaultArtifactClient } from '@actions/artifact';
import * as core from '@actions/core';
import { buildRelease } from '../lib/build.js';
import { listFiles } from '../lib/files.js';
import { BUMPS, type Bump } from '../lib/version.js';

export const ARTIFACT_NAME = 'h4-release';

export function readBump(): Bump {
  const bump = core.getInput('bump') || 'auto';
  if (!BUMPS.includes(bump as Bump)) {
    throw new Error(`Unknown bump "${bump}": expected one of ${BUMPS.join(', ')}.`);
  }
  return bump as Bump;
}

export async function runBuild(): Promise<void> {
  const repoDir = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const outDir = join(process.env.RUNNER_TEMP ?? '/tmp', 'h4-release');

  const manifest = await buildRelease({
    repoDir,
    outDir,
    bump: readBump(),
    packageRel: core.getInput('package').replace(/^\.?\/+|\/+$/g, ''),
    setup: core.getInput('setup'),
    build: core.getInput('build'),
    registries: core.getInput('registries') || 'npm',
    carry: core.getInput('carry').split(/\s+/).filter(Boolean),
    prepare: core.getInput('prepare'),
    includeBuild: core.getInput('include-build') || 'auto',
    cliff: ['npx', '--yes', 'git-cliff@2.14.2'],
    log: (message) => core.info(message),
  });

  if (!('resume' in manifest)) {
    core.setOutput('version', manifest.version);
    core.setOutput('tag', manifest.tag);
  }
  await new DefaultArtifactClient().uploadArtifact(ARTIFACT_NAME, listFiles(outDir), outDir, {
    retentionDays: 7,
  });
}
