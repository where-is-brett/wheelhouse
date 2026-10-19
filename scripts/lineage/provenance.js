// scripts/lineage/provenance.js
// What built a pull request or a report: the Wheelhouse version, the upstream commits, the
// register's version, the Claude Code version, the models and whether the fingerprints
// matched. The helper stamps it as a short block in every pull request's body, from the
// session's provenance.json on this computer (written at session start), and the merge gate
// reads the block back and checks it against the installed Wheelhouse's own manifest.
import fs from 'node:fs';
import { readTailEntries } from '../hooks/kit.js';
import { provenanceFile } from './check.js';
import { readManifest } from './manifest.js';

export const BEGIN = '<!-- wheelhouse-provenance -->';
export const END = '<!-- /wheelhouse-provenance -->';
// How much of the end of a session's transcript is read for the models it used.
const TRANSCRIPT_BYTES = 8 * 1024 * 1024;
// The most a provenance.json may be.
const FILE_BYTES = 64 * 1024;
// A value the block can carry on its line: no spaces, no markup, nothing that ends the block.
const VALUE = /^[A-Za-z0-9._:@+/-]{1,128}$/;
const UPSTREAM_NAME = /^[a-z0-9-]{1,64}$/;
const UNKNOWN = 'unknown';
const FINGERPRINTS = ['match', 'mismatch'];
// Claude Code's own name for an entry it made up rather than a model wrote.
const SYNTHETIC = '<synthetic>';

// Why provenance does not match, always one of these fixed phrases (never text from a pull request).
export const WHY = Object.freeze({
  none: 'no provenance block',
  unreadable: 'the provenance block can\'t be read',
  manifest: 'the installed manifest can\'t be read',
  wheelhouse: 'the Wheelhouse version differs',
  upstream: 'an upstream commit differs',
  fingerprints: 'the fingerprints did not match',
  claudeCode: 'Claude Code is older than the floor',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const valueOrNull = (value) => (typeof value === 'string' && VALUE.test(value) ? value : null);
const shown = (value) => valueOrNull(value) ?? UNKNOWN;
const read = (value) => (value === UNKNOWN ? null : value);

// The distinct models of a transcript's assistant entries, in the order first seen.
export function modelsOf(entries) {
  const models = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const model = entry?.type === 'assistant' ? entry.message?.model : undefined;
    if (model === SYNTHETIC || valueOrNull(model) === null || models.includes(model)) continue;
    models.push(model);
  }
  return models;
}

// The provenance of `sessionId` in `project`, from its provenance.json on this computer, with
// the models from its transcript. Null when there is no such file or it is not one.
export function sessionProvenance({ project, sessionId, readEntries = (file) => readTailEntries(file, { bytes: TRANSCRIPT_BYTES }) }) {
  let file;
  let kept;
  try {
    file = provenanceFile(project, sessionId);
    if (file === null) return null;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > FILE_BYTES) return null;
    kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isObject(kept) || !isObject(kept.upstreams) || !FINGERPRINTS.includes(kept.fingerprints)) return null;
  const upstreams = {};
  for (const [name, sha] of Object.entries(kept.upstreams)) {
    if (!UPSTREAM_NAME.test(name)) return null;
    upstreams[name] = valueOrNull(sha);
  }
  let models = [];
  try {
    models = typeof kept.transcript === 'string' && kept.transcript !== '' ? modelsOf(readEntries(kept.transcript)) : [];
  } catch { /* none read */ }
  return {
    wheelhouse: valueOrNull(kept.wheelhouse),
    upstreams,
    register: valueOrNull(kept.register),
    claudeCode: valueOrNull(kept.claudeCode),
    models,
    fingerprints: kept.fingerprints,
  };
}

// The block for `provenance`, one line each.
export function provenanceBlock(provenance) {
  const p = isObject(provenance) ? provenance : {};
  const models = (Array.isArray(p.models) ? p.models : []).filter((m) => valueOrNull(m) !== null);
  const upstreams = Object.entries(isObject(p.upstreams) ? p.upstreams : {}).filter(([name]) => UPSTREAM_NAME.test(name));
  return [
    BEGIN,
    '**Built with**',
    `- Wheelhouse: ${shown(p.wheelhouse)}`,
    ...upstreams.map(([name, sha]) => `- Upstream ${name}: ${shown(sha)}`),
    `- Register: ${shown(p.register)}`,
    `- Claude Code: ${shown(p.claudeCode)}`,
    `- Models: ${models.length > 0 ? models.join(', ') : 'none'}`,
    `- Fingerprints: ${FINGERPRINTS.includes(p.fingerprints) ? p.fingerprints : 'mismatch'}`,
    END,
  ].join('\n');
}

