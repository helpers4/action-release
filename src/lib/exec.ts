/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { execFileSync } from 'node:child_process';

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Show the output in the log instead of returning it. */
  inherit?: boolean;
}

/** Runs a program without a shell and returns its trimmed standard output. */
export function run(command: string, args: string[], options: ExecOptions): string {
  const output = execFileSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return (output ?? '').trim();
}

/** Runs a command line written by the user (configuration), through bash, in the log. */
export function shell(commandLine: string, options: ExecOptions): void {
  execFileSync('bash', ['-euo', 'pipefail', '-c', commandLine], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: 'inherit',
  });
}

/** Whether a program exits with 0. */
export function succeeds(command: string, args: string[], options: ExecOptions): boolean {
  try {
    run(command, args, options);
    return true;
  } catch {
    return false;
  }
}
