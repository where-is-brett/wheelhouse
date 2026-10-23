// scripts/survey/words.js
// What the first briefing says about the survey (design section 15, rulings A2, A4 and A6): one
// line for work in flight, one for another agent setup's instructions, and one when the host
// couldn't be looked at. Plain words, with no "commit", "branch" or "worktree"; the host named as it
// is; a part with nothing in it never mentioned. Scheduled jobs and secret files are counted in the
// survey but never said here (ruling A5).

const HOST_NAMES = { github: 'GitHub', gitlab: 'GitLab' };
const HERE = 'on this computer';
// The files named first, by the name a director is likeliest to know; otherwise the first listed.
const NAMED_FIRST = ['AGENTS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md'];

const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const changes = (n) => counted(n, 'change waiting to be merged', 'changes waiting to be merged');
const pieces = (n) => counted(n, 'piece of unfinished work', 'pieces of unfinished work');

// Parts of a list in words: "a", "a, and b", "a, b, and c".
const listed = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`);

// The line about work in flight, or null. Work pushed is unfinished work on the host; in git alone
// (no host) it is on this computer, with the rest.
function inFlightLine(survey, hostName) {
  const requests = survey.requests?.length ?? 0;
  const pushed = survey.pushed?.length ?? 0;
  const local = survey.local?.length ?? 0;
  const parts = [];
  if (hostName !== null) {
    if (requests > 0) parts.push(`${changes(requests)} on ${hostName}`);
    if (pushed > 0) parts.push(`${pieces(pushed)} on ${hostName}`);
    if (local > 0) parts.push(`${pieces(local)} ${HERE}`);
  } else if (pushed + local > 0) {
    parts.push(`${pieces(pushed + local)} ${HERE}`);
  }
  if (parts.length === 0) return null;
  const total = (hostName === null ? 0 : requests) + pushed + local;
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

// briefingLines(survey, { host }) -> string[]: the survey's lines for the first briefing, in
// order; none for a survey with nothing to say. `host` is 'github', 'gitlab' or null (git alone).
export function briefingLines(survey, { host = null } = {}) {
  const hostName = HOST_NAMES[host] ?? null;
  const missed = hostName !== null && survey.hostReached === false
    ? `I couldn't look at ${hostName} for changes waiting to be merged; I'll look again next time.`
    : null;
  return [inFlightLine(survey, hostName), instructionsLine(survey), missed].filter((line) => line !== null);
}
