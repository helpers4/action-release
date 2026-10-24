/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('action.yml', () => {
  const manifest = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');

  it('runs the bundled entry point on node26', () => {
    expect(manifest).toContain('using: node26');
    expect(manifest).toContain('main: dist/index.mjs');
  });

  it('is named for the Marketplace', () => {
    expect(manifest).toMatch(/^name: helpers4 release$/m);
  });
});
