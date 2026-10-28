/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const main = new URL('../src/main.ts', import.meta.url).pathname;

describe('main', () => {
  it('runs as plain TypeScript with Node, and rejects an unknown step', () => {
    const run = spawnSync(process.execPath, [main, 'nope'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage: node src/main.ts <prepare|verify|commit|publish|finalize>');
  });
});
