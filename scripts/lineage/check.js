// scripts/lineage/check.js
// Whether the upstream skills installed for a Wheelhouse project are the ones Wheelhouse's
// manifest names. The session start runs the check (checkLineage) and records the session's
// provenance: a mismatch writes the project's hold file, and while it is there the hold hook
// (scripts/hooks/lineage-hold.js) refuses edits and commands; a match removes it. So the hold
// lifts only at a session start whose check matches (ruling R145): a session keeps the skills
// it loaded at its start. The command is the one the hold lets through: it reads only the
// installed Wheelhouse's manifest and Claude Code's record of installs, never the Wheelhouse
// home (a sandboxed command can't), says what still differs, and changes nothing.
// A hold's card leaves once its hold file is gone: recordLift puts one lineage-lift event in the
// state for each standing hold, from the session start or the mod's tick (scripts/mod/bridge.js).
// Reads files only: never git.
//   node scripts/lineage/check.js [projectDir]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from '../lib/paths.js';
import { canonicalJson } from '../lib/canonical.js';
import { MANIFEST_PATH, UPSTREAMS, checkInstalled, claudeHome as defaultClaudeHome, locateInstalled, readManifest } from './manifest.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { keep, pendingDir, taken } from '../hooks/pending.js';

// This copy's root, holding lineage/ beside scripts/: the plugin's folder, or Locked's managed copy.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTER_PATH = 'lineage/register.json';
// The most paths a warning names for one upstream before "and N more".
const NAMED_PATHS = 5;
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

// The project's folder under the Wheelhouse home (stateDir checks the name).
const projectHome = (project) => path.dirname(stateDir(project));

// While this file exists, the project's edits and commands are held: { at, mismatches, recorded? },
// where `recorded` is the mismatchSet already put in the state as a lineage-hold event.
export function holdFile(project) {
  return path.join(projectHome(project), 'lineage', 'hold.json');
}

