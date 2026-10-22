// scripts/protection/locked.js
// Locked: the computer-wide managed settings file, its hook scripts and the
// list of Locked projects, put in place with one administrator prompt on macOS.
//
// Key names, read on 18 October 2026 from https://code.claude.com/docs/en/settings-reference:
//   permissions.disableBypassPermissionsMode   (any file)
//   sandbox.network.allowManagedDomainsOnly    (managed only; nested under network, not top level)
//   allowManagedHooksOnly                      (top level, managed only; deliberately not used)
//   sandbox.allowUnsandboxedCommands, sandbox.network.allowedDomains, sandbox.network.allowUnixSockets
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { managedDir, lockedProjects } from './managed.js';
import { sameFolder } from '../hooks/kit.js';
import { credentialRules, cleanDomain } from './settings.js';
import { readProject } from '../lib/projects.js';
import { helperAddress, projectsDir, wheelhouseHome } from '../lib/paths.js';
import { readConfig } from '../gate/guardrails.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The plugin's folders Locked puts in the managed copy (under <dir>/wheelhouse/), beside Node.js (bin).
// A hook script in the copy loads only what these folders hold, so every folder a hook imports from is here.
export const LOCKED_FOLDERS = Object.freeze(['scripts', 'lineage', 'adapters']);
const unique = (list) => [...new Set(list)];

export const MAC_ONLY = 'Locked is offered on macOS only for now';
export const NEEDS_NARROW = 'Locked needs the narrow connection';
// The macOS configuration-profile policy file for the com.anthropic.claudecode
// preferences domain (the page names the domain; this is where macOS keeps it).
export const MDM_PLIST = '/Library/Managed Preferences/com.anthropic.claudecode.plist';
export const HAS_MDM = 'Locked can\'t be installed while this computer has another managed policy for Claude Code';
export const NOT_OURS = 'A computer-wide settings file that is not Wheelhouse\'s is already in place, so Wheelhouse will not replace it';

// Single-quoted for the shell.
const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;

function pluginHooks(hooksJson) {
  return hooksJson ?? JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
}

// The hook list of hooks/hooks.json with only each command rewritten. Exec form
// (command plus args, no shell), as the hooks page describes, so a path with a
// space needs no quoting: Node.js is the copy kept beside the scripts.
function managedHooks({ dir, nodePath, hooksJson }) {
  const hooks = {};
  for (const [event, groups] of Object.entries(pluginHooks(hooksJson).hooks)) {
    hooks[event] = groups.map((group) => ({
      ...group,
      hooks: group.hooks.map((hook) => {
        const name = /scripts\/hooks\/([\w-]+)\.js/.exec(hook.command ?? '')?.[1];
        if (!name) throw new Error('A hook command does not name a script under scripts/hooks');
        const { command: _plugin, ...kept } = hook;
        return { ...kept, command: nodePath, args: [`${dir}/wheelhouse/scripts/hooks/${name}.js`] };
      }),
    }));
  }
  return hooks;
}

export function managedSettings({ dir, nodePath, address, domains, hooksJson }) {
  return {
    hooks: managedHooks({ dir, nodePath, hooksJson }),
    permissions: {
      deny: unique(['Read(**/.env)', 'Read(**/.env.*)', 'Read(~/.wheelhouse/**)', 'Edit(~/.wheelhouse/**)', ...credentialRules()]),
      disableBypassPermissionsMode: 'disable',
    },
    sandbox: {
      allowUnsandboxedCommands: false,
      network: {
        allowManagedDomainsOnly: true,
        allowedDomains: unique(['registry.npmjs.org', ...domains.map(cleanDomain).filter((d) => d !== null)]),
        allowUnixSockets: [address],
      },
    },
  };
}

