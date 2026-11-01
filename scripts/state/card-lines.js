// scripts/state/card-lines.js
// The exact words on the buttons and lines of the director's cards, so the
// front desk asks in the words the helper checks against.
import crypto from 'node:crypto';

// The line on the card that asks the director to push a CI change.
export function ciPushLine(branch, sha) {
  return `Push the CI change on ${branch} at commit ${String(sha).slice(0, 12)} with your own sign-in`;
}

const sha12 = (sha) => String(sha).slice(0, 12);

// The buttons of the card for a host whose checks aren't running (local checks, spec 4.1).
export const RUN_CHECKS_HERE = 'Run the checks here';
export const LEAVE_THEM = 'Leave them';

// The buttons of the card for changes made by hand in a project's folder (spec 5.4).
export const CHECK_AND_ADD = 'Check and add them';
export const LEAVE_THEM_OUT = 'Leave them out';

// The line on the card that asks the director to approve a pull request.
export function approvalLine(pr, sha) {
  return `Approve pull request #${pr} at commit ${sha12(sha)}`;
}

// The line that asks the director to confirm a ruling, a level, a setting or a rule.
export function confirmLine(event) {
  const words = typeof event?.data?.words === 'string' ? event.data.words : '';
  return `Confirm ${event?.kind} ${event?.id}: "${words}"`;
}

// The line on the Unattended card for build commands on Windows: the click on its
// Turn on (dangerous) button confirms that one setting event, for that one computer.
export function unattendedBuildsLine(eventId, computer) {
  return `Run build commands unattended on this Windows computer, with nothing to hold them (${computer}, ${eventId})`;
}

// The letters and digits a reply code is made from: none that are easy to mistake for another.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

// The Lift All stop card's set line, and the button whose click on it lifts All stop. A card made before the halt
// switch was called All stop carries the earlier words, which every reader still takes: a waiting card, a reply code
// made from it, a lean record line and a signed click from then stay valid.
export const LIFT_STOP = 'Lift All stop and let the agents carry on';
export const LIFT_STOP_EARLIER = 'Lift STOP and let the agents carry on';
export const LIFT_STOP_LINES = Object.freeze([LIFT_STOP, LIFT_STOP_EARLIER]);
export const LIFT_LABEL = 'Lift All stop';
export const LIFT_LABEL_EARLIER = 'Lift STOP';
export const LIFT_LABELS = Object.freeze([LIFT_LABEL, LIFT_LABEL_EARLIER]);
// Whether `line` is the Lift All stop card's set line, in its words now or its earlier ones.
export const isLiftStopLine = (line) => LIFT_STOP_LINES.includes(line);

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

// Setup's steps, numbered as setup runs them (design section 15), with the titles their cards use.
export const SETUP_TITLES = Object.freeze({
  1: 'Install',
  2: 'Tools',
  3: 'The host and the connection',
  4: 'Three questions',
  5: 'Rules found',
  6: 'Changes to this computer',
  7: 'The project\'s files, pins and protection',
  8: 'Locked',
  9: 'Phone notifications',
  10: 'Health check',
});

// The label whose click on a setup card lets its step go ahead.
export const SETUP_LABEL = 'Go ahead';

// The line on a setup step's card: the step and the first twelve characters of the hash of the
// list of changes the card shows, so a click stands for that list and no other.
export function setupLine(step, hash) {
  return `Set up step ${step} as listed, ${sha12(hash)}`;
}

// The labels on setup's card of the rules found in a project (step 5, design section 9): the click
// on Confirm all confirms every rule the card lists; Let me correct some asks about each in turn.
export const CONFIRM_ALL_LABEL = 'Confirm all';
export const CORRECT_SOME_LABEL = 'Let me correct some';

// The line on that card: how many rules it lists and the first twelve characters of the hash of
// the list (each rule's words, where it was found and whether the words are the director's own),
// so a click stands for that list and no other.
export function confirmAllLine(hash, count) {
  return `Confirm all ${count} ${count === 1 ? 'rule' : 'rules'} as listed, ${sha12(hash)}`;
}

