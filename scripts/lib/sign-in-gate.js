// scripts/lib/sign-in-gate.js
// The sign-in gate (builders and settings design, section 10.2). One fact file on this computer, `<home>/sign-in.json`, maps
// `<agent>:<route>` to what a start that couldn't sign in left: { kind, since, command, excerpt, starts }. While a route has
// a fact, the waker starts nothing on it, for any project, because one sign-in serves every project on the computer. The fact
// is cleared only by a passing check (part 4); this file writes, reads, classifies and words it.
//
// A file that can't be read is never "no fact": the gate stays shut and names the file, the line and the column.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { faultLine } from './read-json-named.js';
import { KINDS, isPlain, validFact, signInFile, kindWords, readSignIn, commandName, timeWords, buildersLine, buildersHealth, GATE_LINE, gateFor, classify } from './sign-in-line.js';
import { hide } from './clean.js';
import { maskText } from '../state/secret-scan.js';
import { stopState } from './stop.js';

export { KINDS, signInFile, kindWords, readSignIn, commandName, timeWords, buildersLine, buildersHealth, GATE_LINE, gateFor, classify };
export const EXCERPT_CHARS = 200;

// Writes the whole map to a temporary name renamed over the file, so no reader sees half of it.
function writeFacts(home, facts) {
  const file = signInFile(home);
  fs.mkdirSync(home, { recursive: true });
  const temp = path.join(home, `.sign-in.${crypto.randomUUID().slice(0, 12)}.tmp`);
  try {
    fs.writeFileSync(temp, `${JSON.stringify(facts, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Records `fact` for `agentRoute`. A route with a fact already keeps its first time and counts the new start on it. A file
// that can't be read is not written over: it throws with the fault named.
export function writeSignInFact(home, agentRoute, fact) {
  // Frozen under All stop: nothing is recorded or counted until it lifts (section 12A.6).
  if (stopState().on) return null;
  const read = readSignIn(home);
  if (!read.ok) throw new Error(faultLine(read.fault));
  const before = read.facts[agentRoute];
  const next = { ...fact, ...(before ? { since: before.since, starts: before.starts + 1 } : {}) };
  if (!validFact(next)) throw new Error('This is not a sign-in fact');
  writeFacts(home, { ...read.facts, [agentRoute]: next });
  return next;
}

// Takes `agentRoute`'s fact away; nothing else. Says whether there was one.
export function clearSignInFact(home, agentRoute) {
  if (stopState().on) return false;
  const read = readSignIn(home);
  if (!read.ok) throw new Error(faultLine(read.fault));
  if (!Object.hasOwn(read.facts, agentRoute)) return false;
  const { [agentRoute]: gone, ...rest } = read.facts;
  writeFacts(home, rest);
  return gone !== undefined;
}

// A key or token after its name, a home folder that carries a user's name, and any long unbroken run of letters and digits
// (an opaque token no pattern knows) are hidden too, so the excerpt never carries one.
const NAMED_TOKEN = /\b(bearer|token|key|secret|password)(["']?\s*[:=]?\s*["']?)[A-Za-z0-9._~+/-]{12,}=*/gi;
const HOME_FOLDER = /(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s'"`]+/gi;
const LONG_RUN = /(?<![A-Za-z0-9])[A-Za-z0-9_+/=-]{40,}(?![A-Za-z0-9])/g;
function hideHome(text) {
  let home = '';
  try {
    home = os.homedir();
  } catch { /* none known */ }
  const out = home.length > 3 ? text.split(home).join('~') : text;
  return out.replace(HOME_FOLDER, '~');
}
// Up to EXCERPT_CHARS of the output as one line: control characters and runs of space made one space, and an address's own
// sign-in, every likely secret and the home folder hidden.
export function cleanExcerpt(output) {
  const masked = hideHome(maskText(hide(String(output ?? ''), [])).replace(NAMED_TOKEN, '$1$2[hidden]')).replace(LONG_RUN, '[hidden]');
  const one = masked.replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (one.length <= EXCERPT_CHARS) return one;
  let cut = one.slice(0, EXCERPT_CHARS - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

// The director's card the first time a route's fact is written (section 10.4): a plain question card through the First Mate.
// The recommendation is "check again": the waker can't tell where the First Mate runs, and the Desktop route is part 5's.
export const SIGN_IN_OPTIONS = Object.freeze({
  desktop: 'Use Claude Desktop for builders',
  launch: 'Set a launch command',
  again: "I've signed in; check again",
});
const SAID = Object.freeze({
  'not-signed-in': "it isn't logged in",
  blocked: 'its sign-in was refused for an organisation or a policy',
  'no-program': "it couldn't be found or run",
  other: 'it failed',
});
export function signInCard(fact) {
  const header = 'Sign-in';
  const ask = "Builders can't sign in on this computer";
  const what = `1 builder start failed at ${timeWords(fact.since)}. \`${commandName(fact.command)}\` said ${SAID[fact.kind] ?? SAID.other}. Work is waiting; nothing is retrying.`;
  const why = 'Only you can sign in, or choose how builders start.';
  const meanwhile = 'Approved work waits. Nothing is lost.';
  const says = {
    [SIGN_IN_OPTIONS.desktop]: 'Builders start in Claude Desktop, which is already signed in.',
    [SIGN_IN_OPTIONS.launch]: 'Give the command that starts Claude Code on this computer.',
    [SIGN_IN_OPTIONS.again]: 'Sign in to Claude Code first; Wheelhouse then checks and starts the waiting work.',
  };
  const options = [SIGN_IN_OPTIONS.desktop, SIGN_IN_OPTIONS.launch, SIGN_IN_OPTIONS.again];
  const recommend = SIGN_IN_OPTIONS.again;
  const because = 'signing in once serves every project on this computer';
  return {
    question: [ask, `What happened: ${what}`, `Why it comes to you: ${why}`, `Meanwhile: ${meanwhile}`].join('\n'),
    header,
    kind: 'question',
    level: 2,
    options,
    descriptions: options.map((o) => (o === recommend ? `Recommended: ${says[o]}` : says[o])),
    recommend,
    line: null,
    code: null,
    parts: {
      kind: 'question',
      header,
      ask,
      what,
      small: why,
      recommendation: `${recommend}, because ${because}.`,
      options: options.map((o) => ({ label: o, says: says[o], recommended: o === recommend })),
      why,
      meanwhile,
      line: null,
      code: null,
    },
  };
}
