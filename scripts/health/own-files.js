// scripts/health/own-files.js
// A look at Wheelhouse's own files and Copilot's files that guard it (Task B3 of
// docs/superpowers/plans/2026-11-02-copilot-remaining-parts.md): Wheelhouse's install, Copilot's hook and agent folders and
// settings, the sign-in start, the VS Code add-on's folder, and the clean home's hook file and settings. A baseline of their
// hashes is kept under the Wheelhouse home, made afresh after setup and each update, and a weekly look names what changed.
// No sign-in is read: Copilot's config.json, in either home, is never opened.
//
// The look follows the Wheelhouse folders Claude Code has installed and in use (installed_plugins.json), one entry each, and
// skips Claude Code's own bookkeeping at a plugin folder's top (`.in_use`, `.orphaned_at`) by those names. A folder whose
// version moved, or that is new, is accepted only when its files match the release tag's tree (design
// 2026-11-04-update-command-design.md, section 8).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wheelhouseHome } from '../lib/paths.js';
import { loginStartRecord } from '../lib/login-start.js';
import { MARKETPLACE, claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { fetchTag, tagTree } from '../update/release.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Folders never walked into: a repository's history, and installed packages.
const SKIPPED = new Set(['.git', 'node_modules']);
// The add-on's folder in VS Code's extensions folder is named for the add-on.
const ADDON = /^wheelhouse[.-]/i;
// Claude Code's own bookkeeping at the top of a plugin folder, skipped by exactly these names. Anything a later Claude Code
// adds goes here by name, never by pattern.
const BOOKKEEPING = new Set(['.in_use', '.orphaned_at']);
const PLUGIN_ID = `wheelhouse@${MARKETPLACE}`;
const KEPT_UPDATES = 10;

// Kept in Wheelhouse's home; uninstall removes it with the other files the home holds.
export const ownFilesFile = () => path.join(wheelhouseHome(), 'own-files.json');

// Every file under `dir`, without following a link. A folder or file that isn't there is nothing.
function filesUnder(dir, { plugin = false } = {}) {
  const out = [];
  const walk = (at) => {
    let entries;
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (plugin && at === dir && BOOKKEEPING.has(entry.name)) continue;
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

// The files looked at outside the plugin folders, as a list of files. `loginFile` is the sign-in start's file (the launch
// agent) where there is one.
function otherFiles({ home, engine, loginFile }) {
  const copilot = path.join(home, '.copilot');
  const clean = path.join(engine, 'copilot', 'home');
  const addons = path.join(home, '.vscode', 'extensions');
  let installed = [];
  try { installed = fs.readdirSync(addons).filter((n) => ADDON.test(n)); } catch { /* none */ }
  return [
    ...filesUnder(path.join(copilot, 'hooks')),
    ...filesUnder(path.join(copilot, 'agents')),
    path.join(copilot, 'settings.json'),
    ...(typeof loginFile === 'string' ? [loginFile] : []),
    ...installed.flatMap((name) => filesUnder(path.join(addons, name))),
    ...filesUnder(path.join(clean, 'hooks')),
    path.join(clean, 'settings.json'),
  ].filter((file) => !isSignIn(file));
}

const hashes = (files, read) => {
  const map = new Map();
  for (const file of files) {
    const hash = hashOf(file, read);
    if (hash !== null) map.set(file, hash);
  }
  return map;
};

// Map<path, hash> over one Wheelhouse plugin folder's files, without Claude Code's bookkeeping.
export function pluginFolderBaseline(folder, { read = fs.readFileSync } = {}) {
  return hashes(filesUnder(folder, { plugin: true }), read);
}

// Map<path, hash> over the files outside the plugin folders (Copilot's, the add-on's, the sign-in start, the clean home).
function othersBaseline({ home = os.homedir(), engine, loginFile = defaultLoginFile(), read = fs.readFileSync } = {}) {
  return hashes(otherFiles({ home, engine: engine ?? path.join(wheelhouseHome(), 'engine'), loginFile }), read);
}

// Map<path, hash> over every file looked at: the plugin folder `root` (when one is given) and the others. `read` stands in for
// reading a file, for a test.
export function ownFilesBaseline({ home = os.homedir(), root, engine, loginFile = defaultLoginFile(), read = fs.readFileSync } = {}) {
  const baseline = typeof root === 'string' ? pluginFolderBaseline(root, { read }) : new Map();
  for (const [file, hash] of othersBaseline({ home, engine, loginFile, read })) baseline.set(file, hash);
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

// A file's hash as the update records it for the files it wrote: the same as the look's own (null when it can't be read).
export const fileHash = (file, read = fs.readFileSync) => hashOf(file, read);

const versionOf = (root) => {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version); } catch { return null; }
};

const bareVersion = (v) => String(v ?? '').replace(/^v/, '');

// The Wheelhouse plugin folders Claude Code has installed and in use, from installed_plugins.json: one entry per folder,
// { folder, version, projects }. An install at the account's scope counts for the account; an install for a project counts
// only when that project's folder is in `projects`. A folder that isn't there is left out.
export function pluginFoldersInUse({ claudeHome = defaultClaudeHome(), projects = [] } = {}) {
  let installs;
  try { installs = JSON.parse(fs.readFileSync(path.join(claudeHome, 'plugins', 'installed_plugins.json'), 'utf8'))?.plugins?.[PLUGIN_ID]; } catch { return []; }
  const registered = new Set((Array.isArray(projects) ? projects : []).filter((p) => typeof p === 'string').map((p) => path.resolve(p)));
  const found = new Map();
  for (const install of Array.isArray(installs) ? installs : []) {
    if (!install || typeof install.installPath !== 'string' || !fs.existsSync(install.installPath)) continue;
    const entry = found.get(install.installPath) ?? {
      folder: install.installPath,
      version: typeof install.version === 'string' ? install.version : versionOf(install.installPath),
      projects: [],
    };
    if (typeof install.projectPath === 'string') {
      const project = path.resolve(install.projectPath);
      if (!registered.has(project)) continue;
      entry.projects.push(project);
    }
    found.set(install.installPath, entry);
  }
  return [...found.values()].sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
}

// The kept state, or null when there is none or it can't be read. It is { folders, others, updates, checkedAt, changed, calm };
// the older flat shape ({ files }) is returned as it is, for checkOwnFiles to replace.
export function readOwnFilesState() {
  try {
    const kept = JSON.parse(fs.readFileSync(ownFilesFile(), 'utf8'));
    const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
    return object(kept) && (object(kept.folders) || object(kept.files)) ? kept : null;
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

const updatesOf = (state) => (Array.isArray(state?.updates) ? state.updates : []);

// The folders in use, or the plugin folder the caller names when none is listed.
function foldersToLook({ claudeHome, projects, root }) {
  const listed = pluginFoldersInUse({ claudeHome, projects });
  if (listed.length > 0 || typeof root !== 'string') return listed;
  return [{ folder: root, version: versionOf(root), projects: [] }];
}

function freshState({ folders, others, updates, at, read }) {
  return {
    schema: 2,
    at,
    checkedAt: at,
    folders: Object.fromEntries(folders.map((f) => [f.folder, { version: f.version, at, files: Object.fromEntries(pluginFolderBaseline(f.folder, { read })) }])),
    others: { files: Object.fromEntries(others) },
    updates,
    changed: [],
  };
}

// Makes the baseline afresh from the files as they are now, which is what the director accepts when they know the change.
// The update's records are kept.
export function acceptOwnFiles({ now = () => new Date(), claudeHome, projects, root, ...where } = {}) {
  const at = now().toISOString();
  writeState(freshState({
    folders: foldersToLook({ claudeHome, projects, root }),
    others: othersBaseline(where),
    updates: updatesOf(readOwnFilesState()),
    at,
    read: where.read,
  }));
}

// Records an update for the look: { from, to, at, answer, wrote: [{ file, hash }] }, the files the update itself wrote with
// their hashes (see fileHash). Written by the second half of the update. The look then accepts a move to `to` that matches its
// tag's tree with a calm line, and accepts those files only at those hashes.
export function recordUpdate({ from, to, at, answer, wrote } = {}) {
  const state = readOwnFilesState() ?? { schema: 2, folders: {}, others: { files: {} }, updates: [], changed: [] };
  const record = {
    from: bareVersion(from),
    to: bareVersion(to),
    at: typeof at === 'string' ? at : new Date(at ?? Date.now()).toISOString(),
    answer: typeof answer === 'string' ? answer : null,
    wrote: (Array.isArray(wrote) ? wrote : []).filter((w) => typeof w?.file === 'string' && typeof w?.hash === 'string').map(({ file, hash }) => ({ file, hash })),
  };
  writeState({ ...state, schema: 2, updates: [...updatesOf(state), record].slice(-KEPT_UPDATES) });
}

// A git blob hash of a file's bytes (what `git hash-object` gives), or 'link' for a link: a link never matches a tree.
function blobHash(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return 'link';
    const bytes = fs.readFileSync(file);
    return crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  } catch {
    return null;
  }
}

const GIT_SKIPPED = (rel) => rel.split('/').some((part) => SKIPPED.has(part));

// Whether a plugin folder's files are exactly the tag's tree: { ok: true } or { ok: false, bad: [path] } naming the files that
// differ, are not in the tree, or are missing.
function matchesTree(folder, tree) {
  const bad = [];
  const seen = new Set();
  for (const file of filesUnder(folder, { plugin: true })) {
    const rel = path.relative(folder, file).split(path.sep).join('/');
    seen.add(rel);
    if (tree.get(rel) !== blobHash(file)) bad.push(file);
  }
  for (const rel of tree.keys()) if (!seen.has(rel) && !GIT_SKIPPED(rel)) bad.push(path.join(folder, ...rel.split('/')));
  return bad.length === 0 ? { ok: true } : { ok: false, bad: bad.sort() };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dayMonthYear(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The tag's tree out of the mirror, fetching the tag first. Null when it can't be had (offline, no such tag); the look then
// accepts nothing and tries again at the next look.
function defaultTreeFor({ run, mirror, url }) {
  return async (tag) => {
    try {
      const fetched = await fetchTag({ ref: tag, run, mirror, ...(url ? { url } : {}) });
      return fetched.ok ? await tagTree({ tag, run, mirror }) : null;
    } catch {
      return null;
    }
  };
}

// The weekly look: { changed, calm, folders, other }.
// - `changed` is the paths that differ from the baseline (every folder in use, and the others).
// - `calm` is a plain line (or lines, one to a row) for a version move that was explained, or undefined.
// - `folders` is [{ folder, version, projects, changed }] and `other` the changed paths outside the plugin folders, for
//   changedForProject.
// With no baseline (or the older flat one) it makes the baseline afresh and names nothing. A folder in use whose version
// moved, or that is new, is accepted only when its files match the tag's tree, which `treeFor(tag)` gives as a Map of
// path -> blob hash (null when it can't be had). The files are walked at most once a day while the folders in use stay the
// same; between, the day's answer stands. `where` is { home, root, engine, loginFile }.
export async function checkOwnFiles({ now = () => new Date(), claudeHome, projects, treeFor, run, mirror = defaultMirror(), url, ...where } = {}) {
  const at = now();
  const state = readOwnFilesState();
  const folders = foldersToLook({ claudeHome, projects, root: where.root });
  const summary = (changedBy, other) => ({
    folders: folders.map((f) => ({ ...f, changed: changedBy.get(f.folder) ?? [] })),
    other,
  });
  if (state === null || typeof state.folders !== 'object' || state.folders === null) {
    acceptOwnFiles({ now, claudeHome, projects, ...where });
    return { changed: [], ...summary(new Map(), []) };
  }
  const sameFolders = folders.length === Object.keys(state.folders).length
    && folders.every((f) => state.folders[f.folder]?.version === f.version);
  const checked = Date.parse(state.checkedAt);
  if (sameFolders && !Number.isNaN(checked) && checked <= at.getTime() && at.getTime() - checked < DAY_MS) {
    const changed = Array.isArray(state.changed) ? state.changed : [];
    const result = { changed, ...summary(new Map(folders.map((f) => [f.folder, changed.filter((c) => c.startsWith(f.folder + path.sep))])), changed.filter((c) => !folders.some((f) => c.startsWith(f.folder + path.sep)))) };
    if (typeof state.calm === 'string') result.calm = state.calm;
    return result;
  }

  const lookup = treeFor ?? defaultTreeFor({ run, mirror, url });
  const trees = new Map();
  const treeOf = async (version) => {
    if (!trees.has(version)) {
      let tree = null;
      try { tree = await lookup(`v${version}`); } catch { /* as if it can't be had */ }
      trees.set(version, tree instanceof Map ? tree : null);
    }
    return trees.get(version);
  };

  const changedBy = new Map();
  const nextFolders = {};
  const calm = [];
  const knownVersions = new Set(Object.values(state.folders).map((k) => k?.version));
  const updates = updatesOf(state);
  for (const f of folders) {
    const kept = state.folders[f.folder];
    const files = pluginFolderBaseline(f.folder, { read: where.read });
    if (kept && kept.version === f.version && kept.files && typeof kept.files === 'object') {
      changedBy.set(f.folder, ownFilesChanged(new Map(Object.entries(kept.files)), files));
      nextFolders[f.folder] = kept;
      continue;
    }
    // A version move, or a folder not seen before: accepted only against the tag's tree.
    const tree = f.version === null ? null : await treeOf(f.version);
    if (tree === null) continue; // can't be checked now: nothing accepted, nothing named, looked at again
    const verdict = matchesTree(f.folder, tree);
    if (!verdict.ok) { changedBy.set(f.folder, verdict.bad); continue; }
    nextFolders[f.folder] = { version: f.version, at: at.toISOString(), files: Object.fromEntries(files) };
    if (!knownVersions.has(f.version)) {
      const record = updates.find((u) => bareVersion(u.to) === f.version);
      const day = record ? dayMonthYear(record.at) : null;
      calm.push(record
        ? `Wheelhouse was updated to v${f.version}${day ? ` on ${day}` : ''}, approved by you`
        : `Wheelhouse moved to v${f.version} outside the update command`);
      knownVersions.add(f.version);
    }
  }

  // Files outside the plugin folders: any change is named, except the files an update wrote, at the hashes it recorded.
  const before = new Map(Object.entries(state.others?.files ?? {}));
  const after = othersBaseline(where);
  const wrote = new Map(updates.flatMap((u) => (Array.isArray(u.wrote) ? u.wrote : [])).map((w) => [w.file, w.hash]));
  const nextOthers = new Map(before);
  const other = [];
  for (const file of ownFilesChanged(before, after)) {
    if (wrote.has(file) && after.get(file) === wrote.get(file)) nextOthers.set(file, after.get(file));
    else other.push(file);
  }

  const changed = [...[...changedBy.values()].flat(), ...other].sort();
  writeState({
    schema: 2,
    at: state.at ?? at.toISOString(),
    checkedAt: at.toISOString(),
    folders: nextFolders,
    others: { files: Object.fromEntries(nextOthers) },
    updates,
    changed,
    ...(calm.length > 0 ? { calm: calm.join('\n') } : {}),
  });
  return { changed, ...(calm.length > 0 ? { calm: calm.join('\n') } : {}), ...summary(changedBy, other) };
}

const defaultMirror = () => path.join(wheelhouseHome(), 'update', 'mirror');

// What a project's board line names: the paths outside the plugin folders, and the folder that project uses (its own
// project-scope install, or else the account's). `result` is what checkOwnFiles gave.
export function changedForProject(result, projectFolder) {
  const folders = Array.isArray(result?.folders) ? result.folders : [];
  const project = typeof projectFolder === 'string' ? path.resolve(projectFolder) : null;
  const own = folders.filter((f) => project !== null && f.projects.includes(project));
  const used = own.length > 0 ? own : folders.filter((f) => f.projects.length === 0);
  return [...used.flatMap((f) => f.changed), ...(Array.isArray(result?.other) ? result.other : [])].sort();
}

// The board's line for what changed, in plain words by kind and never by path, or null for none. `folders` are the plugin
// folders in use (with `root`, the helper's own).
export function ownFilesLine(changed, { home = os.homedir(), root, folders = [], engine } = {}) {
  if (!Array.isArray(changed) || changed.length === 0) return null;
  const inside = (file, dir) => typeof dir === 'string' && (file === dir || file.startsWith(dir + path.sep));
  const plugins = [root, ...folders.map((f) => (typeof f === 'string' ? f : f?.folder))];
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
    else if (plugins.some((dir) => inside(file, dir))) kinds.add('Wheelhouse\'s own files');
    else kinds.add('a file Wheelhouse keeps watch on');
  }
  return `Some of the files that guard your project have changed since the last update or setup: ${[...kinds].join(', ')}. If you didn't change them, look into it before you carry on`;
}
