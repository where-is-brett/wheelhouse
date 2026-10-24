// scripts/agents/copilot/kits.js
// The pinned loops' skills for background Copilot sessions (ruling P8-13; check 63). Claude Code loads the upstream
// skill kits (lineage/manifest.json) as plugins; a Copilot session reads skills only from its own home, which
// writeSessionHome rebuilds before every start (adapters/copilot/sessions.js). So Wheelhouse keeps one copy of each
// upstream's used skill folders on this computer, under `<wheelhouseHome>/agents/kits/<name>/<sha>/`, fetched once
// at the pinned commit with lineage's fetchUpstream, and checks every folder against the manifest's hash before it is
// copied into a session's home. A folder that differs, or a copy that isn't there, refuses the start, and the error
// carries the lineage hold's record (the `lineage-hold` kind, for the card the lineage hold already raises).
//
// A mismatch also writes the project's kit hold (`lineage/hold-copilot-kits.json`, scripts/lineage/check.js), so the
// project's hooks hold edits and commands and no tick lifts the hold's card while it stands; a start whose kits match
// removes it (kitsForSession).
//
// A link is never copied or followed: a kit folder holding one refuses the start.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fingerprintTree } from '../../lineage/fingerprint.js';
import { fetchUpstream, readManifest } from '../../lineage/manifest.js';
import { holdAgentWork, liftAgentWork, markAgentRecorded } from '../../lineage/check.js';
import { wheelhouseHome } from '../../lib/paths.js';

const NAME = /^[a-z0-9-]{1,64}$/;
const SHA = /^[0-9a-f]{40}$/;
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Where the kits are kept on this computer.
export const kitsDir = () => path.join(wheelhouseHome(), 'agents', 'kits');

// The folder one upstream's copy is kept in, by its name and pinned commit.
export function kitFolder(upstream) {
  if (!isPlain(upstream) || !NAME.test(upstream.name ?? '') || !SHA.test(upstream.sha ?? '')) throw new Error("An upstream kit needs a plain name and a pinned commit");
  return path.join(kitsDir(), upstream.name, upstream.sha);
}

// The parts of a folder path the manifest names (`skills/tdd`): plain names joined by "/", never `.` or `..`.
function partsOf(relative) {
  const parts = typeof relative === 'string' ? relative.split('/') : [];
  if (parts.length === 0 || parts.some((p) => p === '' || p === '.' || p === '..' || /[\\\0]/.test(p))) throw new Error(`This isn't a kit folder's path: ${JSON.stringify(relative)}`);
  return parts;
}

// Throws when anything under `dir` (or `dir` itself) is a link, so nothing copied from it can point elsewhere.
function refuseLinks(dir) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`A kit folder holds a link, which is never copied: ${dir}`);
  if (!stat.isDirectory()) return;
  for (const name of fs.readdirSync(dir)) refuseLinks(path.join(dir, name));
}

// The used folders of every upstream in the manifest, each `{ upstream, path, hash }`.
const foldersOf = (manifest) => manifest.upstreams.flatMap((u) => u.folders.map((f) => ({ upstream: u, path: f.path, hash: f.hash })));

// What differs between the kept copy and the manifest: one `{ upstream, path }` for each folder missing, holding a
// link, or with another hash.
export function kitMismatches({ manifest = readManifest() } = {}) {
  const mismatches = [];
  for (const folder of foldersOf(manifest)) {
    let ok = false;
    try {
      const dir = path.join(kitFolder(folder.upstream), ...partsOf(folder.path));
      refuseLinks(dir);
      ok = fingerprintTree(dir).hash === folder.hash;
    } catch {
      ok = false;
    }
    if (!ok) mismatches.push({ upstream: folder.upstream.name ?? null, path: folder.path });
  }
  return mismatches;
}

// An error naming the folders that differ, carrying the lineage hold's record for the card.
function mismatchError(mismatches, at) {
  const named = mismatches.slice(0, 3).map((m) => `${m.upstream}/${m.path}`).join(', ');
  return Object.assign(new Error(`The skill kits kept for Copilot sessions don't match Wheelhouse's manifest (${named}${mismatches.length > 3 ? ` and ${mismatches.length - 3} more` : ''}), so no session is started`), {
    records: [{ kind: 'lineage-hold', data: { at, mismatches: mismatches.map((m) => ({ upstream: m.upstream, path: m.path })) } }],
  });
}

