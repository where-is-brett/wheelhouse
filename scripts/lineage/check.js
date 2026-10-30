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
import { fingerprintTree } from './fingerprint.js';
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

// The ids of the holds whose lift has been recorded: a lift is recorded once for each standing hold,
// though the views still show the hold until they are next synced. It covers those holds only.
function liftMark(project) {
  return path.join(projectHome(project), 'lineage', 'lifted.json');
}

// An agent's own hold, beside the session start's (rulings P8-13, P8-23, P8-32, P8-33): `lineage/hold-<name>.json`,
// written and removed by that agent's own starter (its kits, or a new version of the agent that hasn't passed the
// safety checks), never by the session start's check, so a matching check can't lift it. `name` is a plain name. The
// file is { agent, at, mismatches, why?, lifts?, recorded?, ...what the starter keeps }: `agent` is the agent whose
// starter wrote it, `why` what holds the work and `lifts` what lifts it, each one line, which the hook and the card say.
//
// Every agent's hold counts here, whatever the project runs on: which agent that is is read in one place only, the
// project's configuration on its default branch, which the watcher holds (ruling P8-33), and nothing here can read
// it without git. A hold of an agent the project no longer runs is removed by the watcher (clearOtherAgentHolds),
// and only when that configuration and the main checkout's say the same other agent; until then it stands.
const AGENT_HOLD_NAME = /^[a-z0-9-]{1,64}$/;
const AGENT_HOLD_FILE = /^hold-[a-z0-9-]{1,64}\.json$/;
export function agentHoldFile(project, name) {
  if (typeof name !== 'string' || !AGENT_HOLD_NAME.test(name)) throw new Error(`An agent's hold needs a plain name: ${JSON.stringify(name)}`);
  return path.join(projectHome(project), 'lineage', `hold-${name}.json`);
}

// The agents' holds in the project's lineage folder, each { file, held } (held null when it can't be read), or null
// when the folder is there but can't be read.
function agentHolds(project) {
  const dir = path.dirname(holdFile(project));
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    return error?.code === 'ENOENT' ? [] : null;
  }
  return names.filter((name) => AGENT_HOLD_FILE.test(name)).map((name) => {
    const held = readJson(path.join(dir, name));
    return { file: path.join(dir, name), held: held !== null && typeof held === 'object' && !Array.isArray(held) ? held : null };
  });
}

// Whether the project's lineage folder holds any agent's hold file, for the watcher to look no further (and read
// nothing else) when it holds none. A folder that can't be read holds none it could remove.
export function hasAgentHolds(project) {
  return (agentHolds(project) ?? []).length > 0;
}

// Whether the project is held: by the session start's hold file, or by any agent's own. Anything at the hold file's
// place counts, and so does a lineage folder that can't be read.
export function isHeld(project) {
  try {
    fs.lstatSync(holdFile(project));
    return true;
  } catch (error) {
    if (error?.code !== 'ENOENT') return true;
  }
  const holds = agentHolds(project);
  return holds === null || holds.length > 0;
}

// What holds the project, for the hook to say: null when the session start's hold stands, it isn't held, or nothing
// better than the hook's own words can be said; otherwise an agent's hold's `why` and `lifts`.
export function agentHoldWords(project) {
  if (fs.lstatSync(holdFile(project), { throwIfNoEntry: false }) !== undefined) return null;
  const held = (agentHolds(project) ?? []).map((h) => h.held).find((h) => h !== null && typeof h.lifts === 'string');
  if (held === undefined) return null;
  return `${typeof held.why === 'string' ? held.why.replace(/\.+$/, '') : 'the skill kits kept for its sessions differ from its manifest'}. ${held.lifts}`;
}

// Removes the holds of agents other than the one the project runs here, for the watcher (ruling P8-33): `agent` is
// the agent its default branch's configuration names for this computer, the one the watcher starts sessions with, and
// `checkoutAgent` the one the main checkout's configuration names. Only when both are known and say the same is a
// hold of another agent removed: where they differ (a change not yet pulled, a local edit) or either can't be read,
// every hold stands. A hold that can't be read, or names no agent, stands. Gives how many were removed.
export function clearOtherAgentHolds(project, { agent, checkoutAgent }) {
  if (typeof agent !== 'string' || agent === '' || agent !== checkoutAgent) return 0;
  let removed = 0;
  for (const { file, held } of agentHolds(project) ?? []) {
    if (held === null || typeof held.agent !== 'string' || held.agent === agent) continue;
    fs.rmSync(file, { force: true });
    removed += 1;
  }
  return removed;
}

