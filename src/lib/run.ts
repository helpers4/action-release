/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { spawnSync } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env?: Record<string, string>;
  /** `inherit` streams the output to the job log, `pipe` captures it. */
  stdio?: 'inherit' | 'pipe';
}

/** Runs a command and throws if it exits with a non-zero status. Returns its stdout when piped. */
export function run(command: string, args: readonly string[], options: RunOptions): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: options.stdio === 'pipe' ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`\`${[command, ...args].join(' ')}\` failed with status ${result.status}.${detail}`);
  }
  return result.stdout?.toString() ?? '';
}

/** Runs a user-provided shell snippet (the `setup`, `build` and `prepare` inputs). */
export function runShell(script: string, options: RunOptions): void {
  run('bash', ['-eo', 'pipefail', '-c', script], options);
}
