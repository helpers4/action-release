/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

// Entry point of each step of the composite action: `node src/main.ts <step>`.
const steps = ['prepare', 'verify', 'commit', 'publish', 'finalize'] as const;
type Step = (typeof steps)[number];

const step = process.argv[2] as Step | undefined;
if (!step || !steps.includes(step)) {
  console.error(`Usage: node src/main.ts <${steps.join('|')}>`);
  process.exit(2);
}

console.error(`::error::The ${step} step is not implemented yet.`);
process.exit(1);