// An agent's hold as its file keeps it, or null when there is none or it can't be read.
export function readAgentHold(project, name) {
  const held = readJson(agentHoldFile(project, name));
  return held !== null && typeof held === 'object' && Array.isArray(held.mismatches) ? held : null;
}

// Writes `agent`'s hold for `mismatches` (each { upstream, path }), with `why`, `lifts` and anything else in `keep`
// kept in the file. Gives { set, recorded }: `recorded` is whether the hold that stood already had this set put in
// the state, so its lineage-hold record isn't raised again.
export function holdAgentWork({ project, name, agent, mismatches, why, lifts, keep = {}, now = () => new Date() }) {
  if (typeof agent !== 'string' || !AGENT_HOLD_NAME.test(agent)) throw new Error("An agent's hold needs the agent's name");
  const file = agentHoldFile(project, name);
  const set = mismatchSet(mismatches);
  const recorded = readJson(file)?.recorded === set;
  writeFileMade(file, {
    ...keep, agent, at: now().toISOString(), mismatches,
    ...(typeof why === 'string' ? { why } : {}), ...(typeof lifts === 'string' ? { lifts } : {}), ...(recorded ? { recorded: set } : {}),
  });
  return { set, recorded };
}

// Notes in an agent's hold that its set `set` is in the state now. Nothing is written when the hold is gone or holds
// another set.
export function markAgentRecorded(project, name, set) {
  const held = readAgentHold(project, name);
  if (held === null || mismatchSet(held.mismatches) !== set) return false;
  writeFileMade(agentHoldFile(project, name), { ...held, recorded: set });
  return true;
}

