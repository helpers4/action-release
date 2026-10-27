/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { AssetInfo, CommitFile, Gh, ReleaseInfo, TagRuleset } from '../../src/lib/github.js';

interface FakeRelease extends ReleaseInfo {
  prerelease: boolean;
  latest: boolean;
  commit: string;
  immutable?: boolean;
}

/** An in-memory GitHub, keeping just enough state to check what the release does. */
export class FakeGh implements Gh {
  immutable: boolean | undefined = true;
  rulesets: TagRuleset[] = [];
  branches: Record<string, string> = { main: 'base0' };
  /** `.github/workflows` tree of each commit; commits not listed have none. */
  workflows: Record<string, string> = {};
  files: Record<string, string> = { 'package.json': '{"name":"pkg","version":"0.0.0-development"}' };
  tags = new Map<string, string>();
  releases: FakeRelease[] = [];
  assets = new Map<number, Array<AssetInfo & { data: Buffer }>>();
  comments: Array<{ number: number; body: string }> = [];
  commits: Array<{ sha: string; parent: string; files: CommitFile[]; message: string }> = [];
  pullRequests: Record<string, number[]> = {};
  closing: Record<number, number[]> = {};
  range: string[] = [];
  private nextId = 1;

  async immutableReleasesEnabled() {
    return this.immutable;
  }
  async tagRulesets() {
    return this.rulesets;
  }
  async branchHead(branch: string) {
    return this.branches[branch]!;
  }
  async workflowsTree(commit: string) {
    return this.workflows[commit];
  }
  async readFile(_commit: string, path: string) {
    return this.files[path];
  }
  async createCommit(parent: string, files: CommitFile[], message: string) {
    const sha = `release${this.commits.length + 1}`;
    this.commits.push({ sha, parent, files, message });
    this.workflows[sha] = this.workflows[parent]!;
    return sha;
  }
  async createTag(tag: string, commit: string) {
    if (this.tags.has(tag)) return 'exists' as const;
    this.tags.set(tag, commit);
    return 'created' as const;
  }
  async forceTag(tag: string, commit: string) {
    this.tags.set(tag, commit);
  }
  async tagCommit(tag: string) {
    return this.tags.get(tag);
  }
  async listTags(prefix: string) {
    return [...this.tags.keys()].filter((t) => t.startsWith(prefix));
  }
  async createDraftRelease(input: { tag: string; commit: string; body: string; prerelease: boolean }) {
    const release: FakeRelease = {
      id: this.nextId++,
      tag: input.tag,
      url: `https://example.test/releases/${input.tag}`,
      draft: true,
      body: input.body,
      prerelease: input.prerelease,
      latest: false,
      commit: input.commit,
    };
    this.releases.push(release);
    this.assets.set(release.id, []);
    return release;
  }
  async updateRelease(id: number, patch: { body?: string; draft?: boolean; latest?: boolean }) {
    const release = this.releases.find((r) => r.id === id)!;
    if (patch.body !== undefined) release.body = patch.body;
    if (patch.draft !== undefined) release.draft = patch.draft;
    if (patch.latest !== undefined) release.latest = patch.latest;
    release.immutable = this.immutable === undefined ? undefined : this.immutable && !release.draft;
    return release;
  }
  async latestDraft() {
    return [...this.releases].reverse().find((r) => r.draft);
  }
  async listAssets(release: number) {
    return (this.assets.get(release) ?? []).map(({ id, name }) => ({ id, name }));
  }
  async uploadAsset(release: number, name: string, data: Buffer) {
    this.assets.get(release)!.push({ id: this.nextId++, name, data });
  }
  async downloadAsset(asset: number) {
    for (const list of this.assets.values()) {
      const found = list.find((a) => a.id === asset);
      if (found) return found.data;
    }
    throw new Error(`no asset ${asset}`);
  }
  async commitsBetween() {
    return this.range;
  }
  async mergedPullRequests(commit: string) {
    return this.pullRequests[commit] ?? [];
  }
  async closingIssues(pr: number) {
    return this.closing[pr] ?? [];
  }
  async comment(number: number, body: string) {
    this.comments.push({ number, body });
  }

  assetNames(release: number): string[] {
    return (this.assets.get(release) ?? []).map((a) => a.name);
  }
}
