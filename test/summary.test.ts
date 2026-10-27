/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import type { PublishResult } from '../src/lib/publish.js';
import { renderSummary } from '../src/lib/summary.js';

const base: PublishResult = {
  packageName: 'folioscope',
  distTag: 'latest',
  version: '0.0.3',
  tag: 'v0.0.3',
  releaseUrl: 'https://github.com/baxyz/folioscope/releases/tag/v0.0.3',
  published: { npm: true },
  dryRun: false,
};

describe('renderSummary', () => {
  it('says the package is published, with its version and the npm link', () => {
    const { headline, markdown } = renderSummary(base, 'baxyz/folioscope');
    expect(headline).toBe('folioscope@0.0.3 is published on npm: https://www.npmjs.com/package/folioscope/v/0.0.3');
    expect(markdown).toContain('folioscope 0.0.3 is published');
    expect(markdown).toContain('https://www.npmjs.com/package/folioscope/v/0.0.3');
    expect(markdown).toContain('dist-tag `latest`');
    expect(markdown).toContain('gh attestation verify *.tgz --repo baxyz/folioscope');
  });

  it('does not mention npm when the release has no npm target', () => {
    const { headline, markdown } = renderSummary({ ...base, published: {} }, 'baxyz/folioscope');
    expect(headline).toBe(`v0.0.3 is released: ${base.releaseUrl}`);
    expect(markdown).not.toContain('npmjs.com');
  });

  it('says nothing was published on a dry run', () => {
    const { headline, markdown } = renderSummary({ ...base, published: {}, dryRun: true, releaseUrl: undefined }, 'baxyz/folioscope');
    expect(headline).toContain('Dry run');
    expect(markdown).not.toContain('published on');
    expect(markdown).not.toContain('npmjs.com');
  });
});
