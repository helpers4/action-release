/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, parse } from 'helpers4/version';
import type { Registry, Target } from './config.ts';
import { run, shell } from './exec.ts';
import { cargoMetadata, cargoPackageName, readVersion } from './manifests.ts';
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

/**
 * The version the registry tool will publish: `cargo metadata` resolves `version.workspace`; npm
 * and JSR take the one of their manifest (the npm tarball is checked again once packed).
 */
export function versionToPublish(target: Target, cwd: string): string | undefined {
  if (target.registry !== 'crates') return readVersion(cwd, target.manifest);
  const manifest = resolve(cwd, target.manifest);
  return cargoMetadata(manifest).packages.find((p) => p.manifest_path === manifest)?.version;
}

/** Packs an npm target with the project's package manager (it resolves workspace: and catalog:). */
function pack(target: Target, ctx: RunContext, destination: string, version: string): string {
  const dir = join(ctx.cwd, target.path);
  const pm = packageManager(ctx.cwd);
  const args =
    pm === 'yarn' ? ['pack', '--out', join(destination, '%s-%v.tgz')] : pm === 'bun' ? ['pm', 'pack', '--destination', destination] : ['pack', '--pack-destination', destination];
  run(pm, args, { cwd: dir, env: ctx.env, inherit: true });
  const tarball = readdirSync(destination).find((file) => file.endsWith('.tgz'));
  if (!tarball) throw new ReleaseError(`${pm} pack produced no tarball for ${target.path}.`);
  const path = join(destination, tarball);
  const packed = (JSON.parse(run('tar', ['-xzOf', path, 'package/package.json'], { cwd: destination })) as { version?: string }).version;
  if (packed !== version) throw new ReleaseError(`The tarball of ${target.path} has version ${packed}, not ${version}: it is not published.`);
  return path;
}

/**
 * Runs the registry's own dry-run of the publication. npm runs from a scratch directory: in the
 * repository, it would obey the project's package manager pins (devEngines).
 */
export function dryRun(target: Target, version: string, tag: string, ctx: RunContext): void {
  if (target.registry === 'crates') throw new ReleaseError('Crates are published together: use dryRunCrates.');
  if (target.registry === 'npm') {
    const scratch = mkdtempSync(join(tmpdir(), 'h4-pack-'));
    try {
      const tarball = pack(target, ctx, scratch, version);
      run('npm', ['publish', tarball, '--dry-run', '--access', 'public', '--tag', tag], { cwd: scratch, env: ctx.env, inherit: true });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } else if (target.registry === 'jsr') {
    run(process.execPath, [jsrCli(), 'publish', '--dry-run', '--allow-dirty'], { cwd: join(ctx.cwd, target.path), env: ctx.env, inherit: true });
  }
}

/** Publishes a target with its registry's standard tool and OIDC trusted publishing. */
export function publish(target: Target, version: string, tag: string, ctx: RunContext): void {
  if (target.registry === 'crates') throw new ReleaseError('Crates are published together: use publishCrates.');
  if (target.registry === 'npm') {
    const scratch = mkdtempSync(join(tmpdir(), 'h4-pack-'));
    try {
      const tarball = pack(target, ctx, scratch, version);
      run('npm', ['publish', tarball, '--access', 'public', '--tag', tag], { cwd: scratch, env: ctx.env, inherit: true });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } else if (target.registry === 'jsr') {
    run(process.execPath, [jsrCli(), 'publish'], { cwd: join(ctx.cwd, target.path), env: ctx.env, inherit: true });
  }
}

export type CrateTarget = Target & { name: string };

/** One cargo call per workspace: cargo orders its crates by their dependencies and checks each one. */
function crateCalls(targets: readonly CrateTarget[], cwd: string): Array<{ manifest: string; packages: string[] }> {
  const calls = new Map<string, { manifest: string; packages: string[] }>();
  for (const target of targets) {
    const manifest = resolve(cwd, target.manifest);
    const root = cargoMetadata(manifest).workspace_root;
    const call = calls.get(root) ?? { manifest, packages: [] };
    call.packages.push(target.name);
    calls.set(root, call);
  }
  return [...calls.values()];
}

const cratePackages = (names: readonly string[]) => names.flatMap((name) => ['-p', name]);

/** `cargo publish --dry-run` of the given crates, together (the later ones need the new version of the earlier ones). */
export function dryRunCrates(targets: readonly CrateTarget[], ctx: RunContext): void {
  for (const call of crateCalls(targets, ctx.cwd)) {
    run('cargo', ['publish', '--dry-run', '--locked', '--allow-dirty', '--manifest-path', call.manifest, ...cratePackages(call.packages)], { cwd: ctx.cwd, env: ctx.env, inherit: true });
  }
}

/** `cargo publish` of the given crates, together, with the OIDC token of crates.io. */
export function publishCrates(targets: readonly CrateTarget[], ctx: RunContext): void {
  if (!ctx.env.CARGO_REGISTRY_TOKEN) {
    throw new ReleaseError('No crates.io token: the trusted publishing exchange did not run. Check the trusted publisher of the crate (repository, workflow, environment).');
  }
  for (const call of crateCalls(targets, ctx.cwd)) {
    run('cargo', ['publish', '--locked', '--manifest-path', call.manifest, ...cratePackages(call.packages)], { cwd: ctx.cwd, env: ctx.env, inherit: true });
  }
}

/** crates.io refuses a crate archive larger than this. */
export const CRATE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * What crates.io would refuse, found before anything is written: no description or no license
 * (cargo only warns locally). A missing repository is only a warning: trusted publishing and
 * crates.io do not need it.
 */
export function crateProblems(targets: readonly CrateTarget[], cwd: string): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const target of targets) {
    const manifest = resolve(cwd, target.manifest);
    const pkg = cargoMetadata(manifest).packages.find((p) => p.manifest_path === manifest);
    if (!pkg) throw new ReleaseError(`${target.manifest} is not a member of its workspace.`);
    if (!pkg.description) problems.push(`${target.name}: no description in ${target.manifest} (crates.io requires one)`);
    if (!pkg.license && !pkg.license_file) problems.push(`${target.name}: no license or license-file in ${target.manifest} (crates.io requires one)`);
    if (!pkg.repository) warnings.push(`${target.name}: no repository in ${target.manifest}`);
  }
  return { problems, warnings };
}

/** Crates whose archive, made by the dry-run, is too large for crates.io. */
export function oversizedCrates(targets: readonly CrateTarget[], version: string, cwd: string): string[] {
  return targets.flatMap((target) => {
    const manifest = resolve(cwd, target.manifest);
    const archive = join(cargoMetadata(manifest).target_directory, 'package', `${target.name}-${version}.crate`);
    const size = existsSync(archive) ? statSync(archive).size : 0;
    return size > CRATE_MAX_BYTES ? [`${target.name}: ${(size / 1024 / 1024).toFixed(1)} MB, more than the 10 MB crates.io accepts`] : [];
  });
}
