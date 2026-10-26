/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { compare, increment, isValid, parse, sortVersions } from 'helpers4/version';

export { isValid };

/** Whether the version is valid and has no prerelease suffix. */
export function isStable(version: string): boolean {
  return isValid(version) && parse(version).prerelease.length === 0;
}

export function isPrerelease(version: string): boolean {
  return isValid(version) && parse(version).prerelease.length > 0;
}

export const major = (version: string): number => parse(version).major;
export const patch = (version: string): number => parse(version).patch;
export const minor = (version: string): number => parse(version).minor;
export const gt = (a: string, b: string): boolean => compare(a, b) > 0;
export const lt = (a: string, b: string): boolean => compare(a, b) < 0;

/** Valid versions, highest first. */
export function sortDescending(versions: readonly string[]): string[] {
  return sortVersions(versions.filter((v) => isValid(v)), { order: 'desc' });
}

export function inc(version: string, level: 'major' | 'minor' | 'patch'): string {
  return increment(version, level);
}