// The label whose click on the baseline card records the private note's figures (scripts/measures/).
export const BASELINE_LABEL = 'Record these';
// The words the baseline card's set line starts with, and its header. A card carrying the words, or
// the header with the figures, holds the private note's figures, which stay in
// <wheelhouseHome()>/measures/: the card check refuses any but the card the helper composed, the
// prompt record keeps such a card out of the state, and the state refuses an event carrying them
// (scripts/lib/measures-clicks.js, looksLikeBaseline).
export const BASELINE_WORDS = 'Record the private note\'s figures as the baseline';
export const BASELINE_HEADER = 'Baseline';

// The line on the baseline card: the first twelve characters of the hash of the figures it reads
// back, so a click stands for those figures and no others.
export function baselineLine(hash) {
  return `${BASELINE_WORDS}, ${sha12(hash)}`;
}

// The label whose click on a trust card trusted another of the director's computers (rulings R80, R81,
// retired: no trust card is handed out now). Kept so an old trust action in a record still reads.
export const TRUST_LABEL = 'Trust it';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// A time as the day it falls on, in UTC, day month year: "20 October 2026"; null when it can't be read.
export function dayOf(at) {
  const d = new Date(typeof at === 'string' ? at : Number.NaN);
  return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The line on a trust card (ruling R80, retired; kept so an old trust action still reads): the other
// computer by its id, the day its key was added to the profile, and the key's fingerprint (the first
// twelve hex characters of the SHA-256 of the public key), so a click stood for that computer's key
// as added that day and no other.
export function trustLine(computer, at, fingerprint) {
  return `Trust your computer ${computer}, added ${dayOf(at)}, key ${String(fingerprint).slice(0, 12)}`;
}
export const TRUST_LINE = new RegExp(`^Trust your computer ([0-9a-f]{8}), added ([1-9][0-9]? (?:${MONTHS.join('|')}) [0-9]{4}), key ([0-9a-f]{12})$`);

// The labels on the card that offers to take the lock from another computer (design section 9, "One computer at a time").
export const TAKEOVER_LABEL = 'Take over here';
export const LEAVE_LABEL = 'Leave it there';

// The line on that card: the computer that holds the lock and the counter it holds it at, so a click stands for the
// lock as the card showed it, and no later one.
export function takeOverLine(holder, counter) {
  return `Take over the lock from computer ${holder}, counter ${counter}`;
}
export const TAKEOVER_LINE = /^Take over the lock from computer ([0-9a-f]{8}), counter ([1-9][0-9]*)$/;

// The label on the card that pairs a later app with the desk (spec 5.3), and the line naming the app by its id and its
// key's fingerprint (the first twelve hex characters of the SHA-256 of its public key), so a click stands for that
// app's key and no other. Unpairing signs its own line.
export const PAIR_LABEL = 'Pair it';
export const UNPAIR_LABEL = 'Unpair it';
export const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export function pairLine(client, fingerprint) {
  return `Pair the app ${client}, key ${String(fingerprint).slice(0, 12)}`;
}
export const PAIR_LINE = /^Pair the app ([A-Za-z0-9][A-Za-z0-9._-]{0,63}), key ([0-9a-f]{12})$/;
export function unpairLine(client, fingerprint) {
  return `Unpair the app ${client}, key ${String(fingerprint).slice(0, 12)}`;
}
export const UNPAIR_LINE = /^Unpair the app ([A-Za-z0-9][A-Za-z0-9._-]{0,63}), key ([0-9a-f]{12})$/;

// The label whose click on uninstall's card lets it remove Wheelhouse from a project (ruling R90).
export const UNINSTALL_LABEL = 'Remove it';

// Whether a name can stand in uninstall's line: the project's slug, or the folder's own name when
// no project is registered there, on one line, with no control or format characters, at most 200
// characters, and no space at either end.
export function isLineName(name) {
  return typeof name === 'string' && name !== '' && name.length <= 200 && name.trim() === name
    && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name);
}

