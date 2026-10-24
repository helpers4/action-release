/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

export type RegistryName = 'npm' | 'none';

export interface RegistryRequest {
  name: RegistryName;
  /** A failure on an optional registry is a warning, not a blocker. */
  optional: boolean;
}

const KNOWN: readonly string[] = ['npm', 'none'];

/** Parses the `registries` input, e.g. `npm` or `npm, none?`. */
export function parseRegistries(input: string): RegistryRequest[] {
  const requests = input
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((entry) => {
      const optional = entry.endsWith('?');
      const name = optional ? entry.slice(0, -1) : entry;
      if (!KNOWN.includes(name)) {
        throw new Error(`Unknown registry "${name}": expected one of ${KNOWN.join(', ')}.`);
      }
      return { name: name as RegistryName, optional };
    });
  if (requests.length === 0) throw new Error('The registries input is empty.');
  if (requests.some((r) => r.name === 'none') && requests.length > 1) {
    throw new Error('The "none" target cannot be combined with a registry.');
  }
  return requests;
}

export interface ResumePlan {
  /** Registries that still lack the version. */
  pending: RegistryRequest[];
  /** Whether every required registry has the version, so the Release can be published. */
  complete: boolean;
}

/**
 * What a `resume` run must still publish, given what each registry already serves. Running it
 * again after a success yields an empty plan, so a resume is idempotent.
 */
export function planResume(
  requested: readonly RegistryRequest[],
  published: Readonly<Record<string, boolean>>,
): ResumePlan {
  const pending = requested.filter((r) => r.name !== 'none' && !published[r.name]);
  return { pending, complete: pending.every((r) => r.optional) };
}