// Noted when a lift is recorded, and removed when a hold file is written again: a lift is recorded
// once for each standing hold, though the views still show the hold until they are next synced.
function liftMark(project) {
  return path.join(projectHome(project), 'lineage', 'lifted.json');
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

// What a set of mismatches is, whatever their order: the sha256 of its upstreams and paths.
export function mismatchSet(mismatches) {
  const pairs = mismatches.map((m) => canonicalJson([m.upstream ?? null, m.path])).sort();
  return crypto.createHash('sha256').update(`[${pairs.join(',')}]`).digest('hex');
}

// Checks what is installed for the project in `projectDir` against the manifest in `root`.
// Reads only. A manifest that can't be read is a mismatch at its own path. Returns { ok,
// mismatches, manifest (whether it was read), upstreams: { name: installed commit | null } }.
export function inspectLineage({ projectDir, root = ROOT, claudeHome = defaultClaudeHome(), locate = locateInstalled }) {
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
  return { ...result, manifest: manifest !== null, upstreams };
}

// The session start's check: inspectLineage for `project` (its folder `projectDir`), then the
// hold file written on a mismatch and removed on a match. Returns inspectLineage's answer with
// kept (whether the hold file now says so; false when it could not be written or removed),
// and on a mismatch set (its mismatchSet) and recorded (whether the hold that stood already
// had that set put in the state, so it is not recorded again).
//
// With `pinsPending` (the project's setup run is open and has not yet done step 7, which installs
// the kits; ruling R136), a kit not installed at all is setup's own expected state, not drift: it is
// left out, so it writes no hold and no warning. Anything else that differs still holds. The kits
// left out are given as `pending`, so the session's provenance still says what it loaded.
export function checkLineage({ project, projectDir, root = ROOT, claudeHome = defaultClaudeHome(), locate = locateInstalled, now = () => new Date(), pinsPending = false }) {
  const file = holdFile(project);
  const inspected = inspectLineage({ projectDir, root, claudeHome, locate });
  const notInstalled = (m) => m.path === '*' && m.got === null && typeof m.upstream === 'string';
  const left = pinsPending ? inspected.mismatches.filter((m) => !notInstalled(m)) : inspected.mismatches;
  const pending = inspected.mismatches.filter((m) => !left.includes(m));
  const result = { ...inspected, mismatches: left, ok: left.length === 0, ...(pending.length > 0 ? { pending } : {}) };
  let kept = true;
  let set = null;
  let recorded = false;
  try {
    if (result.ok) fs.rmSync(file, { force: true });
    else {
      set = mismatchSet(result.mismatches);
      recorded = readJson(file)?.recorded === set;
      fs.rmSync(liftMark(project), { force: true });
      writeFileMade(file, { at: now().toISOString(), mismatches: result.mismatches, ...(recorded ? { recorded: set } : {}) });
    }
  } catch {
    kept = false;
  }
  return { ...result, kept, ...(result.ok ? {} : { set, recorded }) };
}

// Notes in the hold file that its mismatch set `set` is in the state now. Nothing is written
// when the hold is gone or holds another set.
export function markRecorded(project, set) {
  const file = holdFile(project);
  const held = readJson(file);
  if (held === null || typeof held !== 'object' || !Array.isArray(held.mismatches) || mismatchSet(held.mismatches) !== set) return false;
  writeFileMade(file, { ...held, recorded: set });
  return true;
}

// The lineage-hold event's data for a hold: when, which upstreams and paths differ, and the
// computer whose hold file it was (`computer`, when given).
export function holdEvent(at, mismatches, computer) {
  return { at, mismatches: mismatches.map((m) => ({ upstream: m.upstream ?? null, path: m.path })), ...(typeof computer === 'string' && computer !== '' ? { computer } : {}) };
}

// The lineage-lift event's data: when the computer's hold file was found gone.
export function liftEvent(at, computer) {
  return { at, computer };
}

// Whether a lift should be recorded now: this computer has no hold file (`held` false) while the
// views show a hold of this computer that no lift has lifted. A hold recorded with no computer
// counts as this computer's, as any lift lifts it.
export function liftsDue(views, { project, computer, held }) {
  if (held !== false) return false;
  const holds = Array.isArray(views?.lineageHolds) ? views.lineageHolds : [];
  return holds.some((h) => h !== null && typeof h === 'object' && (h.data?.computer === undefined || h.data.computer === computer));
}

// Whether a lift is recorded for the hold standing now: the mark says so, or a lift is kept for
// sending and no hold has been kept since (it counts as recorded, though the helper hasn't taken it).
export function liftKept(project) {
  if (readJson(liftMark(project)) !== null) return true;
  let names;
  try {
    names = fs.readdirSync(pendingDir(project)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return false;
  }
  let lifted = false;
  for (const name of names) {
    const kind = readJson(path.join(pendingDir(project), name))?.body?.kind;
    if (kind === 'lineage-lift') lifted = true;
    else if (kind === 'lineage-hold') lifted = false;
  }
  return lifted;
}

// Records a lift, once for each standing hold, when liftsDue says so and none is kept already: kept
// first, then sent through `client` within `left` (a kept one is sent at a later start otherwise).
// It informs, so a failure is passed over. Gives whether a lift was kept.
export async function recordLift({ project, views, computer, now = () => new Date(), client, left = (promise) => promise }) {
  try {
    if (!liftsDue(views, { computer, held: isHeld(project) }) || liftKept(project)) return false;
    const file = keep(project, 'write', { project, kind: 'lineage-lift', data: liftEvent(now().toISOString(), computer) }, now);
    try {
      writeFileMade(liftMark(project), { at: now().toISOString() });
    } catch { /* the kept record still counts until it is sent */ }
    try {
      if (taken(await left(client.state.write(readJson(file).body)))) fs.rmSync(file, { force: true });
    } catch { /* kept for a later send */ }
    return true;
  } catch {
    return false;
  }
}

const shown = (relative) => ({ '*': 'not installed', '@commit': 'another commit' }[relative] ?? relative);

// The first NAMED_PATHS of an upstream's paths as the warning names them, then "and N more".
export function namedPaths(paths) {
  const list = paths.slice(0, NAMED_PATHS).map(shown);
  if (paths.length > NAMED_PATHS) list.push(`and ${paths.length - NAMED_PATHS} more`);
  return list.join(', ');
}

// What the warning says of the hold: that it stands, or that it could not be written.
const HELD_LINE = 'Edits and commands are held until a session starts with matching files. Raise this with the director as a card.';
const NOT_HELD_LINE = 'The hold could not be written, so edits and commands are not held. Raise this with the director as a card.';
export const MANIFEST_UNREADABLE = `Lineage: Wheelhouse's manifest can't be read, so the installed skills can't be checked. ${HELD_LINE}`;
export const MANIFEST_UNREADABLE_NOT_HELD = `Lineage: Wheelhouse's manifest can't be read, so the installed skills can't be checked. ${NOT_HELD_LINE}`;

// The session start's warning: one line for each upstream that differs. `kept` false: the hold
// file could not be written, and the warning says so.
export function warningLines(mismatches, { kept = true } = {}) {
  if (mismatches.some((m) => m.upstream === null)) return [kept ? MANIFEST_UNREADABLE : MANIFEST_UNREADABLE_NOT_HELD];
  const byUpstream = new Map();
  for (const m of mismatches) byUpstream.set(m.upstream, [...(byUpstream.get(m.upstream) ?? []), m.path]);
  return [...byUpstream].map(([upstream, paths]) => `Lineage: the installed ${upstream} files differ from Wheelhouse's manifest (${namedPaths(paths)}). ${kept ? HELD_LINE : NOT_HELD_LINE}`);
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

export const MATCHED = 'The installed skills match Wheelhouse\'s manifest. A hold lifts at the next session start, whose check finds them matching; this command changes nothing.';

// What the command prints for inspectLineage's result.
export function report(result) {
  if (result.ok) return MATCHED;
  if (!result.manifest) return `Wheelhouse's manifest ${MANIFEST_PATH} can't be read, so the installed skills can't be checked. Edits and commands stay held.`;
  const lines = result.mismatches.map((m) => `- ${m.upstream}: ${shown(m.path)}`);
  return ['These installed files still differ from Wheelhouse\'s manifest, so edits and commands stay held. Once they match, the hold lifts at the next session start.', ...lines].join('\n');
}

function realFolder(folder) {
  try {
    return fs.realpathSync.native(folder);
  } catch {
    return null;
  }
}

// The folder Claude Code installed the upstreams for: `folder`, or the nearest folder above it
// with a project-scope install of one of them (a feature's worktree sits inside its project's
// folder). `folder` itself when there is none.
function installedFolder(folder, { claudeHome, locate }) {
  for (let dir = folder; ;) {
    if (UPSTREAMS.some((upstream) => locate(upstream, { projectDir: dir, claudeHome }) !== null)) return dir;
    const up = path.dirname(dir);
    if (up === dir) return folder;
    dir = up;
  }
}

// The command: checks what is installed for the folder's project, and changes nothing.
export function main(args, { cwd = process.cwd(), write = (line) => process.stdout.write(line), root = ROOT, claudeHome = defaultClaudeHome(), locate = locateInstalled } = {}) {
  if (args.length > 1) {
    write('usage: node scripts/lineage/check.js [projectDir]\n');
    return 2;
  }
  const folder = realFolder(path.resolve(cwd, args[0] ?? '.'));
  if (folder === null) {
    write('That folder can\'t be found, so there is nothing to check.\n');
    return 1;
  }
  const result = inspectLineage({ projectDir: installedFolder(folder, { claudeHome, locate }), root, claudeHome, locate });
  write(`${report(result)}\n`);
  return result.ok ? 0 : 1;
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