// Removes an agent's hold. Its card closes once no hold of the project is left (recordLift). Gives whether one was there.
export function liftAgentWork(project, name) {
  const file = agentHoldFile(project, name);
  const there = fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
  fs.rmSync(file, { force: true });
  return there;
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

// What a project's steps read when they use Wheelhouse's own skill copies rather than the kits (Archon design, section
// 7.1): each copy in `root` against the manifest's fingerprint, in inspectLineage's shape. A manifest with no copies
// can't be checked, which is a mismatch at its own path.
export function inspectCopies({ root = ROOT } = {}) {
  let copies = null;
  try {
    copies = readManifest(root).copies ?? null;
  } catch { /* a mismatch below */ }
  if (copies === null) return { ok: false, mismatches: [{ upstream: null, path: MANIFEST_PATH, want: null, got: null }], manifest: false, upstreams: {} };
  const mismatches = copies.flatMap((copy) => {
    let got = null;
    try { got = fingerprintTree(path.join(root, ...copy.path.split('/'))).hash; } catch { /* not there */ }
    return got === copy.hash ? [] : [{ upstream: 'wheelhouse', path: copy.path, want: copy.hash, got }];
  });
  return { ok: mismatches.length === 0, mismatches, manifest: true, upstreams: {} };
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
//
// `inspect` is what the hold goes by: the installed kits unless told otherwise (recheckCopies).
export function checkLineage({ project, projectDir, root = ROOT, claudeHome = defaultClaudeHome(), locate = locateInstalled, now = () => new Date(), pinsPending = false, inspect = inspectLineage }) {
  const file = holdFile(project);
  const inspected = inspect({ projectDir, root, claudeHome, locate });
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

// The lineage-hold event's data for a hold: when, and which upstreams and paths differ. The
// computer whose hold file it was is the event's own (every event is stamped with it).
export function holdEvent(at, mismatches) {
  return { at, mismatches: mismatches.map((m) => ({ upstream: m.upstream ?? null, path: m.path })) };
}

// The lineage-lift event's data: when the hold file was found gone, and the ids of the holds it lifts.
export function liftEvent(at, holds) {
  return { at, holds };
}

// The ids of the holds in the views that are this computer's (by the hold event's own computer),
// which a lift should lift if their hold file is gone (`held` false).
export function holdsToLift(views, { computer, held }) {
  if (held !== false || typeof computer !== 'string') return [];
  const holds = Array.isArray(views?.lineageHolds) ? views.lineageHolds : [];
  return holds.filter((h) => h !== null && typeof h === 'object' && typeof h.id === 'string' && h.computer === computer).map((h) => h.id);
}

// Whether a lift should be recorded now: this computer has no hold file while the views show a hold
// of this computer that no lift has lifted.
export function liftsDue(views, { computer, held }) {
  return holdsToLift(views, { computer, held }).length > 0;
}

// The ids of the holds whose lift is recorded: by the mark, or kept for sending (it counts as
// recorded though the helper hasn't taken it yet).
export function liftedIds(project) {
  const ids = new Set(Array.isArray(readJson(liftMark(project))?.holds) ? readJson(liftMark(project)).holds : []);
  let names = [];
  try {
    names = fs.readdirSync(pendingDir(project)).filter((n) => n.endsWith('.json'));
  } catch { /* none kept */ }
  for (const name of names) {
    const body = readJson(path.join(pendingDir(project), name))?.body;
    if (body?.kind === 'lineage-lift' && Array.isArray(body.data?.holds)) body.data.holds.forEach((id) => ids.add(id));
  }
  return ids;
}

// Records a lift of the holds due and not yet lifted, once for each hold, when their hold file is
// gone: kept first, then sent through `client` within `left` (a kept one is sent at a later start
// otherwise). It informs, so a failure is passed over. Gives whether a lift was kept.
export async function recordLift({ project, views, computer, now = () => new Date(), client, left = (promise) => promise }) {
  try {
    // A standing hold costs one stat per tick: nothing is read until the hold file is gone.
    if (isHeld(project)) return false;
    const have = liftedIds(project);
    if (holdsToLift(views, { computer, held: isHeld(project) }).filter((id) => !have.has(id)).length === 0) return false;
    // Looked at again just before keeping: a hold file written meanwhile is a hold this lift is not for.
    const ids = holdsToLift(views, { computer, held: isHeld(project) }).filter((id) => !have.has(id));
    if (ids.length === 0) return false;
    const file = keep(project, 'write', { project, kind: 'lineage-lift', data: liftEvent(now().toISOString(), ids) }, now);
    try {
      writeFileMade(liftMark(project), { holds: [...have, ...ids] });
    } catch { /* the kept record still counts until it is sent */ }
    try {
      if (taken(await left(client.state.write(readJson(file).body)))) fs.rmSync(file, { force: true });
    } catch { /* kept for a later send */ }
    return true;
  } catch {
    return false;
  }
}

// Where a run of a project whose steps read Wheelhouse's own copies starts: the hold goes by those copies, not the kits,
// and lifts here by itself once they match, with its card closed; a mismatch writes it, and the state hears once. Only
// for a project whose agent is known to be one that reads them, which the caller has settled (ruling P8-33). `write(kind,
// data)` puts a record in the state; `views` holds the project's lineage holds. Gives checkLineage's answer.
export async function recheckCopies({ project, projectDir, root = ROOT, views, computer, write, now = () => new Date() }) {
  const result = checkLineage({ project, projectDir, root, now, inspect: inspectCopies });
  if (!result.ok) {
    if (result.kept && !result.recorded) {
      await write('lineage-hold', holdEvent(now().toISOString(), result.mismatches));
      markRecorded(project, result.set);
    }
    return result;
  }
  const client = { state: { write: async (body) => { await write(body.kind, body.data); return { ok: true }; } } };
  await recordLift({ project, views, computer, now, client });
  return result;
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

// Writes the session's provenance: what it runs on, and whether the fingerprints matched. A session of an agent
// other than Claude Code (ruling P8-19) names it (`agent`), its version (`agentVersion`), the editor's and the
// agent's runtime's versions (`editor`, `runtime`) and the models its run used (`models`, as it has no transcript to
// read them from); each is null when not known. Claude Code's session start gives none of them, and its file is as
// it was.
export function writeProvenance({ project, sessionId, root = ROOT, upstreams, ok, claudeCode, transcript, agent, agentVersion, editor, runtime, models }) {
  const file = provenanceFile(project, sessionId);
  if (file === null) return null;
  const provenance = {
    wheelhouse: wheelhouseVersion(root),
    upstreams,
    register: registerVersion(root),
    claudeCode: claudeCode ?? null,
    fingerprints: ok ? 'match' : 'mismatch',
    transcript: typeof transcript === 'string' ? transcript : null,
    ...(typeof agent === 'string' ? {
      agent, agentVersion: agentVersion ?? null, editor: editor ?? null, runtime: runtime ?? null, models: Array.isArray(models) ? models : [],
    } : {}),
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
