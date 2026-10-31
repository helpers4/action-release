/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { Plan, PlannedTarget } from '../lib/plan.ts';

const CHECKED: Record<PlannedTarget['registry'], string> = {
  npm: 'build and `npm publish --dry-run` passed',
  crates: 'build and `cargo publish --dry-run` passed (together, in dependency order)',
  jsr: 'build and `jsr publish --dry-run` passed',
};

/** What a dry run found: the version, what was checked, what the release would write. */
export function dryRunReport(plan: Plan, bump: string): string {
  const resume = plan.state === 'resume';
  const pending = plan.targets.filter((t) => !t.published);
  const skipped = plan.targets.filter((t) => t.published);

  const facts = [
    ['Version', `\`${plan.version}\`${plan.previousTag ? ` (after \`${plan.previousTag}\`, bump: ${bump})` : ` (first release, bump: ${bump})`}`],
    ['Branch', `\`${plan.branch}\` at \`${plan.base.slice(0, 7)}\``],
    ['GitHub Release', plan.prerelease ? 'prerelease' : plan.latest ? 'latest' : 'not the latest'],
    ...(plan.targets.some((t) => t.registry === 'npm') ? [['npm dist-tag', `\`${plan.distTag}\``]] : []),
    ...(plan.floatingTag ? [['Tag moved', `\`${plan.floatingTag}\` to \`${plan.tag}\``]] : []),
  ];

  const registries = [...new Set(pending.map((t) => t.registry))];
  const checked = registries.map((registry) => {
    const names = pending.filter((t) => t.registry === registry).map((t) => `\`${t.name}@${plan.version}\``);
    return `| ${registry} | ${names.join(', ')} | ${CHECKED[registry]} |`;
  });
  const skippedRows = skipped.map((t) => `| ${t.registry} | \`${t.name}@${plan.version}\` | already published, skipped |`);

  return [
    resume
      ? `## 🧪 Dry run: ${plan.tag} is already tagged, a release would publish what is missing`
      : `## 🧪 Dry run: ${plan.tag} would be released`,
    '',
    '| | |',
    '| --- | --- |',
    ...facts.map(([name, value]) => `| ${name} | ${value} |`),
    '',
    ...(plan.targets.length > 0
      ? ['### Packages', '', '| Registry | Package | Result |', '| --- | --- | --- |', ...checked, ...skippedRows, '']
      : ['No package to publish: the release only tags and creates the GitHub Release.', '']),
    ...(resume ? [] : ['### Files the release commit would write', '', ...plan.files.map((f) => `- \`${f}\``), '']),
    '### Release notes',
    '',
    plan.notes,
    '',
    'Nothing was written.',
    '',
  ].join('\n');
}
