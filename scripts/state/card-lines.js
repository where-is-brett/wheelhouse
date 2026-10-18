// scripts/state/card-lines.js
// The exact words on the buttons and lines of the director's cards, so the
// front desk asks in the words the helper checks against.
import crypto from 'node:crypto';

// The line on the card that asks the director to push a CI change.
export function ciPushLine(branch, sha) {
  return `Push the CI change on ${branch} at commit ${String(sha).slice(0, 12)} with your own sign-in`;
}

const sha12 = (sha) => String(sha).slice(0, 12);

// The line on the card that asks the director to approve a pull request.
export function approvalLine(pr, sha) {
  return `Approve pull request #${pr} at commit ${sha12(sha)}`;
}

// The line that asks the director to confirm a ruling, a level or a setting.
export function confirmLine(event) {
  const words = typeof event?.data?.words === 'string' ? event.data.words : '';
  return `Confirm ${event?.kind} ${event?.id}: "${words}"`;
}

// The letters and digits a reply code is made from: none that are easy to mistake for another.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export const LIFT_STOP = 'Lift STOP and let the agents carry on';

export const RUNBOOK_TITLES = {
  1: 'Turn STOP on',
  2: "Cut the agents' access to the host",
  3: 'Put the product back to an earlier release',
  4: "Put the project's records back from the backup",
  5: 'Contain live harm',
};

// The line that asks the director to run a runbook step, with the commit when it names one.
export function runbookLine(step, sha) {
  const base = `Runbook step ${step}: ${RUNBOOK_TITLES[step]}`;
  return sha === undefined || sha === null ? base : `${base}, to commit ${sha12(sha)}`;
}

// A reply code: four characters of CODE_ALPHABET from the first bytes of the SHA-256 of a set
// line, so one line always has one code. A card shows it as replyCodeLine(code).
export function replyCode(line) {
  const bytes = crypto.createHash('sha256').update(String(line)).digest();
  return [...bytes.subarray(0, 4)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const replyCodeLine = (code) => `Reply code: ${code}`;

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The lines a card's choice is set by, each matching a whole line of the question: the
// approval, confirmation, lift-STOP, CI-push and runbook lines.
export const SET_LINES = [
  /^Approve pull request #[1-9][0-9]* at commit [0-9a-f]{12}$/m,
  /^Confirm [a-z-]+ \S+: ".*"$/m,
  new RegExp(`^${literal(LIFT_STOP)}$`, 'm'),
  /^Push the CI change on \S+ at commit [0-9a-f]{12} with your own sign-in$/m,
  new RegExp(`^Runbook step (?:${Object.entries(RUNBOOK_TITLES).map(([step, title]) => `${step}: ${literal(title)}`).join('|')})(?:, to commit [0-9a-f]{12})?$`, 'm'),
];

// The one set line a question carries, or null when it carries none, or two or more.
export function setLineOf(question) {
  if (typeof question !== 'string') return null;
  const found = SET_LINES.flatMap((pattern) => {
    const every = new RegExp(pattern.source, [...new Set(`${pattern.flags}gm`)].join(''));
    return [...question.matchAll(every)].map((m) => m[0]);
  });
  return found.length === 1 ? found[0] : null;
}
