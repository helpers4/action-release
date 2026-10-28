/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { Fetch } from './registries.ts';

export interface FileChange {
  path: string;
  /** File mode in git (`100644`, `100755`). */
  mode: string;
  content: string;
}

export interface ReleaseInfo {
  id: number;
  tag: string;
  url: string;
  draft: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  parents: string[];
}

/** The GitHub operations of a release, behind one interface so that tests use a fake. */
export interface Gh {
  /** The commit the branch points to. */
  branchHead(branch: string): Promise<CommitInfo>;
  /** Creates a commit on top of `parent` (signed by GitHub for the token's identity). */
  createCommit(parent: string, files: FileChange[], message: string): Promise<string>;
  /** Moves the branch to `sha`, only as a fast-forward. Returns false when the branch moved meanwhile. */
  fastForward(branch: string, sha: string): Promise<boolean>;
  /** Creates the tag; returns false when it already exists. */
  createTag(tag: string, sha: string): Promise<boolean>;
  releaseByTag(tag: string): Promise<ReleaseInfo | undefined>;
  createDraftRelease(input: { tag: string; name: string; body: string; prerelease: boolean }): Promise<ReleaseInfo>;
  publishRelease(id: number, input: { body: string; latest: boolean }): Promise<ReleaseInfo>;
}

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface GhOptions {
  token: string;
  repository: string;
  apiUrl?: string;
  fetchImpl?: Fetch;
}

/** Gh over the REST API, with fetch. */
export function createGh({ token, repository, apiUrl = 'https://api.github.com', fetchImpl = fetch }: GhOptions): Gh {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new GitHubError(response.status, `GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };

  const toRelease = (r: { id: number; tag_name: string; html_url: string; draft: boolean }): ReleaseInfo => ({
    id: r.id,
    tag: r.tag_name,
    url: r.html_url,
    draft: r.draft,
  });

  return {
    async branchHead(branch) {
      const { object } = await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`);
      const commit = await call<{ sha: string; message: string; parents: Array<{ sha: string }> }>('GET', `/git/commits/${object.sha}`);
      return { sha: commit.sha, message: commit.message, parents: commit.parents.map((p) => p.sha) };
    },

    async createCommit(parent, files, message) {
      const { tree } = await call<{ tree: { sha: string } }>('GET', `/git/commits/${parent}`);
      const created = await call<{ sha: string }>('POST', '/git/trees', {
        base_tree: tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: f.mode, type: 'blob', content: f.content })),
      });
      const commit = await call<{ sha: string }>('POST', '/git/commits', { message, tree: created.sha, parents: [parent] });
      return commit.sha;
    },

    async fastForward(branch, sha) {
      try {
        await call('PATCH', `/git/refs/heads/${branch}`, { sha, force: false });
        return true;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 422) return false;
        throw error;
      }
    },

    async createTag(tag, sha) {
      try {
        await call('POST', '/git/refs', { ref: `refs/tags/${tag}`, sha });
        return true;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 422) return false;
        throw error;
      }
    },

    async releaseByTag(tag) {
      // Drafts are not returned by the "by tag" endpoint: list the latest releases instead.
      const releases = await call<Array<{ id: number; tag_name: string; html_url: string; draft: boolean }>>('GET', '/releases?per_page=100');
      const found = releases.find((r) => r.tag_name === tag);
      return found ? toRelease(found) : undefined;
    },

    async createDraftRelease({ tag, name, body, prerelease }) {
      return toRelease(await call('POST', '/releases', { tag_name: tag, name, body, draft: true, prerelease }));
    },

    async publishRelease(id, { body, latest }) {
      return toRelease(await call('PATCH', `/releases/${id}`, { body, draft: false, make_latest: latest ? 'true' : 'false' }));
    },
  };
}
