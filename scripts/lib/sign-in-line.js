// scripts/lib/sign-in-line.js
// The small readers of the sign-in gate's fact file (`<home>/sign-in.json`) and the Builders line stated from it. They load
// only the JSON reader, so the session start and the board's status lines carry the line without the gate's writers and
// excerpt cleaning (scripts/lib/sign-in-gate.js, which holds the rest and names these again).
import path from 'node:path';
import { faultLine, readJsonNamed } from './read-json-named.js';

export const KINDS = Object.freeze(['not-signed-in', 'blocked', 'no-program', 'other']);
const NAME_CHARS = 60;
// A sign-in failure is one short message at the start of a run. Output longer than this is a session that ran, and what it
// printed about logging in is its own work, not a refusal.
const SHORT_OUTPUT = 2000;

export const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export const signInFile = (home) => path.join(home, 'sign-in.json');

// The words each kind is shown as, after "said it".
const KIND_WORDS = Object.freeze({
  'not-signed-in': 'not signed in',
  blocked: 'blocked',
  'no-program': "the program wasn't found",
  other: 'it failed',
});
export const kindWords = (kind) => KIND_WORDS[kind] ?? KIND_WORDS.other;

export function validFact(fact) {
  return isPlain(fact) && KINDS.includes(fact.kind) && typeof fact.since === 'string' && !Number.isNaN(Date.parse(fact.since))
    && typeof fact.command === 'string' && typeof fact.excerpt === 'string' && Number.isInteger(fact.starts) && fact.starts >= 1;
}

// { ok: true, facts } | { ok: false, fault } where fault is { file, line, column, hint }. No file is no facts.
export function readSignIn(home) {
  const file = signInFile(home);
  const read = readJsonNamed(file);
  if (read.ok === false) return { ok: false, fault: { file, line: read.line, column: read.column, hint: read.hint } };
  if (read.missing === true) return { ok: true, facts: {} };
  const bad = (hint) => ({ ok: false, fault: { file, line: null, column: null, hint } });
  if (!isPlain(read.value)) return bad('the file must be written inside one pair of curly brackets `{ }`');
  for (const [route, fact] of Object.entries(read.value)) {
    if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(route)) return bad('a name in it is not an agent and a route, like "claude-code:background"');
    if (!validFact(fact)) return bad(`the entry for ${route} doesn't hold a kind, a time, a command, an excerpt and a count`);
  }
  return { ok: true, facts: read.value };
}

// The program's name only: the last part of its path, with no extension a Windows program has, cut to NAME_CHARS. `file` is
// one program (a path may hold spaces), never a command line, so no argument and no folder ever reaches a line.
export function commandName(file) {
  const base = String(file ?? '').trim().split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat)$/i, '').replace(/[^\w.+-]/g, '');
  return (base === '' ? 'claude' : base).slice(0, NAME_CHARS);
}

// "14:02", this computer's own clock.
export function timeWords(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// The First Mate's Builders line, stated from the recorded facts and nothing else (section 10.5):
//   Builders: background as `claude` · can't sign in since 14:02 (not signed in)
//   Builders: Claude Desktop
//   Builders: not chosen · starting in the background
// `route` is what scripts/lib/route.js read: 'desktop', 'background', or null where none is saved (builders start in the background, and the line says so). A
// settings problem the route reader named (`fault`, as faultLine takes it) and a fact file that can't be read are said so,
// never left out.
export function buildersLine({ home, agent = 'claude-code', route = 'background', program = 'claude', fault = null } = {}) {
  if (fault !== null) return `Builders: ${faultLine(fault)}`;
  if (route === 'desktop') return 'Builders: Claude Desktop';
  // No route chosen: an install that predates the setting still starts builders in the background, so a sign-in fact kept for
  // that route is still said.
  if (route === null) {
    const kept = readSignIn(home);
    const none = 'Builders: not chosen · starting in the background';
    if (!kept.ok) return `${none} · ${faultLine(kept.fault)}`;
    const old = kept.facts[`${agent}:background`];
    return old === undefined ? none : `${none} · can't sign in since ${timeWords(old.since)} (${kindWords(old.kind)})`;
  }
  const as = `${route} as \`${commandName(program)}\``;
  const read = readSignIn(home);
  if (!read.ok) return `Builders: ${as} · ${faultLine(read.fault)}`;
  const fact = read.facts[`${agent}:${route}`];
  if (fact === undefined) return `Builders: ${as}`;
  return `Builders: ${route} as \`${commandName(fact.command)}\` · can't sign in since ${timeWords(fact.since)} (${kindWords(fact.kind)})`;
}

// The same line for the board's status lines, with its level: `watch` while builders can't sign in or the file can't be read.
export function buildersHealth({ home, agent = 'claude-code', route = 'background', program = 'claude', fault = null } = {}) {
  const read = readSignIn(home);
  const calm = fault === null && read.ok && (route === 'desktop' || read.facts[`${agent}:${route ?? 'background'}`] === undefined);
  return { level: calm ? 'ok' : 'watch', text: buildersLine({ home, agent, route, program, fault }) };
}

// What a start refused by the gate says, as a start refused for a damaged settings file says its own.
export const GATE_LINE = "not started: builders can't sign in";

// { open: true } | { open: false, reason }. A fact shuts the route; so does a file that can't be read.
export function gateFor(home, agentRoute) {
  const read = readSignIn(home);
  if (!read.ok) return { open: false, reason: `${GATE_LINE}: ${faultLine(read.fault)}` };
  const fact = read.facts[agentRoute];
  if (fact === undefined) return { open: true };
  return { open: false, reason: `${GATE_LINE} (${kindWords(fact.kind)} since ${timeWords(fact.since)})` };
}

// `exit` is { code, signal, error }: the run's own end. no-program is the system's word (a program not found or not allowed
// to run, or a command line cmd.exe can't be given safely), never the output's. Otherwise the short output is read with the
// agent's `patterns` ({ notSignedIn, blocked }): a forbidden organisation or a policy is blocked, before the rest.
export function classify(output, exit, patterns) {
  const error = exit?.error;
  if (error) {
    const code = typeof error === 'string' ? error : error.code;
    const said = typeof error === 'string' ? error : String(error.message ?? '');
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || /Cannot pass this to a \.cmd program safely/.test(said)) return 'no-program';
  }
  const text = typeof output === 'string' ? output : '';
  if (text.length > SHORT_OUTPUT) return 'other';
  const any = (list) => Array.isArray(list) && list.some((re) => re instanceof RegExp && re.test(text));
  if (any(patterns?.blocked)) return 'blocked';
  if (any(patterns?.notSignedIn)) return 'not-signed-in';
  return 'other';
}
