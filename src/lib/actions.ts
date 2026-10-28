/**
 * This file is part of helpers4.
 * Copyright (C) 2025 baxyz
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What the steps need from GitHub Actions, injected so that tests can provide their own. */
export interface Runtime {
  env: NodeJS.ProcessEnv;
  log: (message: string) => void;
  warn: (message: string) => void;
  setOutput: (name: string, value: string) => void;
}

const escape = (text: string) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export const actionsRuntime = (): Runtime => ({
  env: process.env,
  log: (message) => console.log(message),
  warn: (message) => console.log(`::warning::${escape(message)}`),
  setOutput: (name, value) => {
    const file = process.env.GITHUB_OUTPUT;
    if (!file) return;
    const delimiter = `h4_${Math.random().toString(36).slice(2)}`;
    appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  },
});

export const workspace = (env: NodeJS.ProcessEnv): string => env.GITHUB_WORKSPACE ?? process.cwd();

/** Directory shared by the steps of one run. */
export function stateDir(env: NodeJS.ProcessEnv): string {
  const dir = join(env.RUNNER_TEMP ?? tmpdir(), 'h4-release');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveJson(env: NodeJS.ProcessEnv, name: string, value: unknown): void {
  writeFileSync(join(stateDir(env), name), `${JSON.stringify(value, null, 2)}\n`);
}

export function loadJson<T>(env: NodeJS.ProcessEnv, name: string): T {
  const file = join(stateDir(env), name);
  if (!existsSync(file)) throw new Error(`${name} is missing: the prepare step did not run in this job.`);
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export const isTrue = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'true';
