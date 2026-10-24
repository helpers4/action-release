/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { attestProvenance } from '@actions/attest';

/** Signs a tarball with GitHub's Sigstore instance and stores the attestation; returns the bundle. */
export async function attestTarball(
  subject: { name: string; sha256: string },
  token: string,
): Promise<Buffer> {
  const attestation = await attestProvenance({
    subjects: [{ name: subject.name, digest: { sha256: subject.sha256 } }],
    token,
  });
  return Buffer.from(`${JSON.stringify(attestation.bundle)}\n`);
}
