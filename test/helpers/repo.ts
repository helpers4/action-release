/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

/** A throwaway git repository for tests. */
export class TempRepo {
  readonly dir = mkdtempSync(join(tmpdir(), 'h4-repo-'));
  private counter = 0;

  constructor() {
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'commit.gpgsign', 'false');
    this.git('config', 'tag.gpgsign', 'false');
  }

  git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.dir,
      encoding: 'utf8',
      env: { ...process.env, ...IDENTITY },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  /** Writes a file in the working tree, creating its folders. */
  write(file: string, content: string): void {
    mkdirSync(dirname(join(this.dir, file)), { recursive: true });
    writeFileSync(join(this.dir, file), content);
  }

  /** Commits a new file with `message` on the current branch and returns its sha. */
  commit(message: string): string {
    writeFileSync(join(this.dir, `f${this.counter++}.txt`), message);
    this.git('add', '-A');
    this.git('commit', '-q', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }

  /**
   * Creates a release commit on no branch: a child of `parent` tagged `tag`. The current
   * branch is left untouched.
   */
  release(tag: string, parent = 'HEAD', files: Record<string, string> = {}): string {
    const branch = this.git('rev-parse', '--abbrev-ref', 'HEAD');
    this.git('checkout', '-q', '--detach', parent);
    for (const [file, content] of Object.entries(files)) this.write(file, content);
    const sha = this.commit(`chore(release): 🔖 ${tag}`);
    this.git('tag', tag, sha);
    this.git('checkout', '-q', branch);
    return sha;
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