// The line on uninstall's card (ruling R90): the project and the first twelve characters of the hash
// of the list uninstall puts back, formed as setupLine's are, so a click stands for that list and no
// other.
export function uninstallLine(project, hash) {
  return `Remove Wheelhouse from ${project} as listed, ${sha12(hash)}`;
}
// The project's name runs to the last ", as listed," on the line, so a name holding those words still
// reads back whole.
export const UNINSTALL_LINE = /^Remove Wheelhouse from (\S(?:.*\S)?) as listed, ([0-9a-f]{12})$/;

// How the build loop's lines spell a work or incident id, a lane and a question id.
// The prompt record builds its own patterns from these, so the two agree.
export const ID = '[a-z0-9-]{1,40}';
export const LANES = 'quick|small|feature|bug';
export const QUESTION_ID = 'q-[a-z0-9-]+-[0-9]+';

// The line that asks the director to approve a piece of work as written. With
// `shownFirst`, the director is to see it before it merges.
export function approveWorkLine(work, lane, hash, { shownFirst = false } = {}) {
  return `Approve ${work} (${lane} lane) as written, ${sha12(hash)}${shownFirst ? ', and show it to me before it merges' : ''}`;
}

// The line on a question card; the click on an option answers the question.
export function answerLine(questionId) {
  return `Answer question ${questionId}`;
}

// The line on a blind card (scripts/delegation/blind.js): a click on it is kept and answers nothing.
export function blindLine(questionId) {
  return `First pick on question ${questionId}`;
}
export const BLIND_LINE = new RegExp(`^First pick on question (${QUESTION_ID})$`);

// The line that asks the director to change approved work to a proposed change.
export function amendLine(work, hash) {
  return `Change the approved ${work} to this, ${sha12(hash)}`;
}

// The line that asks the director to end an incident.
export function liftIncidentLine(id) {
  return `End incident ${id} and let merges carry on`;
}

// The line that asks the director to merge a pull request as an incident's fix.
export function incidentFixLine(id, pr) {
  return `Merge pull request #${pr} as the fix for incident ${id}`;
}

// The line on the card about a feature's files that steer agents (rulings P7-13, P7-31): its
// Confirm keeps them as they are now, the finding the line's twelve characters name, as the record
// the watcher compares them with before each wake.
export function keepControlLine(work, hash) {
  return `Keep the files that steer agents in ${work}'s folder as they are, ${sha12(hash)}`;
}
export const KEEP_CONTROL_LINE = new RegExp(`^Keep the files that steer agents in (${ID})'s folder as they are, ([0-9a-f]{12})$`);

// The line on a usage card (design section 14.6): the Thoroughness level its switch option sets and
// the time the card was offered, which its usage-card record keeps, so the click on that option
// stands for that offer's switch and no other. It is the director's confirmation of the change itself.
export function usageLine(level, at) {
  return `Switch Thoroughness to ${level}, as the usage card of ${at} offers`;
}
export const USAGE_LINE = /^Switch Thoroughness to (lightest|lean|balanced|thorough), as the usage card of ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z) offers$/;

// The line on the premium model's card (design section 14.6): the time the helper offered it, which its signed
// premium-card record keeps, so a click on one of its Allow options stands for that offer and no other. The option
// clicked says which: within the plan, or paid credits too. The click is the director's confirmation itself.
export function premiumLine(at) {
  return `Set the premium model as the premium card of ${at} offers`;
}
export const PREMIUM_LINE = /^Set the premium model as the premium card of ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z) offers$/;

// A reply code: four characters of CODE_ALPHABET, the first eight bytes of the SHA-256 of a set
// line read as one number and written in base 30, so one line always has one code and the codes
// come out evenly. A card shows it as replyCodeLine(code).
export function replyCode(line) {
  let n = crypto.createHash('sha256').update(String(line)).digest().readBigUInt64BE(0);
  const base = BigInt(CODE_ALPHABET.length);
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += CODE_ALPHABET[Number(n % base)];
    n /= base;
  }
  return code;
}

