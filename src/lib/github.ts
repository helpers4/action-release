/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

export interface ReleaseInfo {
  id: number;
  tag: string;
  url: string;
  draft: boolean;
  body: string;
}

export interface AssetInfo {
  id: number;
  name: string;
}

/** A repository ruleset that targets tags, reduced to what the preflight needs. */
export interface TagRuleset {
  name: string;
  /** Whether the ruleset is enforced (not just evaluated) and forbids creating matching tags. */
  blocksCreation: boolean;
  include: string[];
  exclude: string[];
  hasBypass: boolean;
}

export interface CommitFile {
  path: string;
  content: Buffer;
}

/**
 * The GitHub operations the publish mode needs, at the level of what the release does. The
 * production implementation talks to the REST API; tests use an in-memory one.
 */
export interface Gh {
  /** `undefined` when the token cannot tell. */
  immutableReleasesEnabled(): Promise<boolean | undefined>;
  tagRulesets(): Promise<TagRuleset[]>;
  branchHead(branch: string): Promise<string>;
  /** Tree sha of `.github/workflows` at a commit, undefined when the folder does not exist. */
  workflowsTree(commit: string): Promise<string | undefined>;
  readFile(commit: string, path: string): Promise<string | undefined>;
  /** Creates a commit on no branch: `files` on top of the tree of `parent`, child of `parent`. */
  createCommit(parent: string, files: CommitFile[], message: string): Promise<string>;
  /** Creates the tag; `exists` when it is already taken, which is what makes the tag a lock. */
  createTag(tag: string, commit: string): Promise<'created' | 'exists'>;
  /** Creates the tag or moves it to another commit. */
  forceTag(tag: string, commit: string): Promise<void>;
  /** Commit a tag points at, undefined when the tag does not exist. */
  tagCommit(tag: string): Promise<string | undefined>;
  /** Tags whose name starts with `prefix`, without the refs/tags/ part. */
  listTags(prefix: string): Promise<string[]>;
  createDraftRelease(input: {
    tag: string;
    commit: string;
    body: string;
    prerelease: boolean;
  }): Promise<ReleaseInfo>;
  updateRelease(
    id: number,
    patch: { body?: string; draft?: boolean; latest?: boolean },
  ): Promise<ReleaseInfo>;
  /** The most recent draft Release: an incomplete release that `resume` can finish. */
  latestDraft(): Promise<ReleaseInfo | undefined>;
  listAssets(release: number): Promise<AssetInfo[]>;
  uploadAsset(release: number, name: string, data: Buffer): Promise<void>;
  downloadAsset(asset: number): Promise<Buffer>;
  /** Shas of the commits in `from..to`, newest first, at most 100. */
  commitsBetween(from: string | undefined, to: string): Promise<string[]>;
  mergedPullRequests(commit: string): Promise<number[]>;
  closingIssues(pullRequest: number): Promise<number[]>;
  comment(number: number, body: string): Promise<void>;
}

function status(error: unknown): number | undefined {
  return (error as { status?: number }).status;
}

