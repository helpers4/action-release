/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix } from 'node:path';
import { run } from './exec.ts';
import { ReleaseError } from './version.ts';

export const JSR_MANIFESTS = ['jsr.json', 'deno.json', 'deno.jsonc'];

/** Sets the top-level `"version"` of a JSON manifest, keeping its formatting. */
export function setJsonVersion(text: string, version: string, file: string): string {
  const parsed = JSON.parse(stripComments(text)) as { version?: unknown };
  let out: string;
  if (typeof parsed.version === 'string') {
    out = text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  } else {
    out = text.replace(/("name"\s*:\s*"[^"]*")(\s*,?)/, (_, name: string, comma: string) =>
      `${name},\n  "version": "${version}"${comma.includes(',') ? ',' : ''}`,
    );
  }
  if ((JSON.parse(stripComments(out)) as { version?: unknown }).version !== version) {
    throw new ReleaseError(`Could not write the version in ${file}.`);
  }
  return out;
}

/** Removes the comments of a JSONC text, outside strings. */
function stripComments(text: string): string {
  return text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str: string | undefined) => str ?? '');
}

type TomlSection = 'package' | 'workspace.package';

/** Sets `version` in `[package]` (or `[workspace.package]`) of a Cargo.toml, keeping its formatting. */
export function setCargoVersion(text: string, version: string, section: TomlSection, file: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start === -1) throw new ReleaseError(`${file} has no [${section}] section.`);
  for (let i = start + 1; i < lines.length && !lines[i]!.trim().startsWith('['); i++) {
    if (/^\s*version\s*=\s*"[^"]*"/.test(lines[i]!)) {
      lines[i] = lines[i]!.replace(/(version\s*=\s*)"[^"]*"/, `$1"${version}"`);
      return lines.join('\n');
    }
  }
  throw new ReleaseError(`${file} has no version in [${section}].`);
}

/** Whether `[package]` of a Cargo.toml inherits its version from the workspace. */
export const inheritsWorkspaceVersion = (text: string): boolean =>
  /^\s*version\s*(\.\s*workspace\s*=\s*true|=\s*\{\s*workspace\s*=\s*true\s*\})/m.test(packageSection(text));

const packageSection = (text: string): string => {
  const match = /^\[package\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text);
  return match?.[1] ?? '';
};

export const cargoPackageName = (text: string): string | undefined =>
  /^\s*name\s*=\s*"([^"]+)"/m.exec(packageSection(text))?.[1];

/** Version of a Cargo.toml `[package]`, if written there. */
export const cargoPackageVersion = (text: string): string | undefined =>
  /^\s*version\s*=\s*"([^"]+)"/m.exec(packageSection(text))?.[1];

export const cargoPublishes = (text: string): boolean => !/^\s*publish\s*=\s*false/m.test(packageSection(text));

/**
 * Writes the version in a manifest file (package.json, jsr.json, deno.json, Cargo.toml) and
 * returns the paths it changed (a Cargo.toml inheriting from the workspace changes the root one).
 */
export function writeVersion(cwd: string, path: string, version: string): string[] {
  const file = join(cwd, path);
  const text = readFileSync(file, 'utf8');
  const name = basename(path);
  if (name === 'package.json' || JSR_MANIFESTS.includes(name)) {
    writeFileSync(file, setJsonVersion(text, version, path));
    return [path];
  }
  if (name === 'Cargo.toml') {
    if (text.includes('[package]') && !inheritsWorkspaceVersion(text)) {
      writeFileSync(file, setCargoVersion(text, version, 'package', path));
      return [path];
    }
    const root = findUp(cwd, dirname(path), (dir) => {
      const candidate = posix.join(dir, 'Cargo.toml');
      return existsSync(join(cwd, candidate)) && readFileSync(join(cwd, candidate), 'utf8').includes('[workspace.package]');
    });
    if (root === undefined) throw new ReleaseError(`${path} inherits its version, but no [workspace.package] was found.`);
    const rootPath = posix.join(root, 'Cargo.toml');
    const rootFile = join(cwd, rootPath);
    writeFileSync(rootFile, setCargoVersion(readFileSync(rootFile, 'utf8'), version, 'workspace.package', rootPath));
    return [rootPath];
  }
  throw new ReleaseError(`${path}: unknown kind of manifest (expected package.json, jsr.json, deno.json or Cargo.toml).`);
}

/** Refreshes the workspace entries of the Cargo.lock next to the given Cargo.toml, with cargo itself. */
export function updateCargoLock(cwd: string, cargoToml: string): string[] {
  const lockDir = findUp(cwd, dirname(cargoToml), (dir) => existsSync(join(cwd, dir, 'Cargo.lock')));
  if (lockDir === undefined) return [];
  try {
    run('cargo', ['update', '--workspace', '--offline'], { cwd: join(cwd, lockDir) });
  } catch {
    run('cargo', ['update', '--workspace'], { cwd: join(cwd, lockDir) });
  }
  return [posix.join(lockDir, 'Cargo.lock')];
}

/** The nearest directory, from `start` up to the repository root, that matches. */
function findUp(cwd: string, start: string, matches: (dir: string) => boolean): string | undefined {
  let dir = posix.normalize(start === '' ? '.' : start);
  for (;;) {
    if (matches(dir)) return dir;
    if (dir === '.') return undefined;
    dir = posix.dirname(dir);
  }
}

export const readVersion = (cwd: string, path: string): string | undefined => {
  const file = join(cwd, path);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  if (basename(path) === 'Cargo.toml') return cargoPackageVersion(text);
  const version = (JSON.parse(stripComments(text)) as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
};
