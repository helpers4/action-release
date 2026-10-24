/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import * as core from '@actions/core';
import { checkRepo } from '../lib/check.js';

export async function runCheck(): Promise<void> {
  const problems = checkRepo({
    repoDir: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    packageRel: core.getInput('package').replace(/^\.?\/+|\/+$/g, ''),
    registries: core.getInput('registries') || 'npm',
    includeBuild: core.getInput('include-build') || 'auto',
  });
  for (const p of problems) (p.level === 'error' ? core.error : core.warning)(p.message);
  const errors = problems.filter((p) => p.level === 'error');
  if (errors.length > 0) throw new Error(`${errors.length} release check(s) failed.`);
  core.info('Release checks passed.');
}
