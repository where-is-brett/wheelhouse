// probes/haiku-trial/snapshot.js
// The local side of a trial snapshot (spec 2026-11-13, section 3): a copy of the run folder and the trial's transcripts at a step
// boundary, kept beside the run so a later attempt can start from it. Nothing here calls GitHub, tmux or the network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where snapshots are taken. `after` points come once the named step has finished, `before` points just before it runs. A smoke
// run takes only the points whose step is in its own plan; `before-sitting-<n>` is added with the sittings.
export const SNAPSHOT_POINTS = [
  { point: 'after-front-desk', after: 'front-desk', mode: 'smoke' },
  { point: 'after-ntfy', after: 'ntfy', mode: 'full' },
  { point: 'after-w2-audit', after: 'w2-audit', mode: 'both' },
  { point: 'before-f1', before: 'f1', mode: 'full' },
  { point: 'after-w3-audit', after: 'w3-audit', mode: 'full' },
  { point: 'before-f4-check', before: 'f4-check', mode: 'full' },
  { point: 'before-s9-1', before: 's9-1', mode: 'both' },
  { point: 'after-w4-audit', after: 'w4-audit', mode: 'both' },
];

export const pointsFor = (mode) => SNAPSHOT_POINTS.filter((p) => p.mode === 'both' || p.mode === mode);

const TRIALS = path.join(os.homedir(), '.wheelhouse-trials');
export const snapshotsDir = (label, base = TRIALS) => path.join(base, `haiku-${label}.snapshots`);

const NUMBERED = /^(\d+)-(.+)$/;
const numberOf = (name) => Number(NUMBERED.exec(name)?.[1]);
const entries = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && NUMBERED.test(e.name)).map((e) => e.name); } catch { return []; }
};

// The next two-digit number in a snapshots folder.
export const nextNumber = (dir) => String(Math.max(0, ...entries(dir).map(numberOf)) + 1).padStart(2, '0');

export function writeMeta(dest, meta) {
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
}
export function readMeta(dest) {
  try { return JSON.parse(fs.readFileSync(path.join(dest, 'meta.json'), 'utf8')); } catch { return null; }
}

export function listSnapshots(dir) {
  return entries(dir).sort((a, b) => numberOf(a) - numberOf(b)).map((name) => ({ name, meta: readMeta(path.join(dir, name)) }));
}

// Sockets cannot be copied and mean nothing in a copy.
const notSocket = (src) => {
  if (src.endsWith('.sock')) return false;
  try { return !fs.lstatSync(src).isSocket(); } catch { return true; }
};

// What the run folder holds that a resume needs. The staged plugin's tarball and the score checkout are not part of it.
const RUN_PARTS = ['project', 'wheelhouse-home', 'plugin', 'state.json', 'run-log.jsonl'];

const jsonlFiles = (root) => {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) found.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return found;
};

// A copy caught while a file was being written ends in half a line. That line is cut, so the file reads back whole; the cut is
// returned so the snapshot's meta can say so.
function trimTorn(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text === '') return 0;
  const lines = text.split('\n');
  const tail = lines.length - 1;
  const at = lines[tail] === '' ? tail - 1 : tail;
  if (at < 0) return 0;
  try { JSON.parse(lines[at]); return 0; } catch { /* torn */ }
  fs.writeFileSync(file, lines.slice(0, at).map((l) => `${l}\n`).join(''));
  return 1;
}

export function takeLocal({ folder, dest, configDir = path.join(os.homedir(), '.claude'), transcripts = [] }) {
  const run = path.join(dest, 'run');
  fs.mkdirSync(run, { recursive: true });
  for (const part of RUN_PARTS) {
    const from = path.join(folder, part);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(run, part), { recursive: true, filter: notSocket });
  }
  const projects = path.join(configDir, 'projects');
  for (const file of transcripts) {
    const rel = path.relative(projects, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file)) continue;
    const to = path.join(dest, 'transcripts', rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(file, to);
  }
  const torn = [];
  for (const file of jsonlFiles(run)) {
    const cut = trimTorn(file);
    if (cut > 0) torn.push({ file: path.relative(run, file), cut });
  }
  return { torn };
}

export function restoreLocal({ dest, folder, configDir = path.join(os.homedir(), '.claude') }) {
  if (fs.existsSync(folder)) throw new Error(`${folder} already exists, so the snapshot is not put back over it`);
  const run = path.join(dest, 'run');
  if (!fs.existsSync(run)) throw new Error(`${dest} holds no run to put back`);
  fs.cpSync(run, folder, { recursive: true });
  const transcripts = path.join(dest, 'transcripts');
  if (fs.existsSync(transcripts)) fs.cpSync(transcripts, path.join(configDir, 'projects'), { recursive: true });
}
