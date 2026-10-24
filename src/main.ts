/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import * as core from '@actions/core';
import { runBuild } from './modes/build.js';
import { runCheck } from './modes/check.js';
import { runPublish } from './modes/publish.js';

const MODES = { build: runBuild, publish: runPublish, check: runCheck } as const;

async function main(): Promise<void> {
  const mode = core.getInput('mode') || 'build';
  if (!(mode in MODES)) {
    throw new Error(`Unknown mode "${mode}": expected build, publish or check.`);
  }
  await MODES[mode as keyof typeof MODES]();
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
