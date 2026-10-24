/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { run } from './run.js';

/**
 * Publishes a tarball with npm's trusted publishing. No project script runs, and the tarball is
 * the exact file that was built and attested.
 */
export function publishToNpm(tarball: string, distTag: string, cwd: string): void {
  run('npm', ['publish', tarball, '--ignore-scripts', '--tag', distTag], { cwd });
}

export function npmVersion(cwd: string): string {
  return run('npm', ['--version'], { cwd, stdio: 'pipe' }).trim();
}
