/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Runtime } from '../../src/lib/actions.ts';
import type { CommitInfo, FileChange, Gh, ReleaseInfo } from '../../src/lib/github.ts';
import type { Fetch } from '../../src/lib/registries.ts';

/** An in-memory GitHub, keeping just enough state to check what the release does. */
export class FakeGh implements Gh {
  heads: Record<string, CommitInfo> = {};
  commits: Array<{ sha: string; parent: string; files: FileChange[]; message: string }> = [];
  tags = new Map<string, string>();
  releases: Array<ReleaseInfo & { body: string; prerelease: boolean; latest?: boolean }> = [];
  /** Like the API right after a creation: listings do not show the drafts yet. */
  staleListing = false;
  private next = 1;

  constructor(branch: string, head: string) {
    this.heads[branch] = { sha: head, message: 'feat: tested', parents: ['p0'] };
  }

  async branchHead(branch: string) {
    return this.heads[branch]!;
  }
  async createCommit(parent: string, files: FileChange[], message: string) {
    const sha = `release${this.next++}`;
    this.commits.push({ sha, parent, files, message });
    return sha;
  }
  async fastForward(branch: string, sha: string) {
    const commit = this.commits.find((c) => c.sha === sha)!;
    if (this.heads[branch]!.sha !== commit.parent) return false;
    this.heads[branch] = { sha, message: commit.message, parents: [commit.parent] };
    return true;
  }
  async createTag(tag: string, sha: string) {
    if (this.tags.has(tag)) return false;
    this.tags.set(tag, sha);
    return true;
  }
  async releaseByTag(tag: string) {
    return this.releases.find((r) => r.tag === tag && !(this.staleListing && r.draft));
  }
  async createDraftRelease(input: { tag: string; name: string; body: string; prerelease: boolean }) {
    const release = { id: this.next++, tag: input.tag, url: `https://github.com/o/r/releases/tag/${input.tag}`, draft: true, body: input.body, prerelease: input.prerelease };
    this.releases.push(release);
    return release;
  }
  async publishRelease(id: number, input: { body: string; latest: boolean }) {
    const release = this.releases.find((r) => r.id === id)!;
    Object.assign(release, { draft: false, body: input.body, latest: input.latest });
    return release;
  }
}

export interface FakeRuntime extends Runtime {
  logs: string[];
  warnings: string[];
  outputs: Record<string, string>;
}

export function fakeRuntime(cwd: string, env: NodeJS.ProcessEnv = {}): FakeRuntime {
  const logs: string[] = [];
  const warnings: string[] = [];
  const outputs: Record<string, string> = {};
  return {
    env: { GITHUB_WORKSPACE: cwd, GITHUB_REF: 'refs/heads/main', RUNNER_TEMP: mkdtempSync(join(tmpdir(), 'h4-runner-')), ...env },
    log: (m) => logs.push(m),
    warn: (m) => warnings.push(m),
    setOutput: (name, value) => (outputs[name] = value),
    logs,
    warnings,
    outputs,
  };
}

/** A registry that serves the given `name@version` entries (404 otherwise). */
export function fakeRegistry(served: string[] = []): Fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const crates = /crates\/([^/]+)\/([^/]+)$/.exec(url);
    if (crates) return new Response('{}', { status: served.includes(`${crates[1]}@${crates[2]}`) ? 200 : 404 });
    const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', '').replace('https://jsr.io/', '').replace('/meta.json', ''));
    const versions = Object.fromEntries(served.filter((s) => s.startsWith(`${name}@`)).map((s) => [s.slice(name.length + 1), {}]));
    return Object.keys(versions).length > 0 ? new Response(JSON.stringify({ versions })) : new Response('not found', { status: 404 });
  }) as Fetch;
}