export const replyCodeLine = (code) => `Reply code: ${code}`;

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The lines a card's choice is set by, each matching a whole line of the question: the
// approval, confirmation, lift-STOP, CI-push and runbook lines, the build loop's five:
// approve work, answer a question, change approved work, end an incident and merge its fix,
// setup's line for a step, its line for the rules found, the baseline card's line, the trust
// card's line, the take-over card's line, uninstall's line, the line keeping a feature's files that steer agents, a usage card's line and the
// premium model card's line.
export const SET_LINES = [
  /^Approve pull request #[1-9][0-9]* at commit [0-9a-f]{12}$/m,
  /^Confirm [a-z-]+ \S+: ".*"$/m,
  new RegExp(`^(?:${LIFT_STOP_LINES.map(literal).join('|')})$`, 'm'),
  /^Push the CI change on \S+ at commit [0-9a-f]{12} with your own sign-in$/m,
  new RegExp(`^Runbook step (?:${Object.entries(RUNBOOK_TITLES).map(([step, title]) => `${step}: ${literal(title)}`).join('|')})(?:, to commit [0-9a-f]{12})?$`, 'm'),
  new RegExp(`^Approve ${ID} \\((?:${LANES}) lane\\) as written, [0-9a-f]{12}(?:, and show it to me before it merges)?$`, 'm'),
  new RegExp(`^Answer question ${QUESTION_ID}$`, 'm'),
  new RegExp(BLIND_LINE.source, 'm'),
  new RegExp(`^Change the approved ${ID} to this, [0-9a-f]{12}$`, 'm'),
  new RegExp(`^End incident ${ID} and let merges carry on$`, 'm'),
  new RegExp(`^Merge pull request #[1-9][0-9]* as the fix for incident ${ID}$`, 'm'),
  new RegExp(`^Set up step (?:${Object.keys(SETUP_TITLES).join('|')}) as listed, [0-9a-f]{12}$`, 'm'),
  /^Confirm all [1-9][0-9]* rules? as listed, [0-9a-f]{12}$/m,
  new RegExp(`^${literal(BASELINE_WORDS)}, [0-9a-f]{12}$`, 'm'),
  new RegExp(TRUST_LINE.source, 'm'),
  new RegExp(TAKEOVER_LINE.source, 'm'),
  new RegExp(PAIR_LINE.source, 'm'),
  new RegExp(UNPAIR_LINE.source, 'm'),
  new RegExp(UNINSTALL_LINE.source, 'm'),
  new RegExp(KEEP_CONTROL_LINE.source, 'm'),
  new RegExp(USAGE_LINE.source, 'm'),
  new RegExp(PREMIUM_LINE.source, 'm'),
];

// Every set line a question carries, in the order the patterns are listed.
export function setLinesOf(question) {
  if (typeof question !== 'string') return [];
  return SET_LINES.flatMap((pattern) => {
    const every = new RegExp(pattern.source, [...new Set(`${pattern.flags}gm`)].join(''));
    return [...question.matchAll(every)].map((m) => m[0]);
  });
}

// The one set line a question carries, or null when it carries none, or two or more.
export function setLineOf(question) {
  const found = setLinesOf(question);
  return found.length === 1 ? found[0] : null;
}

// The card's text as the chat shows it to the director: its plain lines alone, without the set line and the reply code
// at its end, which are for the signing, not for them to read. The prompt record finds the card again from these words
// (scripts/hooks/prompt-record.js) and signs from the text the state keeps, so a click signs as it always has. A card
// with no reply code (setup's, a trust card, a usage card and the rest), the baseline card, whose line the prompt
// record reads before it knows the project, and the Lift All stop card, which under STOP is handed out unrecorded, keep
// theirs: their click is read from the text alone. Text of any other
// shape comes back as it is, so a copy made twice is the same copy.
export function chatCopy(text) {
  if (typeof text !== 'string') return text;
  const lines = text.split('\n');
  if (lines.length < 3) return text;
  const [line, code] = lines.slice(-2);
  if (setLineOf(line) !== line || code !== replyCodeLine(replyCode(line)) || line.startsWith(BASELINE_WORDS) || isLiftStopLine(line)) return text;
  return lines.slice(0, -2).join('\n');
}
