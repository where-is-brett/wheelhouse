// scripts/survey/words.js
// What the first briefing says about the survey (design section 15, rulings A2, A4 and A6): one
// line for work in flight, one for another agent setup's instructions, and one when the host
// couldn't be looked at. Plain words, with no "commit", "branch" or "worktree"; the host named as it
// is; a part with nothing in it never mentioned. Scheduled jobs and secret files are counted in the
// survey but never said here (ruling A5). At Autonomy Cautious and Balanced, work in flight is asked
// about on a card at setup's end in place of its line (carryOnCard); at Trusting, its line says
// Wheelhouse is carrying it on (trustingLine; ruling A9).
import { OTHER_SETUP_NAMED_FIRST } from '../lib/agent-control.js';

const HOST_NAMES = { github: 'GitHub', gitlab: 'GitLab' };
const HERE = 'on this computer';
// The files named first, by the name a director is likeliest to know; otherwise the first listed.
const NAMED_FIRST = OTHER_SETUP_NAMED_FIRST;

// A list the survey cut short (it looked at only so many lines) is said as at least what it found.
const counted = (n, one, many, more = false) => `${more ? 'at least ' : ''}${n} ${n === 1 ? one : many}`;
const changes = (n) => counted(n, 'change waiting to be merged', 'changes waiting to be merged');
const pieces = (n, more) => counted(n, 'piece of unfinished work', 'pieces of unfinished work', more);

// Parts of a list in words: "a", "a, and b", "a, b, and c".
const listed = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`);

// What is in flight, in words: { parts, total }, each part one kind of work and where it is, and
// `total` how many pieces in all (Infinity when a list was cut short). Work pushed is unfinished work
// on the host; in git alone (no host) it is on this computer, with the rest. A list cut short is said
// as at least what it holds, and, with nothing found in it, not at all.
function inFlight(survey, hostName) {
  const requests = survey.requests?.length ?? 0;
  const pushed = survey.pushed?.length ?? 0;
  const local = survey.local?.length ?? 0;
  const morePushed = survey.more?.pushed === true;
  const moreLocal = survey.more?.local === true;
  const parts = [];
  if (hostName !== null) {
    if (requests > 0) parts.push(`${changes(requests)} on ${hostName}`);
    if (pushed > 0) parts.push(`${pieces(pushed, morePushed)} on ${hostName}`);
    if (local > 0) parts.push(`${pieces(local, moreLocal)} ${HERE}`);
  } else if (pushed + local > 0) {
    parts.push(`${pieces(pushed + local, morePushed || moreLocal)} ${HERE}`);
  }
  const total = morePushed || moreLocal ? Infinity : (hostName === null ? 0 : requests) + pushed + local;
  return { parts, total };
}

// The line about work in flight, or null.
function inFlightLine(survey, hostName) {
  const { parts, total } = inFlight(survey, hostName);
  if (parts.length === 0) return null;
  return `Already under way here: ${listed(parts)}. Say if you'd like me to carry ${total === 1 ? 'it' : 'any of them'} on.`;
}

// The line about another agent setup's instructions, or null. A part of CLAUDE.md can't be moved
// on its own, so the archive is offered only for files, and named plainly when CLAUDE.md is in the
// list too.
function instructionsLine(survey) {
  const files = survey.instructions?.files ?? [];
  const sections = survey.instructions?.sections?.length ?? 0;
  if (files.length === 0 && sections === 0) return null;
  const parts = [];
  if (files.length > 0) {
    parts.push(NAMED_FIRST.find((f) => files.includes(f)) ?? files[0]);
    if (files.length > 1) parts.push(counted(files.length - 1, 'more file', 'more files'));
  }
  if (sections > 0) parts.push(sections === 1 ? 'a part of CLAUDE.md' : `${sections} parts of CLAUDE.md`);
  const what = parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  const line = `This project also has instructions for another agent setup (${what}). Mine come first where they differ.`;
  if (files.length === 0) return line;
  const moved = sections === 0 ? (files.length === 1 ? 'it' : 'them') : (files.length === 1 ? parts[0] : 'those files');
  return `${line} I can move ${moved} into an archive folder, which you can undo at any time.`;
}

