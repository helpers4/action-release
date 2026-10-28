#!/usr/bin/env bash
# This file is part of helpers4.
# Copyright (C) 2025 baxyz
# SPDX-License-Identifier: LGPL-3.0-or-later
#
# The engine is TypeScript run by Node itself (type stripping): nothing is built, only the
# runtime dependencies are installed from the lockfile, in the action's own directory.
set -euo pipefail

if ! node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1);
'; then
  echo "::error::helpers4 release needs Node 22.18 or later on the PATH (found $(node --version)). Add actions/setup-node before it."
  exit 1
fi

cd "$GITHUB_ACTION_PATH"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
