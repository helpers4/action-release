/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKS } from 'package-manager-detector';
import { resolveIncludeBuild } from './build.js';
import { readPackageJson } from './manifest.js';
import { DOCS, type Problem } from './preflight.js';
import { parseRegistries } from './registries.js';

export interface CheckOptions {
  repoDir: string;
  packageRel: string;
  registries: string;
  includeBuild: string;
}

function problem(level: Problem['level'], code: string, message: string): Problem {
  return { level, code, message: `${message} See ${DOCS}#${code}` };
}

/**
 * The release checks that do not depend on the next version, for pull requests: they report
 * early what the release would otherwise stop on.
 */
export function checkRepo(options: CheckOptions): Problem[] {
  const problems: Problem[] = [];
  const packageDir = join(options.repoDir, options.packageRel);
  const packageJson = join(packageDir, 'package.json');

  let registries;
  try {
    registries = parseRegistries(options.registries);
  } catch (error) {
    problems.push(problem('error', 'invalid-registries', (error as Error).message));
  }

  if (!existsSync(packageJson)) {
    problems.push(problem('error', 'no-package', `${options.packageRel || '.'}/package.json does not exist: set the package input to the folder of the published package.`));
    return problems;
  }
  const manifest = readPackageJson(packageJson);
  if (!manifest.name) problems.push(problem('error', 'no-name', 'package.json has no "name".'));
  if (manifest.private && registries?.some((r) => r.name === 'npm')) {
    problems.push(problem('error', 'private-package', 'package.json is "private": true, which npm refuses to publish. Remove it, or use registries: none.'));
  }
  if (manifest.version && !/^0\.0\.0(-.+)?$/.test(manifest.version)) {
    problems.push(problem('warning', 'placeholder-version', `package.json carries version ${manifest.version}; the tag will contradict it. Set it to 0.0.0-development.`));
  }

  const changelog = join(options.repoDir, 'CHANGELOG.md');
  if (existsSync(changelog) && /^## \[?Unreleased/im.test(readFileSync(changelog, 'utf8'))) {
    problems.push(problem('warning', 'changelog-unreleased', 'CHANGELOG.md has an [Unreleased] section. The release generates its own changelog and cannot rename that section on main: prepare it in a pull request, or delete the file from main.'));
  }

  const hasLock = [options.repoDir, packageDir].some((dir) => Object.keys(LOCKS).some((lock) => existsSync(join(dir, lock))));
  if (!hasLock) {
    problems.push(problem('warning', 'no-lockfile', 'No lockfile found: dependencies cannot be installed from a frozen lockfile, so the build is not reproducible.'));
  }

  try {
    resolveIncludeBuild(options.includeBuild, options.repoDir, options.packageRel);
  } catch (error) {
    problems.push(problem('error', 'include-build', (error as Error).message));
  }
  return problems;
}
