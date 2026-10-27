/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import type { PublishResult } from './publish.js';

export interface Summary {
  /** One line for the log and the run annotation. */
  headline: string;
  /** Markdown for the job summary. */
  markdown: string;
}

/** What the run shows once the release is done: version, where it is, how to check it. */
export function renderSummary(result: PublishResult, repository: string): Summary {
  const { packageName, version, tag, distTag, releaseUrl, published } = result;
  const npmUrl = `https://www.npmjs.com/package/${packageName}/v/${version}`;
  const onNpm = published.npm === true;

  const headline = result.dryRun
    ? `Dry run: ${tag} would be released. Nothing was published.`
    : onNpm
      ? `${packageName}@${version} is published on npm: ${npmUrl}`
      : `${tag} is released: ${releaseUrl ?? ''}`;

  if (result.dryRun) {
    return {
      headline,
      markdown: `## 🧪 Dry run\n\n**${tag}** would be released. No tag, no Release, nothing published.\n`,
    };
  }

  const rows = [
    onNpm ? `| npm | ✅ [\`${packageName}@${version}\`](${npmUrl}) (dist-tag \`${distTag}\`) |` : '',
    `| GitHub Release | ✅ [${tag}](${releaseUrl ?? ''}) |`,
    '| Provenance | ✅ attested (SLSA) |',
  ].filter(Boolean);

  const markdown = [
    `## 🎉 ${onNpm ? `${packageName} ${version} is published` : `${tag} is released`}`,
    '',
    '| Where | Link |',
    '| --- | --- |',
    ...rows,
    '',
    'Check the tarball you can download from the Release:',
    '',
    '```bash',
    `gh release download ${tag} -R ${repository} --pattern '*.tgz'`,
    `gh attestation verify *.tgz --repo ${repository}`,
    '```',
    '',
  ].join('\n');
  return { headline, markdown };
}