export function createGh(octokit: Octokit, owner: string, repo: string): Gh {
  const base = { owner, repo };
  const toRelease = (r: {
    id: number;
    tag_name: string;
    html_url: string;
    draft: boolean;
    body?: string | null;
  }): ReleaseInfo => ({ id: r.id, tag: r.tag_name, url: r.html_url, draft: r.draft, body: r.body ?? '' });

  return {
    async immutableReleasesEnabled() {
      try {
        const { data } = await octokit.request('GET /repos/{owner}/{repo}/immutable-releases', base);
        return Boolean((data as { enabled?: boolean }).enabled);
      } catch {
        return undefined;
      }
    },

    async tagRulesets() {
      try {
        const { data: list } = await octokit.request('GET /repos/{owner}/{repo}/rulesets', {
          ...base,
          includes_parents: true,
          targets: 'tag',
        });
        const rulesets: TagRuleset[] = [];
        for (const summary of list as Array<{ id: number; target?: string; enforcement?: string }>) {
          if (summary.target !== 'tag' || summary.enforcement !== 'active') continue;
          const { data } = await octokit.request('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}', {
            ...base,
            ruleset_id: summary.id,
          });
          const detail = data as {
            name: string;
            rules?: Array<{ type: string }>;
            conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
            bypass_actors?: unknown[];
          };
          rulesets.push({
            name: detail.name,
            blocksCreation: (detail.rules ?? []).some((rule) => rule.type === 'creation'),
            include: detail.conditions?.ref_name?.include ?? [],
            exclude: detail.conditions?.ref_name?.exclude ?? [],
            hasBypass: (detail.bypass_actors ?? []).length > 0,
          });
        }
        return rulesets;
      } catch {
        return [];
      }
    },

    async branchHead(branch) {
      const { data } = await octokit.rest.repos.getBranch({ ...base, branch });
      return data.commit.sha;
    },

    async workflowsTree(commit) {
      const { data: c } = await octokit.rest.git.getCommit({ ...base, commit_sha: commit });
      const { data: root } = await octokit.rest.git.getTree({ ...base, tree_sha: c.tree.sha });
      const dotGithub = root.tree.find((e) => e.path === '.github' && e.type === 'tree');
      if (!dotGithub?.sha) return undefined;
      const { data: inner } = await octokit.rest.git.getTree({ ...base, tree_sha: dotGithub.sha });
      return inner.tree.find((e) => e.path === 'workflows' && e.type === 'tree')?.sha;
    },

    async readFile(commit, path) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          ...base,
          path,
          ref: commit,
          mediaType: { format: 'raw' },
        });
        return String(data);
      } catch (error) {
        if (status(error) === 404) return undefined;
        throw error;
      }
    },

    async createCommit(parent, files, message) {
      const { data: parentCommit } = await octokit.rest.git.getCommit({ ...base, commit_sha: parent });
      const tree = [];
      for (const file of files) {
        const { data: blob } = await octokit.rest.git.createBlob({
          ...base,
          content: file.content.toString('base64'),
          encoding: 'base64',
        });
        tree.push({ path: file.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha });
      }
      const { data: newTree } = await octokit.rest.git.createTree({
        ...base,
        base_tree: parentCommit.tree.sha,
        tree,
      });
      // Neither author nor committer is set, so GitHub signs the commit as github-actions[bot].
      const { data: commit } = await octokit.rest.git.createCommit({
        ...base,
        message,
        tree: newTree.sha,
        parents: [parent],
      });
      return commit.sha;
    },

    async createTag(tag, commit) {
      try {
        await octokit.rest.git.createRef({ ...base, ref: `refs/tags/${tag}`, sha: commit });
        return 'created';
      } catch (error) {
        if (status(error) === 422) return 'exists';
        throw error;
      }
    },

    async forceTag(tag, commit) {
      try {
        await octokit.rest.git.updateRef({ ...base, ref: `tags/${tag}`, sha: commit, force: true });
      } catch (error) {
        if (status(error) !== 404 && status(error) !== 422) throw error;
        await octokit.rest.git.createRef({ ...base, ref: `refs/tags/${tag}`, sha: commit });
      }
    },

    async tagCommit(tag) {
      try {
        const { data } = await octokit.rest.git.getRef({ ...base, ref: `tags/${tag}` });
        return data.object.sha;
      } catch (error) {
        if (status(error) === 404) return undefined;
        throw error;
      }
    },

    async listTags(prefix) {
      try {
        const refs = await octokit.paginate(octokit.rest.git.listMatchingRefs, {
          ...base,
          ref: `tags/${prefix}`,
        });
        return refs.map((r) => r.ref.replace(/^refs\/tags\//, ''));
      } catch (error) {
        if (status(error) === 404) return [];
        throw error;
      }
    },

    async createDraftRelease({ tag, commit, body, prerelease }) {
      const { data } = await octokit.rest.repos.createRelease({
        ...base,
        tag_name: tag,
        target_commitish: commit,
        name: tag,
        body,
        draft: true,
        prerelease,
        make_latest: 'false',
      });
      return toRelease(data);
    },

    async updateRelease(id, patch) {
      const { data } = await octokit.rest.repos.updateRelease({
        ...base,
        release_id: id,
        body: patch.body,
        draft: patch.draft,
        make_latest: patch.latest === undefined ? undefined : patch.latest ? 'true' : 'false',
      });
      return toRelease(data);
    },

    async latestDraft() {
      const { data } = await octokit.rest.repos.listReleases({ ...base, per_page: 30 });
      const draft = data.find((r) => r.draft);
      return draft ? toRelease(draft) : undefined;
    },

    async listAssets(release) {
      const assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
        ...base,
        release_id: release,
      });
      return assets.map((a) => ({ id: a.id, name: a.name }));
    },

    async uploadAsset(release, name, data) {
      await octokit.rest.repos.uploadReleaseAsset({
        ...base,
        release_id: release,
        name,
        data: data as unknown as string,
        headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
      });
    },

    async downloadAsset(asset) {
      const { data } = await octokit.rest.repos.getReleaseAsset({
        ...base,
        asset_id: asset,
        headers: { accept: 'application/octet-stream' },
      });
      return Buffer.from(data as unknown as ArrayBuffer);
    },

    async commitsBetween(from, to) {
      if (!from) {
        const { data } = await octokit.rest.repos.listCommits({ ...base, sha: to, per_page: 100 });
        return data.map((c) => c.sha);
      }
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        ...base,
        basehead: `${from}...${to}`,
        per_page: 100,
      });
      return data.commits.map((c) => c.sha).reverse();
    },

    async mergedPullRequests(commit) {
      const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        ...base,
        commit_sha: commit,
      });
      return data.filter((pr) => pr.merged_at).map((pr) => pr.number);
    },

    async closingIssues(pullRequest) {
      const result = await octokit.graphql<{
        repository: { pullRequest: { closingIssuesReferences: { nodes: Array<{ number: number }> } } };
      }>(
        `query($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $number) { closingIssuesReferences(first: 20) { nodes { number } } }
          }
        }`,
        { ...base, number: pullRequest },
      );
      return result.repository.pullRequest.closingIssuesReferences.nodes.map((n) => n.number);
    },

    async comment(number, body) {
      await octokit.rest.issues.createComment({ ...base, issue_number: number, body });
    },
  };
}
