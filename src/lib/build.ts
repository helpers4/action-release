/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { resolveCommand } from 'package-manager-detector';
import { carryChangelog, generateSection } from './changelog.js';
import { detectTooling, type Tooling } from './detect.js';
import { distTagFor } from './dist-tag.js';
import { listFiles } from './files.js';
import { git, gitRaw, showFile } from './git.js';
import { writeVersion, type ReleaseManifest, type ResumeManifest } from './manifest.js';
import { fetchNpmVersions, type VersionFetcher } from './npm-registry.js';
import { parseRegistries } from './registries.js';
import { run, runShell, type RunOptions } from './run.js';
import { commitsInRange, findLastRelease, listReleaseTags } from './tags.js';
import { baseFromManifest, nextVersion, type Bump } from './version.js';
import semver from 'semver';

export interface BuildOptions {
  repoDir: string;
  /** Directory receiving release.json, the tarball, the notes and the files to commit. */
  outDir: string;
  bump: Bump;
  /** Package path relative to the repository root; empty for the root. */
  packageRel: string;
  setup: string;
  build: string;
  registries: string;
  /** Repository-relative files carried from tag to tag. */
  carry: string[];
  prepare: string;
  /** `auto`, `true`, `false` or the directory to add to the release commit. */
  includeBuild: string;
  /** Command running git-cliff. */
  cliff?: string[];
  fetchVersions?: VersionFetcher;
  log?: (message: string) => void;
  stdio?: RunOptions['stdio'];
}

export const CHANGELOG = 'CHANGELOG.md';

/** Files git reports as modified or untracked, relative to the repository root. */
function changedFiles(repoDir: string): Set<string> {
  const out = gitRaw(repoDir, 'status', '--porcelain=v1', '--untracked-files=all', '-z');
  const files = new Set<string>();
  const entries = out.split('\0').filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    files.add(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return files;
}

/** Resolves the `include-build` input to a repository-relative directory, if any. */
export function resolveIncludeBuild(input: string, repoDir: string, packageRel: string): string | undefined {
  const value = input.trim();
  if (value === 'false' || value === '') return undefined;
  const isAction = packageRel === '' && existsSync(join(repoDir, 'action.yml'));
  if (value === 'auto') return isAction ? 'dist' : undefined;
  if (value === 'true') {
    if (!isAction) throw new Error('include-build needs action.yml at the root of the repository.');
    return 'dist';
  }
  return value;
}

function ensurePackageManager(tooling: Tooling, cwd: string, stdio: RunOptions['stdio']): void {
  if (!tooling.pinned || tooling.pm === 'npm') return;
  try {
    run('corepack', ['enable'], { cwd, stdio });
  } catch {
    // Recent Node releases no longer bundle corepack.
    run('npm', ['install', '--global', 'corepack'], { cwd, stdio });
    run('corepack', ['enable'], { cwd, stdio });
  }
}

function install(tooling: Tooling, cwd: string, stdio: RunOptions['stdio']): void {
  const frozen = resolveCommand(tooling.pm, 'frozen', []);
  if (!frozen) throw new Error(`Package manager ${tooling.pm} is not supported.`);
  run(frozen.command, frozen.args, { cwd, stdio });
}

function pack(tooling: Tooling, packageDir: string, destination: string, stdio: RunOptions['stdio']): string {
  mkdirSync(destination, { recursive: true });
  if (tooling.pm === 'pnpm') {
    // pnpm resolves catalog: and workspace: ranges and honours publishConfig.directory.
    run('pnpm', ['pack', '--pack-destination', destination], { cwd: packageDir, stdio });
  } else {
    const target = tooling.publishDir ? resolve(packageDir, tooling.publishDir) : packageDir;
    run('npm', ['pack', target, '--pack-destination', destination, '--ignore-scripts'], { cwd: packageDir, stdio });
  }
  const tarballs = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`Expected one tarball in ${destination}, found ${tarballs.length}.`);
  return tarballs[0]!;
}

function tarballVersion(tarball: string): string {
  const json = run('tar', ['-xzOf', tarball, 'package/package.json'], { cwd: dirname(tarball), stdio: 'pipe' });
  return (JSON.parse(json) as { version?: string }).version ?? '';
}

/**
 * The build job: computes the version, builds, packs, dry-runs every registry and writes what
 * the publish job needs into `outDir`. Everything it changes stays in the working tree.
 */