// Fetches each upstream whose copy isn't kept yet, at its pinned commit, into a new folder under the kits folder,
// checks its used folders against the manifest, and keeps only those, renamed into place whole. `fetchTo(upstream,
// dir)` is lineage's fetchUpstream unless a test gives a local one. Throws (with the hold's record) when a fetched
// folder differs from the manifest; a fetch that fails throws as it is. Returns the names fetched.
export async function ensureKits({ manifest = readManifest(), fetchTo = fetchUpstream, now = () => new Date() } = {}) {
  const fetched = [];
  for (const upstream of manifest.upstreams) {
    const final = kitFolder(upstream);
    const there = fs.lstatSync(final, { throwIfNoEntry: false });
    if (there?.isDirectory()) continue;
    if (there) throw new Error(`The kept copy of ${upstream.name} isn't a folder Wheelhouse made`);
    const parent = path.dirname(final);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const work = path.join(parent, `.fetch-${crypto.randomUUID()}`);
    const keep = path.join(parent, `.keep-${crypto.randomUUID()}`);
    try {
      fs.mkdirSync(work);
      await fetchTo(upstream, work);
      const wrong = [];
      for (const folder of upstream.folders) {
        const from = path.join(work, ...partsOf(folder.path));
        try {
          refuseLinks(from);
          if (fingerprintTree(from).hash !== folder.hash) throw new Error('differs');
          const into = path.join(keep, ...partsOf(folder.path));
          fs.mkdirSync(path.dirname(into), { recursive: true });
          fs.cpSync(from, into, { recursive: true, errorOnExist: true, force: false });
        } catch {
          wrong.push({ upstream: upstream.name, path: folder.path });
        }
      }
      if (wrong.length > 0) throw mismatchError(wrong, now().toISOString());
      fs.renameSync(keep, final);
      fetched.push(upstream.name);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(keep, { recursive: true, force: true });
    }
  }
  return fetched;
}

// The skills a session's home gets, each `{ name, dir }` (the skill's folder name and its kept copy), once every kept
// folder matches the manifest. Throws, with the hold's record, when one doesn't, and when two upstreams' skills
// share a name.
export function kitSkills({ manifest = readManifest(), now = () => new Date() } = {}) {
  const mismatches = kitMismatches({ manifest });
  if (mismatches.length > 0) throw mismatchError(mismatches, now().toISOString());
  const skills = foldersOf(manifest).map((folder) => {
    const parts = partsOf(folder.path);
    return { name: parts.at(-1), dir: path.join(kitFolder(folder.upstream), ...parts), hash: folder.hash };
  });
  const names = skills.map((s) => s.name);
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice !== undefined) throw new Error(`Two upstream kits have a skill named ${twice}, so neither can be given to a session`);
  return skills;
}

// The agent hold a kit that differs takes, and what lifts it, as the card and the hook say it (ruling P8-32).
export const KITS_HOLD = 'copilot-kits';
export const KITS_LIFTS = "Putting the pinned kits back is yours to do on this computer, so it comes to you. No click here lifts the hold: the next Copilot session the watcher starts finds the kits matching and lifts it, as does this project running on Claude Code on this computer again.";

// kitsForSession({ project, manifest, fetchTo, now }) -> Promise<{ skills, lifted }>
//   Before a session of `project` starts: the kits fetched once (ensureKits) and checked (kitSkills). A match lifts
//   the project's kit hold; a mismatch writes it and refuses the start, the error carrying the lineage hold's record
//   until it is in the state (its `raised`, which the waker calls), so a hold raises one card. A fetch that fails
//   refuses the start as it is, and writes no hold: nothing was found to differ. `lifted` says a match removed the
//   project's kit hold, so its card can close.
export async function kitsForSession({ project, now = () => new Date(), ...kits } = {}) {
  try {
    await ensureKits({ ...kits, now });
    const skills = kitSkills({ ...kits, now });
    return { skills, lifted: liftAgentWork(project, KITS_HOLD) };
  } catch (error) {
    const record = Array.isArray(error?.records) ? error.records.find((r) => r?.kind === 'lineage-hold') : undefined;
    if (record === undefined) throw error;
    const { set, recorded } = holdAgentWork({ project, name: KITS_HOLD, agent: 'copilot', mismatches: record.data.mismatches, lifts: KITS_LIFTS, now });
    error.records = recorded ? [] : [{ ...record, data: { ...record.data, lifts: KITS_LIFTS } }];
    error.raised = () => markAgentRecorded(project, KITS_HOLD, set);
    throw error;
  }
}
