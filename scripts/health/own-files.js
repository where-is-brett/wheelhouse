// scripts/health/own-files.js
// A look at Wheelhouse's own files and Copilot's files that guard it (Task B3 of
// docs/superpowers/plans/2026-11-02-copilot-remaining-parts.md): Wheelhouse's install, Copilot's hook and agent folders and
// settings, the sign-in start, the VS Code add-on's folder, and the clean home's hook file and settings. A baseline of their
// hashes is kept under the Wheelhouse home, made afresh after setup and each update, and a weekly look names what changed.
// No sign-in is read: Copilot's config.json, in either home, is never opened.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { loginStartRecord } from '../lib/login-start.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Folders never walked into: a repository's history, and installed packages.
const SKIPPED = new Set(['.git', 'node_modules']);
// The add-on's folder in VS Code's extensions folder is named for the add-on.
const ADDON = /^wheelhouse[.-]/i;

// Kept in Wheelhouse's home; uninstall removes it with the other files the home holds.
export const ownFilesFile = () => path.join(wheelhouseHome(), 'own-files.json');

// Every file under `dir`, without following a link. A folder or file that isn't there is nothing.
function filesUnder(dir) {
  const out = [];
  const walk = (at) => {
    let entries;
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isSymbolicLink()) out.push(full);
      else if (entry.isDirectory()) { if (!SKIPPED.has(entry.name)) walk(full); } else out.push(full);
    }
  };
  walk(dir);
  return out;
}

// The file's hash, or 'link' for a link (its target is not followed), or null when it can't be read.
function hashOf(file, read) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return 'link';
    return crypto.createHash('sha256').update(read(file)).digest('hex');
  } catch {
    return null;
  }
}

// Copilot's sign-in is `config.json` in a home: never one of the files looked at.
const isSignIn = (file) => path.basename(file) === 'config.json';

// The folders and files looked at, as lists of files. `loginFile` is the sign-in start's file (the launch agent) where
// there is one.
function ownFiles({ home, root, engine, loginFile }) {
  const copilot = path.join(home, '.copilot');
  const clean = path.join(engine, 'copilot', 'home');
  const addons = path.join(home, '.vscode', 'extensions');
  let installed = [];
  try { installed = fs.readdirSync(addons).filter((n) => ADDON.test(n)); } catch { /* none */ }
  return [
    ...(typeof root === 'string' ? filesUnder(root) : []),
    ...filesUnder(path.join(copilot, 'hooks')),
    ...filesUnder(path.join(copilot, 'agents')),
    path.join(copilot, 'settings.json'),
    ...(typeof loginFile === 'string' ? [loginFile] : []),
    ...installed.flatMap((name) => filesUnder(path.join(addons, name))),
    ...filesUnder(path.join(clean, 'hooks')),
    path.join(clean, 'settings.json'),
  ].filter((file) => !isSignIn(file));
}

// Map<path, hash> over those files, the ones that are there. `read` stands in for reading a file, for a test.
export function ownFilesBaseline({ home = os.homedir(), root, engine, loginFile = defaultLoginFile(), read = fs.readFileSync } = {}) {
  const baseline = new Map();
  for (const file of ownFiles({ home, root, engine: engine ?? path.join(wheelhouseHome(), 'engine'), loginFile })) {
    const hash = hashOf(file, read);
    if (hash !== null) baseline.set(file, hash);
  }
  return baseline;
}

function defaultLoginFile() {
  const kept = loginStartRecord();
  return kept?.kind === 'launch-agent' ? kept.path : null;
}

// The paths that changed between two baselines: changed, added or removed, in order.
export function ownFilesChanged(baseline, now) {
  const before = baseline instanceof Map ? baseline : new Map();
  const after = now instanceof Map ? now : new Map();
  return [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file)).sort();
}

const versionOf = (root) => {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version); } catch { return null; }
};

// The kept state { version, at, checkedAt, files, changed }, or null when there is none or it can't be read.
export function readOwnFilesState() {
  try {
    const kept = JSON.parse(fs.readFileSync(ownFilesFile(), 'utf8'));
    return kept && typeof kept === 'object' && kept.files && typeof kept.files === 'object' ? kept : null;
  } catch {
    return null;
  }
}

function writeState(state) {
  const file = ownFilesFile();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(state)}\n`);
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true }); // the look still answers; it is made again next time
  }
}

// Makes the baseline afresh from the files as they are now, which is what the director accepts when they know the change.
export function acceptOwnFiles({ now = () => new Date(), ...where } = {}) {
  const at = now().toISOString();
  writeState({ version: versionOf(where.root), at, checkedAt: at, files: Object.fromEntries(ownFilesBaseline(where)), changed: [] });
}

// The weekly look: { changed }, the paths that differ from the baseline. With no baseline, or after an update of Wheelhouse
// (its version moved), it makes the baseline afresh and names nothing. The files are walked at most once a day; between,
// the day's answer stands. `where` is { home, root, engine, loginFile }.
export function checkOwnFiles({ now = () => new Date(), ...where } = {}) {
  const at = now();
  const state = readOwnFilesState();
  const version = versionOf(where.root);
  if (state === null || state.version !== version) {
    acceptOwnFiles({ now, ...where });
    return { changed: [] };
  }
  const checked = Date.parse(state.checkedAt);
  if (!Number.isNaN(checked) && checked <= at.getTime() && at.getTime() - checked < DAY_MS) {
    return { changed: Array.isArray(state.changed) ? state.changed : [] };
  }
  const changed = ownFilesChanged(new Map(Object.entries(state.files)), ownFilesBaseline(where));
  writeState({ ...state, checkedAt: at.toISOString(), changed });
  return { changed };
}

// The board's line for what changed, in plain words by kind and never by path, or null for none.
export function ownFilesLine(changed, { home = os.homedir(), root, engine } = {}) {
  if (!Array.isArray(changed) || changed.length === 0) return null;
  const inside = (file, dir) => typeof dir === 'string' && (file === dir || file.startsWith(dir + path.sep));
  const copilot = path.join(home, '.copilot');
  const clean = path.join(engine ?? path.join(wheelhouseHome(), 'engine'), 'copilot', 'home');
  const kinds = new Set();
  for (const file of changed) {
    if (inside(file, clean)) kinds.add('the build engine\'s own Copilot folder');
    else if (inside(file, path.join(home, '.vscode', 'extensions'))) kinds.add('the VS Code add-on');
    else if (inside(file, path.join(copilot, 'hooks'))) kinds.add('Copilot\'s guard files');
    else if (inside(file, path.join(copilot, 'agents'))) kinds.add('Copilot\'s helper files');
    else if (inside(file, copilot)) kinds.add('Copilot\'s settings');
    else if (path.basename(file).startsWith('dev.wheelhouse')) kinds.add('Wheelhouse\'s start at sign-in');
    else if (inside(file, root)) kinds.add('Wheelhouse\'s own files');
    else kinds.add('a file Wheelhouse keeps watch on');
  }
  return `Some of the files that guard your project have changed since the last update or setup: ${[...kinds].join(', ')}. If you didn't change them, look into it before you carry on`;
}
