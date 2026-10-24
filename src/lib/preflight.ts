/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { posix } from 'node:path';
import semver from 'semver';
import type { Gh, TagRuleset } from './github.js';
import type { ReleaseManifest } from './manifest.js';
import type { VersionFetcher } from './npm-registry.js';

export const DOCS = 'https://github.com/helpers4/action-release/blob/main/docs/troubleshooting.md';

export interface Problem {
  level: 'error' | 'warning';
  /** Stable identifier, also the anchor of the matching section in docs/troubleshooting.md. */
  code: string;
  /** What is wrong and how to fix it. */
  message: string;
}

export interface PreflightDeps {
  gh: Gh;
  fetchVersions: VersionFetcher;
  npmVersion: () => string;
  env: Record<string, string | undefined>;
}

const MIN_NPM = '11.5.1';
const PLACEHOLDER = /^0\.0\.0(-.+)?$/;

function problem(level: Problem['level'], code: string, message: string): Problem {
  return { level, code, message: `${message} See ${DOCS}#${code}` };
}

/** Matches a ruleset ref pattern (`~ALL` or a glob) against a full ref. */
export function matchesRef(pattern: string, ref: string): boolean {
  if (pattern === '~ALL') return true;
  return posix.matchesGlob(ref, pattern);
}

/** Rulesets that would refuse to create the release tag. */
export function blockingRulesets(rulesets: readonly TagRuleset[], tag: string): TagRuleset[] {
  const ref = `refs/tags/${tag}`;
  return rulesets.filter(
    (r) =>
      r.blocksCreation &&
      r.include.some((p) => matchesRef(p, ref)) &&
      !r.exclude.some((p) => matchesRef(p, ref)),
  );
}

/**
 * Everything that can be known before the tag exists. Each problem says what is wrong and how
 * to fix it, so a human or an agent can act on it without reading the code.
 */
export async function preflight(
  deps: PreflightDeps,
  manifest: Pick<ReleaseManifest, 'version' | 'tag' | 'baseSha' | 'registries' | 'package'>,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const { gh, env } = deps;
  const usesNpm = manifest.registries.some((r) => r.name === 'npm');

  if (usesNpm) {
    if (!env.ACTIONS_ID_TOKEN_REQUEST_URL) {
      problems.push(
        problem(
          'error',
          'missing-id-token',
          'The publish job cannot request an OIDC token. Add `id-token: write` to its permissions (and to the calling job when using the reusable workflow).',
        ),
      );
    }
    const npm = semver.coerce(deps.npmVersion());
    if (!npm || semver.lt(npm, MIN_NPM)) {
      problems.push(
        problem(
          'error',
          'npm-too-old',
          `npm ${npm?.version ?? 'unknown'} cannot publish with trusted publishing; npm ${MIN_NPM} or later is required. Use a Node version that ships it, or run \`npm install -g npm@latest\` first.`,
        ),
      );
    }

    const published = await deps.fetchVersions(manifest.package.name);
    if (!published) {
      problems.push(
        problem(
          'error',
          'package-missing',
          `${manifest.package.name} does not exist on npm. Trusted publishing can only be configured on an existing package: publish a first version by hand and register the trusted publisher.`,
        ),
      );
    } else {
      if (published.includes(manifest.version)) {
        problems.push(
          problem('error', 'version-published', `${manifest.package.name}@${manifest.version} is already on npm. A published version can never be reused: release again to get the next number.`),
        );
      }
      const stable = (versions: string[]) =>
        versions.filter((v) => semver.valid(v) && !semver.prerelease(v)).sort(semver.rcompare)[0];
      const tags = (await gh.listTags('v')).map((t) => t.slice(1));
      const npmTop = stable(published);
      const tagTop = stable(tags);
      if (npmTop && (!tagTop || semver.gt(npmTop, tagTop))) {
        problems.push(
          problem(
            'error',
            'npm-ahead',
            `npm has ${manifest.package.name}@${npmTop}, which is higher than every release tag (${tagTop ? `v${tagTop}` : 'none'}). A version was published outside the pipeline: tag it (git tag v${npmTop} <commit>) so the next version is computed from it.`,
          ),
        );
      }
    }
  }

  const immutable = await gh.immutableReleasesEnabled();
  if (immutable === false) {
    problems.push(
      problem(
        'warning',
        'immutable-releases',
        'Immutable releases are not enabled: the tag and the assets of this release could still be altered later. Enable them in Settings → General → Releases, or with `gh api -X PUT repos/{owner}/{repo}/immutable-releases`.',
      ),
    );
  }

  for (const ruleset of blockingRulesets(await gh.tagRulesets(), manifest.tag)) {
    problems.push(
      problem(
        ruleset.hasBypass ? 'warning' : 'error',
        'tag-ruleset',
        `Ruleset "${ruleset.name}" restricts the creation of tags like ${manifest.tag}${ruleset.hasBypass ? ' (it has bypass actors; make sure GitHub Actions is one of them)' : ' and has no bypass'}. Immutable releases already protect release tags: remove the "restrict creations" rule, or exclude v* from it.`,
      ),
    );
  }

  const manifestAtBase = await gh.readFile(
    manifest.baseSha,
    manifest.package.dir ? `${manifest.package.dir}/package.json` : 'package.json',
  );
  if (manifestAtBase) {
    const version = (JSON.parse(manifestAtBase) as { version?: string }).version;
    if (version && !PLACEHOLDER.test(version)) {
      problems.push(
        problem(
          'warning',
          'placeholder-version',
          `package.json carries version ${version} on the released branch, which the tag ${manifest.tag} will contradict. Set it to 0.0.0-development: the release writes the real version into the release commit only.`,
        ),
      );
    }
  }

  return problems;
}

/**
 * GitHub refuses a new tag when the `.github/workflows` of its commit match no branch head. If
 * the branch received a workflow change since the build, the release must stop before the tag
 * exists, while nothing is published.
 */
export async function workflowsUnchanged(gh: Gh, baseSha: string, branch: string): Promise<boolean> {
  const head = await gh.branchHead(branch);
  if (head === baseSha) return true;
  return (await gh.workflowsTree(baseSha)) === (await gh.workflowsTree(head));
}