// The web domains in a project's configuration on disk; none when it cannot be read.
function domainsOf(folder) {
  try {
    return readConfig(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8')).webDomains;
  } catch {
    return [];
  }
}

// The web domains of every project registered on this computer.
function registeredDomains() {
  let names = [];
  try {
    names = fs.readdirSync(projectsDir()).sort();
  } catch {
    // None registered.
  }
  return names.flatMap((name) => {
    const record = readProject(name);
    return record ? domainsOf(record.folder) : [];
  });
}

const filePath = (dir) => path.join(dir, 'managed-settings.json');
const installedPath = (dir) => path.join(dir, 'wheelhouse', 'installed.json');
const inPlace = (dir) => fs.existsSync(filePath(dir)) && fs.existsSync(installedPath(dir));
// Whether the computer-wide settings file in `dir` is Wheelhouse's to replace: absent, or put there
// by Locked, with its record beside it.
export const ownFile = (dir) => !fs.existsSync(filePath(dir)) || fs.existsSync(installedPath(dir));

async function administrator(run, shell) {
  return run('osascript', ['-e', 'on run argv', '-e', 'do shell script (item 1 of argv) with administrator privileges', '-e', 'end run', '--', shell]);
}

// What an administrator step that did not finish says, truthfully.
function failureLine({ code, stderr }) {
  if (/User canceled|\(-128\)/i.test(String(stderr ?? ''))) return 'The password prompt was cancelled, so nothing was changed';
  return `Locked may be partly changed (exit code ${code}): run the update again`;
}

// The command the administrator prompt runs, as one chain. The new scripts, the lineage folder
// (the manifest the session start checks the installed skills against, and the register), the
// adapters' folder (the hook kit and guards import from it) and Node.js go in beside the live ones
// and are checked there; only then are they swapped in (mv), so a failed copy never leaves them
// missing. The adapters go in first: the new scripts import from that folder and the old scripts
// never do, so a hook firing between two swaps never meets new scripts without their adapters. A
// failure removes what was copied and exits. The settings file goes in last, and everything is
// root's and not writable by anyone else.
function adminShell({ dir, stage, nodeSource }) {
  const own = path.join(dir, 'wheelhouse');
  // The swap order: adapters, then the other folders, then bin (which the destructuring below takes last).
  const names = ['adapters', ...LOCKED_FOLDERS.filter((n) => n !== 'adapters'), 'bin'];
  const [fresh, aside, live] = ['.new', '.old', ''].map((suffix) => names.map((n) => q(path.join(own, `${n}${suffix}`))));
  const [binNew, binOld, bin] = [fresh.at(-1), aside.at(-1), live.at(-1)];
  const settingsNew = q(`${filePath(dir)}.new`);
  const chain = [
    `mkdir -p ${q(own)}`,
    `rm -rf ${[...fresh, ...aside].join(' ')} ${settingsNew}`,
    ...names.slice(0, -1).map((n, i) => `cp -R ${q(path.join(stage, 'wheelhouse', n))} ${fresh[i]}`),
    `mkdir ${binNew}`,
    `cp ${q(nodeSource)} ${q(path.join(own, 'bin.new', 'node'))}`,
    `chmod 755 ${q(path.join(own, 'bin.new', 'node'))}`,
    `${q(path.join(own, 'bin.new', 'node'))} --version`,
    `cp ${q(path.join(stage, 'wheelhouse', 'locked-projects.json'))} ${q(path.join(stage, 'wheelhouse', 'installed.json'))} ${q(own)}/`,
    ...names.flatMap((n, i) => [`{ [ ! -e ${live[i]} ] || mv ${live[i]} ${aside[i]}; }`, `mv ${fresh[i]} ${live[i]}`]),
    `rm -rf ${aside.join(' ')}`,
    `cp ${q(path.join(stage, 'managed-settings.json'))} ${settingsNew}`,
    `mv ${settingsNew} ${q(filePath(dir))}`,
    `chown -R root:wheel ${q(own)} ${q(filePath(dir))}`,
    `chmod -R go-w ${q(own)} ${q(filePath(dir))}`,
  ].join(' && ');
  // Anything moved aside is put back first: the live folders must never be missing, or
  // the old settings file would name scripts that are not there.
  const restore = names.map((n, i) => `[ -d ${aside[i]} ] && [ ! -d ${live[i]} ] && mv ${aside[i]} ${live[i]};`).join(' ');
  return `${chain} || { ${restore} rm -rf ${fresh.join(' ')} ${settingsNew}; exit 1; }`;
}

// Stages everything for `list`, asks once, and removes the staging folder.
async function put({ list, dir, run, now, nodeSource, address, line }) {
  const home = wheelhouseHome();
  fs.mkdirSync(home, { recursive: true });
  // Under the Wheelhouse home, which the sandbox keeps agents out of; the temporary folder is theirs.
  const stage = fs.mkdtempSync(path.join(home, 'locked-stage-'));
  try {
    const own = path.join(stage, 'wheelhouse');
    fs.mkdirSync(own, { recursive: true });
    for (const folder of LOCKED_FOLDERS) fs.cpSync(path.join(PLUGIN_ROOT, folder), path.join(own, folder), { recursive: true });
    fs.writeFileSync(path.join(own, 'locked-projects.json'), `${JSON.stringify(list, null, 2)}\n`);
    const { version } = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    fs.writeFileSync(path.join(own, 'installed.json'), `${JSON.stringify({ version, at: now().toISOString(), pluginRoot: fs.realpathSync(PLUGIN_ROOT) }, null, 2)}\n`);
    const settings = managedSettings({ dir, nodePath: path.join(dir, 'wheelhouse', 'bin', 'node'), address, domains: registeredDomains() });
    fs.writeFileSync(path.join(stage, 'managed-settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    const result = await administrator(run, adminShell({ dir, stage, nodeSource }));
    if (result.code !== 0) return { installed: inPlace(dir), line: failureLine(result) };
    if (!inPlace(dir)) return { installed: false, line: 'The administrator step finished, but the files are not in place' };
    return { installed: true, line };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

const REGISTERED_LATER = 'A project registered later needs Locked updated.';

function setUp({ project, platform = process.platform, dir, nodePath = process.execPath, address = helperAddress(), mdmPlist = MDM_PLIST }) {
  if (platform === 'win32') return { refusal: { installed: false, line: MAC_ONLY } };
  const record = readProject(project);
  if (!record) return { refusal: { installed: false, line: 'The project is not set up' } };
  if (record.connection?.mode === 'quick') return { refusal: { installed: false, line: NEEDS_NARROW } };
  if (fs.existsSync(mdmPlist)) return { refusal: { installed: false, line: HAS_MDM } };
  return { record, dir: dir ?? managedDir(platform), nodeSource: nodePath, address };
}

// Adds the project once, however its folder is spelled.
const withProject = (list, folder) => (list.some((f) => sameFolder(f, folder)) ? list : [...list, folder]);

async function install(args, line) {
  const s = setUp(args);
  if (s.refusal) return s.refusal;
  if (!ownFile(s.dir)) return { installed: false, line: NOT_OURS };
  const list = withProject(lockedProjects({ dir: s.dir }), s.record.folder);
  return put({ list, dir: s.dir, run: args.run, now: args.now ?? (() => new Date()), nodeSource: s.nodeSource, address: s.address, line });
}

export function installLocked(args) {
  return install(args, `Locked is on for this project. ${REGISTERED_LATER}`);
}

export function updateLocked(args) {
  return install(args, `Locked is up to date. ${REGISTERED_LATER}`);
}

export async function leaveLocked({ project, platform = process.platform, run, now = () => new Date(), dir, nodePath = process.execPath, address = helperAddress() }) {
  if (platform === 'win32') return { installed: false, line: MAC_ONLY };
  const record = readProject(project);
  if (!record) return { installed: false, line: 'The project is not set up' };
  const where = dir ?? managedDir(platform);
  if (!ownFile(where)) return { installed: false, line: NOT_OURS };
  const all = lockedProjects({ dir: where });
  const rest = all.filter((folder) => !sameFolder(folder, record.folder));
  if (rest.length === all.length) return { installed: inPlace(where), line: 'This project is not in the Locked list, so nothing was changed' };
  if (rest.length > 0) {
    return put({ list: rest, dir: where, run, now, nodeSource: nodePath, address, line: 'This project has left Locked' });
  }
  const shell = `rm -f ${q(filePath(where))} && rm -rf ${q(path.join(where, 'wheelhouse'))}`;
  const result = await administrator(run, shell);
  if (result.code !== 0) return { installed: inPlace(where), line: failureLine(result) };
  if (fs.existsSync(filePath(where))) return { installed: true, line: 'The administrator step finished, but the file is still there' };
  return { installed: false, line: 'Locked is off' };
}
