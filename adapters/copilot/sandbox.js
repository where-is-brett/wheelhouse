// adapters/copilot/sandbox.js
// The settings that put Copilot's sandbox round the CLI's steps under the build engine, and the rule for when they
// may be written (design section 6.4, level 1; Archon design section 4.5). They live in the clean home
// (scripts/agents/copilot/engine-home.js), so one set covers every Copilot step on the computer (plan choice 1).
//
// Key names, read on 2 November 2026 from
// https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/cloud-and-local-sandboxes/configuring-local-sandbox-settings and
// https://docs.github.com/en/copilot/concepts/about-cloud-and-local-sandboxes:
//   sandbox.enabled               the sandbox on (settings.json in the CLI's config folder)
//   sandbox.failIfUnavailable     fail closed where the host can't sandbox (named for managed settings)
//   sandbox.allowBypass           whether Copilot may ask to run a command outside the sandbox
// The documentation says a sandbox's filesystem paths and its network rules (hosts, the local network) are set
// through `/sandbox`, and names no key for them. The `filesystem` and `network` members below are therefore
// Wheelhouse's best reading of the shape, UNTRIED: the sandbox test (scripts/agents/copilot/sandbox-test.js) is what
// shows whether they hold, and sandboxLevel() refuses until a run has passed on this computer for these settings.
// Where the CLI keeps a working-folder form, the documentation names none, so writes are held to the engine's
// worktree folders (`worktreeBases`), which lets one run write to another's worktree; the level's record says so.
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
export const WRITES_SCOPE = 'engine-worktree-folders';

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

// sandboxSettings({ worktreeBases, domains, helper, platform }) -> the settings object. The sandbox is on and fails
// closed, no command may ask to leave it, writes are held to `worktreeBases`, the network to `domains` and the
// helper's socket (`helper`, the local network otherwise off), and the paths above can't be read.
export function sandboxSettings({ worktreeBases = [], domains = [], helper, platform = process.platform, homedir = os.homedir() } = {}) {
  if (typeof helper !== 'string' || helper === '') throw new Error('The sandbox settings need the helper\'s address, so the network can be held to it');
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowBypass: false,
      filesystem: {
        write: unique(worktreeBases.filter((b) => typeof b === 'string' && path.isAbsolute(b))),
        denyRead: deniedReads({ platform, homedir }),
      },
      network: {
        allowedHosts: unique(domains.map((d) => cleanDomain(d)).filter((d) => d !== null)),
        allowLocalNetwork: false,
        allowUnixSockets: [helper],
      },
    },
  };
}

// The digest of the settings with the web list left out (plan choice 3), so a new project's domains don't undo the
// test. Keys are sorted so the digest doesn't depend on how the object was built.
export function settingsDigest(settings) {
  const copy = JSON.parse(JSON.stringify(settings ?? {}));
  if (copy.sandbox?.network) delete copy.sandbox.network.allowedHosts;
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