export async function buildRelease(options: BuildOptions): Promise<ReleaseManifest | ResumeManifest> {
  const { repoDir, outDir, stdio } = options;
  const log = options.log ?? (() => undefined);
  mkdirSync(outDir, { recursive: true });

  if (options.bump === 'resume') {
    const resume: ResumeManifest = { schema: 1, resume: true };
    writeFileSync(join(outDir, 'release.json'), `${JSON.stringify(resume, null, 2)}\n`);
    return resume;
  }
  const bump = options.bump;
  const registries = parseRegistries(options.registries);

  const packageDir = resolve(repoDir, options.packageRel);
  const packageJson = join(packageDir, 'package.json');
  const tooling = await detectTooling(repoDir, packageDir);
  const name = tooling.manifest.name;
  if (!name) throw new Error(`${posix.join(options.packageRel, 'package.json')} has no "name".`);
  log(`Package ${name}, package manager ${tooling.pm}, node declared in ${tooling.nodeVersionFile ?? 'nothing (lts)'}.`);

  // Version: from the line's last stable release and the commits since.
  const baseSha = git(repoDir, 'rev-parse', 'HEAD');
  const last = findLastRelease(repoDir);
  const base = last?.version ?? baseFromManifest(tooling.manifest.version);
  const commits = commitsInRange(repoDir, last?.tag);
  const allTags = listReleaseTags(repoDir);
  const version = nextVersion({
    base,
    bump,
    commits,
    hasRelease: Boolean(last),
    existing: allTags.map((t) => t.version),
  });
  const tag = `v${version}`;
  if (allTags.some((t) => t.tag === tag)) throw new Error(`Tag ${tag} already exists.`);
  log(`Releasing ${version} (${commits.length} commit(s) since ${last?.tag ?? 'the beginning'}).`);

  if (options.setup) runShell(options.setup, { cwd: repoDir, stdio });
  ensurePackageManager(tooling, repoDir, stdio);
  install(tooling, repoDir, stdio);

  // Release-owned files: the version, then the files carried from the previous release.
  writeVersion(packageJson, version);
  const notes = generateSection({ cwd: repoDir, last: last?.tag, tag, cliff: options.cliff });
  for (const file of options.carry) {
    const target = join(repoDir, file);
    const previous = last
      ? showFile(repoDir, last.tag, file)
      : existsSync(target)
        ? readFileSync(target, 'utf8')
        : undefined;
    if (file === CHANGELOG) {
      writeFileSync(target, carryChangelog(previous, notes));
    } else if (last && previous !== undefined) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, previous);
    }
  }
  if (options.prepare) {
    runShell(options.prepare, { cwd: repoDir, stdio, env: { RELEASE_VERSION: version } });
    // A release never rewrites what a human wrote: prepare may only touch carried files.
    const allowed = new Set([...options.carry, posix.join(options.packageRel, 'package.json')]);
    const stray = [...changedFiles(repoDir)].filter((f) => !allowed.has(f));
    if (stray.length > 0) {
      throw new Error(
        `The prepare command modified files that are not carried: ${stray.join(', ')}. ` +
          'List them in the carry input, or make prepare write only generated files.',
      );
    }
  }

  const buildCommand = options.build
    ? options.build
    : tooling.hasBuildScript
      ? (() => {
          const cmd = resolveCommand(tooling.pm, 'run', ['build']);
          return cmd ? [cmd.command, ...cmd.args].join(' ') : '';
        })()
      : '';
  if (buildCommand) runShell(buildCommand, { cwd: packageDir, stdio });

  // Pack once: these exact bytes are dry-run, attested and published everywhere.
  const tarball = pack(tooling, packageDir, outDir, stdio);
  const packed = tarballVersion(join(outDir, tarball));
  if (packed !== version) {
    throw new Error(
      `The tarball contains version ${packed || '(none)'} instead of ${version}. ` +
        'When publishConfig.directory points at a build folder, the build must copy the version into it.',
    );
  }

  const published = await (options.fetchVersions ?? fetchNpmVersions)(name);
  const dist = distTagFor(version, [...(published ?? []), ...allTags.map((t) => t.version)]);

  // Dry-run on every registry, before the release becomes irreversible.
  for (const registry of registries) {
    if (registry.name !== 'npm') continue;
    log(`npm publish --dry-run (dist-tag ${dist.tag})`);
    run('npm', ['publish', join(outDir, tarball), '--dry-run', '--ignore-scripts', '--tag', dist.tag], {
      cwd: packageDir,
      stdio,
    });
  }

  let sbom: string | undefined;
  try {
    const out = run('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev'], {
      cwd: packageDir,
      stdio: 'pipe',
    });
    sbom = 'sbom.cdx.json';
    writeFileSync(join(outDir, sbom), out);
  } catch (error) {
    log(`SBOM skipped: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }

  // Files of the release commit, stored under files/ at their repository path.
  const files = new Set<string>([posix.join(options.packageRel, 'package.json')]);
  for (const file of options.carry) if (existsSync(join(repoDir, file))) files.add(file);
  const buildDir = resolveIncludeBuild(options.includeBuild, repoDir, options.packageRel);
  if (buildDir) {
    const abs = join(repoDir, buildDir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new Error(`include-build: ${buildDir} does not exist after the build.`);
    }
    for (const file of listFiles(abs)) files.add(relative(repoDir, file).split('\\').join('/'));
  }
  for (const file of files) {
    const dest = join(outDir, 'files', file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(repoDir, file), dest);
  }
  writeFileSync(join(outDir, 'notes.md'), `${notes}\n`);

  const manifest: ReleaseManifest = {
    schema: 1,
    version,
    tag,
    baseSha,
    last: last?.tag,
    bump: bump as ReleaseManifest['bump'],
    package: { name, dir: options.packageRel },
    tarball,
    distTag: dist.tag,
    latest: dist.latest,
    prerelease: semver.prerelease(version) !== null,
    registries,
    files: [...files].sort(),
    notes: 'notes.md',
    sbom,
  };
  writeFileSync(join(outDir, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
