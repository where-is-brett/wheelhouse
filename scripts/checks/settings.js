// scripts/checks/settings.js
// What a check runs, read from the default branch and never from the folder or the branch being checked (spec 4.2):
// a branch can't change its own check, and neither can a person's unfinished work.
import { readConfig } from '../gate/guardrails.js';

const CONFIG_FILE = '.claude/wheelhouse.json';
export const DEFAULT_MINUTES = 20;

// The settings a check needs, with their defaults. `where` is left null when the file doesn't fix it.
export function checksSettings(config) {
  const checks = config?.checks ?? {};
  return {
    testCommand: config?.testCommand ?? null,
    prepare: checks.prepare ?? null,
    minutes: checks.minutes ?? DEFAULT_MINUTES,
    network: checks.network === true,
    where: checks.where ?? null,
  };
}

// The configuration at `ref`, read by `git` in the helper's mirror or the home; the empty configuration when `ref` has
// no such file. A file that can't be read throws, as any reading of it does.
export async function checksConfig({ git, ref }) {
  const must = async (args) => {
    const got = await git(args);
    if (got.code !== 0) throw new Error(`The default branch could not be read: ${String(got.stderr).trim()}`);
    return got.stdout;
  };
  const present = await must(['ls-tree', '--name-only', ref, '--', CONFIG_FILE]);
  return readConfig(present.trim() === '' ? null : await must(['show', `${ref}:${CONFIG_FILE}`]));
}
