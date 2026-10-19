// scripts/lineage/check.js
// Whether the upstream skills installed for a Wheelhouse project are the ones Wheelhouse's
// manifest names. A mismatch writes the project's hold file, and while it is there the
// hold hook (scripts/hooks/lineage-hold.js) refuses edits and commands; a match removes
// it. The session start runs this check and records the session's provenance; an agent
// runs it again once the files are put right, the one command the hold lets through.
// Reads files only: never git.
//   node scripts/lineage/check.js [projectDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { MANIFEST_PATH, UPSTREAMS, checkInstalled, claudeHome as defaultClaudeHome, locateInstalled, readManifest } from './manifest.js';

// This copy's root, holding lineage/ beside scripts/: the plugin's folder, or Locked's managed copy.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER_PATH = 'lineage/register.json';
// The most paths a warning names for one upstream before "and N more".
const NAMED_PATHS = 5;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

// The project's folder under the Wheelhouse home (stateDir checks the name).
const projectHome = (project) => path.dirname(stateDir(project));

// While this file exists, the project's edits and commands are held: { at, mismatches }.
export function holdFile(project) {
  return path.join(projectHome(project), 'lineage', 'hold.json');
}

// Whether the project is held. Anything at the hold file's place counts.
export function isHeld(project) {
  try {
    fs.lstatSync(holdFile(project));
    return true;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
}

// What the session start records of a session: projects/<p>/sessions/<session_id>/provenance.json.
// Null for a session id that is not a plain name.
export function provenanceFile(project, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null;
  return path.join(projectHome(project), 'sessions', sessionId, 'provenance.json');
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const text = (value) => (typeof value === 'string' && value !== '' ? value : null);

// This copy's Wheelhouse version: the plugin's own record, or what Locked recorded of the
// version it copied. Null when neither can be read.
export function wheelhouseVersion(root = ROOT) {
  return text(readJson(path.join(root, '.claude-plugin', 'plugin.json'))?.version) ?? text(readJson(path.join(root, 'installed.json'))?.version);
}

// The register's version, or null when it can't be read.
export function registerVersion(root = ROOT) {
  return text(readJson(path.join(root, ...REGISTER_PATH.split('/')))?.version);
}

function writeFileMade(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// Checks what is installed for `project` (its folder `projectDir`) against the manifest in
// `root`, then writes the hold file on a mismatch and removes it on a match. A manifest that
// can't be read is a mismatch at its own path. Returns { ok, mismatches, manifest (whether it
// was read), upstreams: { name: installed commit | null }, kept (whether the hold file now
// says so; false when it could not be written or removed) }.
export function checkLineage({ project, projectDir, root = ROOT, claudeHome = defaultClaudeHome(), locate = locateInstalled, now = () => new Date() }) {
  const file = holdFile(project);
  const upstreams = {};
  const seen = (upstream, where) => {
    const found = locate(upstream, where);
    upstreams[upstream.name] = typeof found?.sha === 'string' ? found.sha : null;
    return found;
  };
  let manifest = null;
  try {
    manifest = readManifest(root);
  } catch { /* a mismatch below */ }
  let result;
  if (manifest) {
    result = checkInstalled({ manifest, projectDir, claudeHome, locate: seen });
  } else {
    for (const upstream of UPSTREAMS) seen(upstream, { projectDir, claudeHome });
    result = { ok: false, mismatches: [{ upstream: null, path: MANIFEST_PATH, want: null, got: null }] };
  }
  let kept = true;
  try {
    if (result.ok) fs.rmSync(file, { force: true });
    else writeFileMade(file, { at: now().toISOString(), mismatches: result.mismatches });
  } catch {
    kept = false;
  }
  return { ...result, manifest: manifest !== null, upstreams, kept };
}

const shown = (relative) => ({ '*': 'not installed', '@commit': 'another commit' }[relative] ?? relative);

function named(paths) {
  const list = paths.slice(0, NAMED_PATHS).map(shown);
  if (paths.length > NAMED_PATHS) list.push(`and ${paths.length - NAMED_PATHS} more`);
  return list.join(', ');
}

export const MANIFEST_UNREADABLE = 'Lineage: Wheelhouse\'s manifest can\'t be read, so the installed skills can\'t be checked. Edits and commands are held. Raise this with the director as a card.';

// The session start's warning: one line for each upstream that differs.
export function warningLines(mismatches) {
  if (mismatches.some((m) => m.upstream === null)) return [MANIFEST_UNREADABLE];
  const byUpstream = new Map();
  for (const m of mismatches) byUpstream.set(m.upstream, [...(byUpstream.get(m.upstream) ?? []), m.path]);
  return [...byUpstream].map(([upstream, paths]) => `Lineage: the installed ${upstream} files differ from Wheelhouse's manifest (${named(paths)}). Edits and commands are held. Raise this with the director as a card.`);
}

// Writes the session's provenance: what it runs on, and whether the fingerprints matched.
export function writeProvenance({ project, sessionId, root = ROOT, upstreams, ok, claudeCode, transcript }) {
  const file = provenanceFile(project, sessionId);
  if (file === null) return null;
  const provenance = {
    wheelhouse: wheelhouseVersion(root),
    upstreams,
    register: registerVersion(root),
    claudeCode: claudeCode ?? null,
    fingerprints: ok ? 'match' : 'mismatch',
    transcript: typeof transcript === 'string' ? transcript : null,
  };
  writeFileMade(file, provenance);
  return provenance;
}

// What the command prints for a result.
export function report(result) {
  if (result.ok) {
    return result.kept
      ? 'The installed skills match Wheelhouse\'s manifest. The hold is lifted.'
      : 'The installed skills match Wheelhouse\'s manifest, but the hold could not be lifted from here. It lifts at the next session start.';
  }
  if (!result.manifest) return `Wheelhouse's manifest ${MANIFEST_PATH} can't be read, so the installed skills can't be checked. Edits and commands stay held.`;
  const lines = result.mismatches.map((m) => `- ${m.upstream}: ${shown(m.path)}`);
  return ['These installed files still differ from Wheelhouse\'s manifest. Edits and commands stay held.', ...lines].join('\n');
}

function realFolder(folder) {
  try {
    return fs.realpathSync.native(folder);
  } catch {
    return null;
  }
}

// Whether the registered projects can be listed. A sandbox that keeps commands out of the
// Wheelhouse home (Locked) makes them unreadable; none registered yet is readable.
function recordsReadable() {
  try {
    fs.readdirSync(path.dirname(projectHome('x')));
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

// The command: checks the registered project the folder belongs to (by path alone).
export function main(args, { cwd = process.cwd(), write = (line) => process.stdout.write(line), ...deps } = {}) {
  if (args.length > 1) {
    write('usage: node scripts/lineage/check.js [projectDir]\n');
    return 2;
  }
  const folder = realFolder(path.resolve(cwd, args[0] ?? '.'));
  if (!recordsReadable()) {
    write('Wheelhouse\'s records can\'t be read from here, so the hold stays until the next session start checks again.\n');
    return 1;
  }
  const found = folder === null ? null : projectForFolder(folder);
  if (!found) {
    write('This folder is not in a registered Wheelhouse project, so there is nothing to check.\n');
    return 1;
  }
  const result = checkLineage({ project: found.project, projectDir: found.record.folder, ...deps });
  write(`${report(result)}\n`);
  return result.ok ? 0 : 1;
}

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (Boolean(process.argv[1]) && startedAsScript()) {
  process.exitCode = main(process.argv.slice(2));
}
