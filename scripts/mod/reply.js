// scripts/mod/reply.js
// A card that decides something carries a reply code, so the director can answer it with a
// typed or phoned message that is just the code and an option ("K7QD Approve"). Such a reply
// counts as the click: it earns exactly the signed record the click would have, through the
// prompt record's own code, and nothing else. A plain "yes" never counts. The bridge, run by
// the mod outside the sandbox, calls replyRecord. The message's text is only parsed: it is
// never written anywhere, and only the card's own spelling of the option is used.
//
// A code is good once. The shown view is built here from the state clone, which the helper
// writes each record into, so a record taken a moment ago spends its card at once; a signed
// record still kept in pending/ that answers the card spends it too. And before anything is
// signed the card is claimed with a marker of its own, projects/<project>/replied/<shown id>,
// made only if it doesn't exist, so two replies at once can't both get through.
import fs from 'node:fs';
import path from 'node:path';
import { earned, keepEarned, sendKept, SIGNED_LABELS } from '../hooks/prompt-record.js';
import { withinBudget, pendingDir, BUDGET_MS } from '../hooks/pending.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift } from '../lib/stop.js';
import { stateDir } from '../lib/paths.js';
import { listEvents } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { CODE_ALPHABET, RUNBOOK_TITLES, setLineOf, replyCode } from '../state/card-lines.js';
import { REPLY_CODE_DAYS } from '../lib/core-numbers.js';
import { PUT_OFF } from '../lib/front-desk.js';

const DAY = 24 * 60 * 60 * 1000;
// Longer than any option a card offers; a longer message is not a reply.
const LABEL_CHARS = 80;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fold = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();