// The work in flight in `survey` that `since`, an earlier survey already mentioned, didn't hold:
// requests by number, and pieces by name, wherever each is now.
function newSince(survey, since) {
  const items = (xs) => (Array.isArray(xs) ? xs : []);
  const numbers = new Set(items(since.requests).map((r) => r?.number));
  const names = new Set([...items(since.pushed), ...items(since.local)].map((i) => i?.name));
  return {
    ...survey,
    requests: items(survey.requests).filter((r) => !numbers.has(r?.number)),
    pushed: items(survey.pushed).filter((i) => !names.has(i?.name)),
    local: items(survey.local).filter((i) => !names.has(i?.name)),
  };
}

// briefingLines(survey, { host }) -> string[]: the survey's lines for the first briefing, in
// order; none for a survey with nothing to say. `host` is 'github', 'gitlab' or null (git alone).
// `leave` names lines a caller says itself and wants left out: 'inFlight', 'instructions', 'missed'.
// `carrying` says Wheelhouse is carrying the work in flight on (Autonomy at Trusting, ruling A9), so
// its line is trustingLine's. `since` is an earlier survey a briefing or the carry-on card already
// mentioned (one that missed the host, before this second look): only what is new since it is said
// of the work in flight, and the instructions line only when it says something else.
export function briefingLines(survey, { host = null, leave = [], carrying = false, since = null } = {}) {
  const hostName = HOST_NAMES[host] ?? null;
  const missed = hostName !== null && survey.hostReached === false
    ? `I couldn't look at ${hostName} for changes waiting to be merged; I'll look again next time.`
    : null;
  const earlier = since !== null && typeof since === 'object' && !Array.isArray(since) ? since : null;
  const flight = earlier === null ? survey : newSince(survey, earlier);
  const instructions = instructionsLine(survey);
  const lines = {
    inFlight: carrying ? trustingLine(flight, { host }) : inFlightLine(flight, hostName),
    instructions: earlier !== null && instructions === instructionsLine(earlier) ? null : instructions,
    missed,
  };
  return Object.entries(lines).filter(([name, line]) => line !== null && !leave.includes(name)).map(([, line]) => line);
}

// trustingLine(survey, { host }) -> the first briefing's line at Autonomy Trusting (ruling A9): what
// is in flight, and that Wheelhouse is carrying it on, one brief each; null with nothing in flight.
export function trustingLine(survey, { host = null } = {}) {
  const { parts, total } = inFlight(survey, HOST_NAMES[host] ?? null);
  if (parts.length === 0) return null;
  const carried = total === 1 ? 'I\'m carrying it on' : 'I\'m carrying them on, one brief each';
  return `Already under way here: ${listed(parts)}. ${carried}; say stop if you'd rather I didn't.`;
}

// The card's topic and its two answers (ruling A9). Leave it for now brings the offer back once, in
// a briefing a week after the click (seen.json's surveyAgainAt).
export const UNDER_WAY_TOPIC = 'under-way';
export const CARRY_ON = 'Carry on with it';
export const LEAVE_FOR_NOW = 'Leave it for now';

// carryOnCard(survey, { project, host }) -> the card setup ends with at Autonomy Cautious and
// Balanced when the survey found work in flight (ruling A9), as the composer's input
// (scripts/cards/compose.js), in the design's words, `project` the project's name; null with
// nothing in flight. A product question: its answer is a plain card-answer, as any such card's is.
export function carryOnCard(survey, { project, host = null } = {}) {
  const { parts, total } = inFlight(survey, HOST_NAMES[host] ?? null);
  if (parts.length === 0) return null;
  return {
    kind: 'question',
    level: 3,
    what: `Wheelhouse found work already under way in ${project}: ${listed(parts)}. Shall I carry ${total === 1 ? 'it' : 'them'} on?`,
    why: 'Each piece would go through the usual intake: a short brief of its own, built on from where it stands, and checked by the reviewer before anything is merged. The original work is never changed.',
    meanwhile: 'Nothing is touched while you decide.',
    options: [
      { label: CARRY_ON, says: 'Each piece gets its own brief and joins the queue, and you see each brief as usual.' },
      { label: LEAVE_FOR_NOW, says: 'It stays exactly as it is. I\'ll offer it once more in a briefing a week from now, or whenever you ask.' },
    ],
    recommend: CARRY_ON,
    because: 'the original work stays as it is and nothing is merged without a review',
    topic: UNDER_WAY_TOPIC,
    suggest: false,
  };
}
