// scripts/agents/copilot/locked.js
// Copilot's part of Locked (design section 6.4): the two computer-wide files the same password step puts in place, the
// rule that Locked is offered only once this Mac's sandbox test has passed, and which way a Copilot project is held. The
// core's Locked (scripts/protection/locked.js) takes this as its `agent` part and names no agent.
import fs from 'node:fs';
import path from 'node:path';
import { cleanDomain } from '../../protection/settings.js';
import { baselineSettings, companyManages, companyPlaces, OWN_MARK, policyRegistration, readCompanySettings, POLICY_FILE } from './company.js';
import { sandboxNow } from './sandbox-test.js';

const unique = (list) => [...new Set(list)];
const MAC_ONLY = 'Locked is offered on macOS only for now';
const NOT_OURS = 'A computer-wide settings file that is not Wheelhouse\'s is already in place, so Wheelhouse will not replace it';
export const ORGANISATION = 'This computer\'s Copilot is managed by the company, whose settings win, so Locked is not offered: the company\'s admin applies Wheelhouse\'s published baseline instead';
export const NEEDS_SANDBOX = 'Locked for Copilot forces its sandbox on for every Copilot chat on this computer, and the sandbox has not passed its test on this Mac, so Locked is not offered for Copilot';

// Locked on Copilot (design section 6.4): two files computer-wide, written by the same password step. The managed settings
// force the sandbox on for all Copilot work on the computer, since a policy hook that refused unsandboxed commands would
// let one through when it timed out; the policy hook file runs the managed copy of hook-entry.js, which does nothing
// outside a Locked project (`--policy`). `nodePath` is the managed copy's Node.js. Returns [{ path, content, mode }].
export function lockedCopilotFiles({ dir, nodePath, address, domains = [], places = companyPlaces('darwin') }) {
  const settings = baselineSettings({ platform: 'darwin' });
  settings.wheelhouse = { ...OWN_MARK };
  settings.sandbox.userPolicy.filesystem.readwritePaths = [address];
  settings.sandbox.userPolicy.network.allowedHosts = unique(['registry.npmjs.org', ...domains.map(cleanDomain).filter((d) => d !== null)]);
  const hooks = policyRegistration({ node: nodePath, root: path.join(dir, 'wheelhouse'), platform: 'darwin' });
  return [
    { path: places.managed, content: `${JSON.stringify(settings, null, 2)}\n`, mode: '644' },
    { path: path.join(places.policyDir, POLICY_FILE), content: `${JSON.stringify(hooks, null, 2)}\n`, mode: '644' },
  ];
}

// Whether Locked may be offered for Copilot on this Mac: only once the sandbox test has passed here, since Locked forces
// the sandbox on and a Mac whose sandbox doesn't work would stop all Copilot work. `result`, `version`, `digest` and
// `checked` are sandboxLevel's.
export function lockedCopilotReady(args = {}) {
  const now = sandboxNow({ ...(args.result === undefined ? {} : { result: args.result }), ...(args.version === undefined ? {} : { version: args.version }), ...(args.checked === undefined ? {} : { checked: args.checked }), settingsArgs: args.settingsArgs });
  return now.level ? { ready: true, why: null } : { ready: false, why: NEEDS_SANDBOX };
}

// Whether the two files in `places` are Wheelhouse's to replace: absent, or put there by Locked.
export function ownCopilotFiles(places = companyPlaces('darwin')) {
  const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
  const managed = read(places.managed);
  if (managed !== null) {
    try { if (JSON.parse(managed)?.wheelhouse?.owner !== OWN_MARK.owner) return false; } catch { return false; }
  }
  const hook = read(path.join(places.policyDir, POLICY_FILE));
  return hook === null || (/hook-entry\.js/.test(hook) && /--policy/.test(hook));
}

// Which way a Copilot project is held on this computer: `organisation` where the company manages Copilot (its settings
// win, and its admin applies Wheelhouse's published baseline), `locked` on a Mac whose sandbox has passed its test, and
// `none` otherwise, with `why` in plain words. `company` is readCompanySettings' arguments and `sandbox`
// lockedCopilotReady's, for tests.
export function copilotRoute({ platform = process.platform, company = {}, sandbox = {} } = {}) {
  if (platform === 'win32') return { route: 'none', why: MAC_ONLY };
  if (companyManages(readCompanySettings({ platform, ...company }))) return { route: 'organisation', why: ORGANISATION };
  const ready = lockedCopilotReady(sandbox);
  return ready.ready ? { route: 'locked', why: null } : { route: 'none', why: ready.why };
}

// The part Locked takes (`agent` in installLocked and leaveLocked): `{ route, prepare, removal }`. `options` are
// `{ places, company, sandbox }`, for tests. `prepare` refuses where the company manages Copilot, where the sandbox
// hasn't passed its test on this Mac, and where a file there isn't ours.
export function copilotLocked(options = {}) {
  const places = options.places ?? companyPlaces('darwin');
  return {
    route: (platform = process.platform) => copilotRoute({ platform, company: options.company, sandbox: options.sandbox }),
    prepare({ dir, nodePath, address, domains }) {
      const route = copilotRoute({ platform: 'darwin', company: options.company, sandbox: options.sandbox });
      if (route.route !== 'locked') return { refusal: route.why };
      if (!ownCopilotFiles(places)) return { refusal: NOT_OURS };
      return { files: lockedCopilotFiles({ dir, nodePath, address, domains, places }) };
    },
    removal: () => (ownCopilotFiles(places) ? [places.managed, path.join(places.policyDir, POLICY_FILE)] : []),
  };
}