// The code and option a message is, or null. The whole message must be a code of four
// characters from the code alphabet and an option, in any case, with any spacing and one
// closing full stop.
export function parseReply(text) {
  if (typeof text !== 'string') return null;
  let words = text.replace(/\s+/g, ' ').trim();
  if (words.endsWith('.')) words = words.slice(0, -1).trimEnd();
  const m = /^([A-Za-z0-9]{4}) (.+)$/.exec(words);
  if (!m || m[2].length > LABEL_CHARS || /[\p{Cc}\p{Cf}]/u.test(m[2])) return null;
  const code = m[1].toUpperCase();
  if ([...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return { code, label: m[2] };
}

// The record a reply earned, in plain words.
export function recordedAs(made, question) {
  const data = made.data ?? {};
  if (made.kind === 'approval') return `Approve pull request #${data.pr}`;
  if (made.kind === 'confirmation') {
    const kind = /^Confirm ([a-z-]+) /.exec(setLineOf(question) ?? '')?.[1];
    return kind ? `Confirm the ${kind}` : 'Confirm';
  }
  if (data.action === 'lift-stop') return 'Lift STOP';
  if (data.action === 'runbook') return `Runbook step ${data.step}: ${RUNBOOK_TITLES[data.step]}`;
  if (data.action === 'ci-push') return `Push the CI change on ${data.branch}`;
  if (data.action === 'approve-work') return `Approve ${data.work}`;
  if (data.action === 'answer') return `Answer: ${data.label}`;
  if (data.action === 'amend') return `Change ${data.work}`;
  if (data.action === 'lift-incident') return `End incident ${data.incident}`;
  if (data.action === 'incident-fix') return `Merge pull request #${data.pr} as the fix`;
  return data.label ?? made.kind;
}

const no = (says) => ({ made: false, says });

// The shown view and its damage, built from the state clone as writeViews builds them.
function shownNow(project, now) {
  const damaged = [];
  const events = listEvents(stateDir(project), { report: () => {}, skipped: damaged });
  const views = buildViews(events, readEnrolled(), { damaged, now });
  return { shown: views.shown, damaged: views.damaged };
}

// Whether a signed record kept in pending/, not yet taken by the helper, answers the card: it
// carries the card's question, or confirms the event the card's confirm line names.
export function answeredInPending(project, question) {
  const named = /^Confirm [a-z-]+ (\S+): "/m.exec(question)?.[1];
  let names;
  try {
    names = fs.readdirSync(pendingDir(project)).filter((n) => n.endsWith('.json'));
  } catch {
    return false;
  }
  return names.some((name) => {
    try {
      const { route, body } = JSON.parse(fs.readFileSync(path.join(pendingDir(project), name), 'utf8'));
      const event = body?.event;
      if ((route !== 'record' && route !== 'profile-record') || !isRecord(event) || event.kind === 'shown') return false;
      return event.data?.question === question || (named !== undefined && event.kind === 'confirmation' && event.data?.confirms === named);
    } catch {
      return false;
    }
  });
}

// The folder of the markers that claim a card: projects/<project>/replied/.
export const repliedDir = (project) => path.join(stateDir(project), '..', 'replied');

// Claims the card for this reply or press: the marker's path when this one made it, null when
// another made it first. A press on the pane claims its card in the same folder.
export function claim(project, id) {
  const folder = repliedDir(project);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, id);
  try {
    fs.closeSync(fs.openSync(file, 'wx'));
    return file;
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw error;
  }
}

// replyRecord({ project, text, client, now, liftStop, stopState, budget }) -> { made, says }
// Finds the code in the shown view built from the state clone, refuses it when it is unknown,
// used, out of date, held by two cards or answered with an option its card didn't offer, claims
// the card, then signs, keeps and sends what a click on that option would have earned.
export async function replyRecord({ project, text, client, now = () => new Date(), liftStop = defaultLift, stopState, budget = BUDGET_MS } = {}) {
  const reply = parseReply(text);
  if (!reply) return no('That isn\'t a reply code and an option, so nothing was recorded');
  try {
    stateDir(project);
  } catch {
    return no('That project isn\'t known here');
  }
  let views;
  try {
    views = shownNow(project, now);
  } catch {
    return no('The cards shown can\'t be read yet');
  }
  const shown = isRecord(views?.shown) ? views.shown : null;
  if (!shown) return no('The cards shown can\'t be read yet');
  const { code } = reply;
  // The views name a code two cards hold in these words, and leave it out of the shown view.
  if (Array.isArray(views.damaged) && views.damaged.includes(`a shown code held by two different questions: ${code}`)) {
    return no('That code is held by two cards, so it can\'t be used');
  }
  const card = Object.hasOwn(shown, code) && isRecord(shown[code]) ? shown[code] : null;
  if (!card || typeof card.question !== 'string' || !Array.isArray(card.options)) return no('No card has that code');
  // A shown record names its code by its one set line; anything else is not a card's code.
  const line = setLineOf(card.question);
  if (line === null || replyCode(line) !== code) return no('No card has that code');
  if (card.spent !== false || answeredInPending(project, card.question)) return no('That code has been used');
  const age = now().getTime() - Date.parse(card.at);
  if (!Number.isFinite(age) || age < 0) return no('That code\'s card can\'t be dated, so it can\'t be used');
  if (age >= REPLY_CODE_DAYS * DAY) return no(`That code has run out: a code lasts ${REPLY_CODE_DAYS} days`);

  const offered = card.options.filter((o) => typeof o === 'string' && fold(o) === fold(reply.label));
  if (offered.length !== 1) return no(`That card doesn't offer ${reply.label}`);
  const [label] = offered;
  // On an answer card the question's own options answer it; earned checks the label is one of them
  // and repeats the PUT_OFF check.
  const answers = line.startsWith('Answer question ') && !PUT_OFF.includes(label);
  if (!SIGNED_LABELS.includes(label) && !answers) return no('That option doesn\'t need a reply code');
  if (typeof card.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(card.id)) return no('No card has that code');

  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);
  let marker = null;
  let kept;
  try {
    marker = claim(project, card.id);
    if (!marker) return no('That code has been used');
    const got = await earned({ project, question: card.question, label, client: api, now, left, stopState, shownAt: card.at });
    if (!got) {
      // Nothing was recorded, so the card is let go and can be answered again.
      fs.rmSync(marker, { force: true });
      return no('That card\'s answer can\'t be recorded now');
    }
    kept = keepEarned(project, got, { now, liftStop });
    const what = recordedAs(got.made, card.question);
    const sent = await sendKept(api, left, kept);
    return { made: true, says: sent ? `Recorded: ${what}` : `Recorded: ${what} (kept until the helper takes it)` };
  } catch {
    if (kept) return { made: true, says: 'Recorded, and kept until the helper takes it' };
    if (marker) fs.rmSync(marker, { force: true });
    return no('That card\'s answer can\'t be recorded now');
  }
}