const BLOCK = () => new RegExp(`${BEGIN}[\\s\\S]*?${END}`, 'g');

// `body` with every block, and any marker left on its own, taken out.
export function removeProvenance(body) {
  const text = typeof body === 'string' ? body : '';
  return text.replace(BLOCK(), '').replaceAll(BEGIN, '').replaceAll(END, '').trimEnd();
}

// `body` with a block for `provenance` in place of any it had, at the end.
export function stampProvenance(body, provenance) {
  const rest = removeProvenance(body);
  return `${rest === '' ? '' : `${rest}\n\n`}${provenanceBlock(provenance)}\n`;
}

// The provenance in `body`'s block, or null when it has none, more than one, or one that
// can't be read.
export function parseProvenance(body) {
  const blocks = typeof body === 'string' ? body.match(BLOCK()) ?? [] : [];
  if (blocks.length !== 1) return null;
  const lines = blocks[0].slice(BEGIN.length, -END.length).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== '**Built with**') return null;
  const found = { upstreams: {} };
  for (const line of lines.slice(1)) {
    const m = /^- ([A-Za-z][A-Za-z ]*?|Upstream [a-z0-9-]{1,64}): (.+)$/.exec(line);
    if (!m) return null;
    const [, key, value] = m;
    const upstream = /^Upstream ([a-z0-9-]{1,64})$/.exec(key);
    if (upstream) {
      if (Object.hasOwn(found.upstreams, upstream[1]) || (value !== UNKNOWN && !VALUE.test(value))) return null;
      found.upstreams[upstream[1]] = read(value);
      continue;
    }
    const field = { Wheelhouse: 'wheelhouse', Register: 'register', 'Claude Code': 'claudeCode', Models: 'models', Fingerprints: 'fingerprints' }[key];
    if (field === undefined || Object.hasOwn(found, field)) return null;
    if (field === 'models') {
      const models = value === 'none' ? [] : value.split(', ');
      if (models.some((model) => !VALUE.test(model))) return null;
      found.models = models;
    } else if (field === 'fingerprints') {
      if (!FINGERPRINTS.includes(value)) return null;
      found.fingerprints = value;
    } else {
      if (value !== UNKNOWN && !VALUE.test(value)) return null;
      found[field] = read(value);
    }
  }
  const fields = ['wheelhouse', 'register', 'claudeCode', 'models', 'fingerprints'];
  if (!fields.every((field) => Object.hasOwn(found, field))) return null;
  return {
    wheelhouse: found.wheelhouse, upstreams: found.upstreams, register: found.register,
    claudeCode: found.claudeCode, models: found.models, fingerprints: found.fingerprints,
  };
}

// Whether version text `a` ('2.1.300') is at or above `b`. False when either can't be read.
function atLeast(a, b) {
  const parts = (v) => (typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)(?![0-9])/.exec(v)?.slice(1).map(Number) : null) ?? null;
  const [x, y] = [parts(a), parts(b)];
  if (x === null || y === null) return false;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
}

// Whether `provenance` is what `manifest` says Wheelhouse runs on: the same Wheelhouse version,
// every upstream at the manifest's commit (and no other), the fingerprints matched, and Claude
// Code at or above the floor. `why` is one of WHY.
export function provenanceMatches(provenance, manifest) {
  if (!isObject(provenance)) return { ok: false, why: WHY.none };
  if (!isObject(manifest)) return { ok: false, why: WHY.manifest };
  if (provenance.wheelhouse !== manifest.wheelhouse?.version) return { ok: false, why: WHY.wheelhouse };
  const upstreams = isObject(provenance.upstreams) ? provenance.upstreams : {};
  const wanted = Array.isArray(manifest.upstreams) ? manifest.upstreams : [];
  const same = Object.keys(upstreams).length === wanted.length && wanted.every((u) => upstreams[u.name] === u.sha);
  if (!same) return { ok: false, why: WHY.upstream };
  if (provenance.fingerprints !== 'match') return { ok: false, why: WHY.fingerprints };
  if (!atLeast(provenance.claudeCode, manifest.claudeCode?.floor)) return { ok: false, why: WHY.claudeCode };
  return { ok: true };
}

// The gate's provenance condition for a pull request's body, against the manifest of the
// Wheelhouse installed at `root`.
export function bodyProvenance(body, root) {
  let manifest;
  try {
    manifest = readManifest(root);
  } catch {
    return { ok: false, why: WHY.manifest };
  }
  if (typeof body !== 'string' || !body.includes(BEGIN)) return { ok: false, why: WHY.none };
  const provenance = parseProvenance(body);
  if (provenance === null) return { ok: false, why: WHY.unreadable };
  return provenanceMatches(provenance, manifest);
}
