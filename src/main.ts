/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { actionsRuntime } from './lib/actions.ts';
import { createGh } from './lib/github.ts';
import { ReleaseError } from './lib/version.ts';
import { commit } from './steps/commit.ts';
import { finalize } from './steps/finalize.ts';
import { prepare } from './steps/prepare.ts';
import { publish } from './steps/publish.ts';
import { verify } from './steps/verify.ts';

// Entry point of each step of the composite action: `node src/main.ts <step>`.
const steps = ['prepare', 'verify', 'commit', 'publish', 'finalize'] as const;
type Step = (typeof steps)[number];

const step = process.argv[2] as Step | undefined;
if (!step || !steps.includes(step)) {
  console.error(`Usage: node src/main.ts <${steps.join('|')}>`);
  process.exit(2);
}

const runtime = actionsRuntime();
const env = process.env;
const gh = (token: string | undefined) =>
  createGh({ token: token ?? '', repository: env.GITHUB_REPOSITORY ?? '', apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com' });

try {
  if (step === 'prepare') await prepare({ runtime, gh: () => gh(env.GITHUB_TOKEN) });
  else if (step === 'verify') verify({ runtime });
  else if (step === 'commit') await commit({ runtime, appGh: gh(env.APP_TOKEN), gh: gh(env.GITHUB_TOKEN) });
  else if (step === 'publish') await publish({ runtime });
  else await finalize({ runtime, gh: gh(env.GITHUB_TOKEN) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`::error::${message.replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
  if (!(error instanceof ReleaseError) && error instanceof Error && error.stack) console.log(error.stack);
  process.exit(1);
}
