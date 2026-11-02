// scripts/agents/copilot/company.js
// The settings a company applies to Copilot, and Wheelhouse's published baseline for them (design sections 6.4 and 8.7).
// The baseline is a pair of files in docs/copilot/baseline/ that a company's admin applies through device management or
// GitHub: managed-settings.json (the rules) and policy-hooks.json (the hook file that runs the guards). Both are
// generated here, and a test holds the published copies to the generator.
//
// Key names, read on 2 November 2026 from
// https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings:
//   permissions.deny, permissions.disableBypassPermissionsMode, forceRemoteSettingsRefresh,
//   sandbox.enabled, sandbox.failIfUnavailable, sandbox.allowBypass, sandbox.addCurrentWorkingDirectory,
//   sandbox.userPolicy.filesystem.deniedPaths, sandbox.userPolicy.network.allowLocalNetwork
// The page names no file location and no policy-hook folder; the locations below are the other-agents design's
// (section 3.2), untried until the S5 sitting. `wheelhouse.realUsers` is Wheelhouse's own member, which marks every
// repository the company owns as a project with real users; whether Copilot accepts an unknown member is likewise
// untried, and a company that finds it refused can drop it and tell Wheelhouse in setup.
import fs from 'node:fs';
import path from 'node:path';
import { registration } from '../../../adapters/copilot/hooks.js';
import { credentialPaths } from '../../lib/credentials.js';

// The member Wheelhouse's own managed file carries, so it is never read as a company's.
export const OWN_MARK = Object.freeze({ owner: 'wheelhouse-locked' });
// The file name Wheelhouse's policy hook has.
export const POLICY_FILE = 'wheelhouse.json';

// Where each system keeps the managed settings file and the policy-hook folder.
export function companyPlaces(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return {
      managed: path.win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'GitHubCopilot', 'managed-settings.json'),
      policyDir: 'C:\\ProgramData\\GitHub\\Copilot\\policy.d',
    };
  }
  return { managed: '/Library/Application Support/GitHubCopilot/managed-settings.json', policyDir: '/etc/github-copilot/policy.d' };
}

// The baseline's rules (section 6.4): the sandbox forced on and failing closed, no command outside it, no "Allow all",
// the keys, the credential folders and Copilot's own folders denied for reads and edits, settings fetched afresh from
// GitHub, and every company repository marked as having real users.
export function baselineSettings({ platform = 'darwin' } = {}) {
  const denied = ['.wheelhouse/keys', '.copilot', '.agents', ...credentialPaths(platform)].map((p) => `~/${p}`);
  return {
    permissions: {
      disableBypassPermissionsMode: 'disable',
      deny: [...new Set(denied.flatMap((p) => [`Read(${p})`, `Read(${p}/**)`]).concat(['.copilot', '.agents', '.wheelhouse'].map((p) => `Edit(~/${p}/**)`)))],
    },
    forceRemoteSettingsRefresh: true,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowBypass: false,
      addCurrentWorkingDirectory: true,
      userPolicy: {
        filesystem: { deniedPaths: denied },
        network: { allowLocalNetwork: false },
      },
    },
    wheelhouse: { realUsers: 'all' },
  };
}

// The registration with ` --policy` after each event, for the policy hook Locked installs: the entry then does nothing
// outside a Locked project (scripts/agents/copilot/hook-entry.js), since the person's own registration runs the guards
// everywhere else and a project that isn't Locked must not run them twice.
export function policyRegistration({ node, root, platform = 'darwin' }) {
  const marked = registration({ node, root, platform });
  for (const entries of Object.values(marked.hooks)) {
    for (const entry of entries) {
      for (const field of ['command', 'bash', 'powershell']) if (typeof entry[field] === 'string') entry[field] = `${entry[field]} --policy`;
    }
  }
  return marked;
}

// The policy hook file running the guards: the same registration setup writes, with the two paths the admin fills in.
export function baselineHooks({ platform = 'darwin' } = {}) {
  return registration({ node: platform === 'win32' ? 'C:\\path\\to\\node.exe' : '/path/to/node', root: platform === 'win32' ? 'C:\\path\\to\\wheelhouse' : '/path/to/wheelhouse', platform });
}

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isOwn = (settings) => isPlain(settings) && settings.wheelhouse?.owner === OWN_MARK.owner;

// readCompanySettings({ platform, read, list, env }) -> { managed, policyHooks }. `managed` is the company's managed
// settings object, or null when none is there, it can't be read, or it is Wheelhouse's own (written by Locked).
// `policyHooks` is the names of the policy-hook files other than Wheelhouse's. `read(path)` gives a file's text or
// null, and `list(dir)` a folder's file names; both default to the file system.
export function readCompanySettings({
  platform = process.platform, env = process.env,
  read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } },
  list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } },
} = {}) {
  const places = companyPlaces(platform, env);
  let managed = null;
  const text = read(places.managed);
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text);
      // A file that is there but is not an object is still a company's file: it is kept as an empty one.
      if (!isOwn(parsed)) managed = isPlain(parsed) ? parsed : {};
    } catch {
      managed = {};
    }
  }
  const policyHooks = list(places.policyDir).filter((name) => typeof name === 'string' && name !== POLICY_FILE && !name.startsWith('.'));
  return { managed, policyHooks };
}

// Whether the company applies settings of its own here: a managed file or a policy hook that isn't Wheelhouse's.
export const companyManages = (found) => found.managed !== null || found.policyHooks.length > 0;
