/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { fetchJson, HttpError } from 'helpers4/promise';

export type VersionFetcher = (name: string) => Promise<string[] | undefined>;

/**
 * Versions of a package on the npm registry, or undefined when the package does not exist
 * there (the case that needs the bootstrap procedure).
 */
export const fetchNpmVersions: VersionFetcher = async (name) => {
  try {
    const doc = await fetchJson<{ versions?: Record<string, unknown> }>(
      `https://registry.npmjs.org/${name.replace('/', '%2f')}`,
      { headers: { accept: 'application/vnd.npm.install-v1+json' } },
      { retry: { attempts: 3, delayMs: 1000 } },
    );
    return Object.keys(doc.versions ?? {});
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
};
