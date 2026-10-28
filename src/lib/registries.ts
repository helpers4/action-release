/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, parse } from 'helpers4/version';
import type { Registry, Target } from './config.ts';
import { run, shell } from './exec.ts';
import { cargoPackageName } from './manifests.ts';
import { ReleaseError } from './version.ts';

export type Fetch = typeof fetch;

/** Name of the package on its registry, from its manifest. */
export function packageName(cwd: string, target: Target): string {
  const text = readFileSync(join(cwd, target.manifest), 'utf8');
  const name = target.registry === 'crates' ? cargoPackageName(text) : (JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')) as { name?: string }).name;
  if (!name) throw new ReleaseError(`${target.manifest} has no package name.`);
  return name;
}

const USER_AGENT = 'helpers4-action-release (https://github.com/helpers4/action-release)';

/** Whether the registry already serves `name@version`. */
export async function isPublished(registry: Registry, name: string, version: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  const url =
    registry === 'npm'
      ? `https://registry.npmjs.org/${name.replace('/', '%2F')}`
      : registry === 'crates'
        ? `https://crates.io/api/v1/crates/${name}/${version}`
        : `https://jsr.io/${name}/meta.json`;
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
  if (response.status === 404) return false;
  if (!response.ok) throw new ReleaseError(`${registry} answered ${response.status} for ${name}: cannot tell whether ${version} is published.`);
  if (registry === 'crates') return true;
  const body = (await response.json()) as { versions?: Record<string, unknown> };
  return Boolean(body.versions && version in body.versions);
}

/**
 * npm dist-tag: `latest` for a stable version not lower than every released stable one, the
 * prerelease identifier for a prerelease (`beta`), and `release-X.Y` for an older line.
 */
export function distTag(version: string, stableVersions: readonly string[]): string {
  const parsed = parse(version);
  if (parsed.prerelease.length > 0) return String(parsed.prerelease[0]);
  const higher = stableVersions.some((v) => compare(v, version) > 0);
  return higher ? `release-${parsed.major}.${parsed.minor}` : 'latest';
}

type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

export function packageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

const jsrCli = (): string => fileURLToPath(new URL('../../node_modules/jsr/dist/bin.js', import.meta.url));

export interface RunContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
}

/** The project's build of a target: its configured command, or the `build` script of an npm package. */
export function build(target: Target, ctx: RunContext): void {
  const dir = join(ctx.cwd, target.path);
  if (target.build) {
    ctx.log(`$ ${target.build}`);
    shell(target.build, { cwd: ctx.cwd, env: ctx.env });
    return;
  }
  if (target.registry !== 'npm') return;
  const scripts = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts;
  if (!scripts?.build) return;
  const pm = packageManager(ctx.cwd);
  ctx.log(`$ ${pm} run build`);
  run(pm, ['run', 'build'], { cwd: dir, env: ctx.env, inherit: true });
}

/** Packs an npm target with the project's package manager (it resolves workspace: and catalog:). */
function pack(target: Target, ctx: RunContext, destination: string): string {
  const dir = join(ctx.cwd, target.path);
  const pm = packageManager(ctx.cwd);
  const args =
    pm === 'yarn' ? ['pack', '--out', join(destination, '%s-%v.tgz')] : pm === 'bun' ? ['pm', 'pack', '--destination', destination] : ['pack', '--pack-destination', destination];
  run(pm, args, { cwd: dir, env: ctx.env, inherit: true });
  const tarball = readdirSync(destination).find((file) => file.endsWith('.tgz'));
  if (!tarball) throw new ReleaseError(`${pm} pack produced no tarball for ${target.path}.`);
  return join(destination, tarball);
}

/**
 * Runs the registry's own dry-run of the publication. npm runs from a scratch directory: in the
 * repository, it would obey the project's package manager pins (devEngines).
 */
export function dryRun(target: Target, tag: string, ctx: RunContext): void {
  if (target.registry === 'npm') {
    const scratch = mkdtempSync(join(tmpdir(), 'h4-pack-'));
    try {
      const tarball = pack(target, ctx, scratch);
      run('npm', ['publish', tarball, '--dry-run', '--access', 'public', '--tag', tag], { cwd: scratch, env: ctx.env, inherit: true });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } else if (target.registry === 'crates') {
    run('cargo', ['publish', '--dry-run', '--locked', '--allow-dirty', '--manifest-path', join(ctx.cwd, target.manifest)], { cwd: ctx.cwd, env: ctx.env, inherit: true });
  } else {
    run(process.execPath, [jsrCli(), 'publish', '--dry-run', '--allow-dirty'], { cwd: join(ctx.cwd, target.path), env: ctx.env, inherit: true });
  }
}

/** Publishes a target with its registry's standard tool and OIDC trusted publishing. */
export function publish(target: Target, tag: string, ctx: RunContext): void {
  if (target.registry === 'npm') {
    const scratch = mkdtempSync(join(tmpdir(), 'h4-pack-'));
    try {
      const tarball = pack(target, ctx, scratch);
      run('npm', ['publish', tarball, '--access', 'public', '--tag', tag], { cwd: scratch, env: ctx.env, inherit: true });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } else if (target.registry === 'crates') {
    if (!ctx.env.CARGO_REGISTRY_TOKEN) {
      throw new ReleaseError('No crates.io token: the trusted publishing exchange did not run. Check the trusted publisher of the crate (repository, workflow, environment).');
    }
    run('cargo', ['publish', '--locked', '--manifest-path', join(ctx.cwd, target.manifest)], { cwd: ctx.cwd, env: ctx.env, inherit: true });
  } else {
    run(process.execPath, [jsrCli(), 'publish'], { cwd: join(ctx.cwd, target.path), env: ctx.env, inherit: true });
  }
}
