// adapters/copilot/sandbox.js
// The settings that put Copilot's sandbox round the CLI's steps under the build engine, and the rule for when they
// may be written (design section 6.4, level 1; Archon design section 4.5). They live in the clean home
// (scripts/agents/copilot/engine-home.js), so one set covers every Copilot step on the computer (plan choice 1).
//
// Key names, read on 2 November 2026 from
// https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings and
// https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/cloud-and-local-sandboxes/configuring-local-sandbox-settings
// (settings.json in the CLI's config folder; the first page lists the same keys for managed settings):
//   sandbox.enabled                                the sandbox on
//   sandbox.failIfUnavailable                      fail closed where the host can't sandbox
//   sandbox.allowBypass                            whether Copilot may ask to run a command outside the sandbox
//   sandbox.addCurrentWorkingDirectory             the working folder is writable: the CLI's working-folder form (choice 1)
//   sandbox.userPolicy.filesystem.readwritePaths   / readonlyPaths / deniedPaths
//   sandbox.userPolicy.network.allowOutbound       / allowLocalNetwork / allowedHosts / blockedHosts / proxy.url
// What the pages don't say is how these combine: whether `allowedHosts` limits a network that `allowOutbound` leaves
// closed, and how a unix socket (the helper's) is let through. This module reads them as: outbound off, listed hosts
// allowed, the local network off, the helper's socket among the read-write paths. UNTRIED: the sandbox test
// (scripts/agents/copilot/sandbox-test.js) is what shows whether they hold, and sandboxLevel() refuses until a run has
// passed on this computer for these settings.
// Writes are held to the step's working folder, which the CLI is started in (the engine's worktree); the level's record
// says writes are held to the working folder and not to one run's worktree alone.
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { COPILOT_SANDBOX_CHECKED } from '../../scripts/lib/copilot-numbers.js';
import { credentialPaths } from '../../scripts/lib/credentials.js';
import { archonHome, keysDir } from '../../scripts/lib/paths.js';
import { PRIVATE_FILES, PRIVATE_FOLDERS } from '../../scripts/protection/archon.js';
import { cleanDomain } from '../../scripts/protection/settings.js';

// The settings file in the clean home, and the computer's result file under the Wheelhouse home.
export const SETTINGS_FILE = 'settings.json';
export const RESULT_FILE = 'copilot-sandbox.json';
// What a level's record says about where writes are held (plan choice 1).
export const WRITES_SCOPE = 'working-folder';

const unique = (list) => [...new Set(list)];

// The paths a sandboxed step may not read: the keys, Copilot's and the agents' own folders, the credential folders
// and Archon's private files.
export function deniedReads({ platform = process.platform, homedir = os.homedir(), archon = archonHome() } = {}) {
  return unique([
    keysDir(),
    path.join(homedir, '.copilot'),
    path.join(homedir, '.agents'),
    ...credentialPaths(platform).map((p) => path.join(homedir, ...p.split('/'))),
    ...PRIVATE_FILES.map((f) => path.join(archon, f)),
    ...PRIVATE_FOLDERS.map((f) => path.join(archon, f)),
  ]);
}

// sandboxSettings({ domains, helper, platform }) -> the settings object. The sandbox is on and fails closed, no command
// may ask to leave it, writes are held to the working folder, the network to `domains` (the local network off, and the
// helper's socket the one path let through), and the paths above can't be read. the engine's worktree folders are not needed:
// the working-folder form holds the step to the folder the CLI starts in.
export function sandboxSettings({ domains = [], helper, platform = process.platform, homedir = os.homedir() } = {}) {
  if (typeof helper !== 'string' || helper === '') throw new Error('The sandbox settings need the helper\'s address, so the network can be held to it');
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowBypass: false,
      addCurrentWorkingDirectory: true,
      userPolicy: {
        filesystem: {
          readwritePaths: [helper],
          deniedPaths: deniedReads({ platform, homedir }),
        },
        network: {
          allowOutbound: false,
          allowLocalNetwork: false,
          allowedHosts: unique(domains.map((d) => cleanDomain(d)).filter((d) => d !== null)),
        },
      },
    },
  };
}

// The digest of the settings with the web list left out (plan choice 3), so a new project's domains don't undo the
// test. Keys are sorted so the digest doesn't depend on how the object was built.
export function settingsDigest(settings) {
  const copy = JSON.parse(JSON.stringify(settings ?? {}));
  if (copy.sandbox?.userPolicy?.network) delete copy.sandbox.userPolicy.network.allowedHosts;
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  return crypto.createHash('sha256').update(JSON.stringify(sorted(copy))).digest('hex');
}

// Whether the sandbox holds for steps now: the switch is on and the computer's result passed for this CLI version and
// these settings. A result for another version or other settings counts as no test.
export function sandboxLevel({ result, version, digest, checked = COPILOT_SANDBOX_CHECKED } = {}) {
  return checked === true && result?.passed === true && typeof version === 'string' && result.version === version && typeof digest === 'string' && result.digest === digest;
}

// How the sandbox stands, for the board: 'holds', 'stale' (a test exists but not for this version or these
// settings, or failed), or 'untested'.
export function sandboxState({ result, version, digest, checked = COPILOT_SANDBOX_CHECKED } = {}) {
  if (sandboxLevel({ result, version, digest, checked })) return 'holds';
  return result && typeof result === 'object' ? 'stale' : 'untested';
}
