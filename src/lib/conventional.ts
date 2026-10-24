/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { CommitInfo } from './tags.js';

export interface ConventionalCommit {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?: (?<description>.+)$/i;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;

/** Parses a Conventional Commit; returns undefined for any other message. */
export function parseCommit(commit: Pick<CommitInfo, 'subject' | 'body'>): ConventionalCommit | undefined {
  const match = HEADER.exec(commit.subject);
  if (!match?.groups) return undefined;
  const { type, scope, bang, description } = match.groups;
  return {
    type: type!.toLowerCase(),
    scope: scope || undefined,
    breaking: bang === '!' || BREAKING_FOOTER.test(commit.body),
    description: description!,
  };
}
