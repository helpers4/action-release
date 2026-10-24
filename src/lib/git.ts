/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { execFileSync } from 'node:child_process';

/** Runs git in `cwd` and returns stdout untouched. Throws with git's stderr on failure. */
export function gitRaw(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Runs git in `cwd` and returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return gitRaw(cwd, ...args).trim();
}

/** Runs `git merge-base --is-ancestor`, where exit status 1 means "no" rather than an error. */
export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

/** Content of `file` at `ref` byte for byte, or undefined when the file does not exist there. */
export function showFile(cwd: string, ref: string, file: string): string | undefined {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return undefined;
  }
}
