// scripts/mod/press.js
// A press on a card in the pane, which the bridge hands here for the origin `pane` only. It
// records what a click on the same button of the same card would: a deciding button earns the
// signed record the click earns, through the prompt record's own code, and then the plain card
// answer; Not now writes the card answer alone; Explain more, Show me and a question card's own
// options write the card answer and hand the front desk one short prompt naming the card.
//
// The card is found in the waiting view built from the state clone, as the reply code finds its
// card, so a record the helper took a moment ago has already closed it. A press names its card
// by id and by the hash of the text the pane drew, so a card that changed since records nothing.
// Before anything is signed the card is claimed with the reply code's own marker, and with its
// shown record's marker when it has a live code, so two presses, or a press and a reply, at once
// can't both get through.
//
// Under STOP the helper refuses /state/write and takes /state/record. So a deciding press still
// signs and sends its record, which closes the card on its own; no card answer is written or
// kept, so Not now notes nothing, and Explain more, Show me and a question card's options still
// give their prompt, since reading and explaining carry on.
import fs from 'node:fs';
import path from 'node:path';
import { earned, keepEarned, sendKept } from '../hooks/prompt-record.js';
import { keep, taken, withinBudget, BUDGET_MS } from '../hooks/pending.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift, stopState as defaultStopState } from '../lib/stop.js';
import { stateDir } from '../lib/paths.js';
import { PUT_OFF } from '../lib/front-desk.js';
import { LEADS } from '../lib/mod-numbers.js';
import { numberedWaiting } from '../board/model.js';
import { listEvents } from '../state/events.js';
import { buildViews } from '../state/views.js';
import { readEnrolled } from '../state/signing.js';
import { setLineOf, replyCode } from '../state/card-lines.js';
import { cardButtons, kindOf } from './buttons.js';
import { hashOf } from './status.js';
import { claim, answeredInPending, repliedDir } from './reply.js';

const NOT_NOW = 'Not now';
// Longer than any option a card offers.
const LABEL_CHARS = 80;
// An event id, as a marker's file name.
const MARKER = /^[A-Za-z0-9-]{1,64}$/;

export const SAYS = {
  answered: 'That card has already been answered',
  changed: 'That card changed: look at it again',
  notOffered: 'That card doesn\'t offer that',
  unread: 'The cards can\'t be read yet',
  noMatch: 'That couldn\'t be recorded: the card no longer matches what it decides',
  failed: 'That card\'s answer can\'t be recorded now',
  cantSign: 'Wheelhouse couldn\'t sign that here, so nothing was recorded',
  cantLift: 'STOP couldn\'t be lifted, so nothing was recorded',
  notNoted: 'STOP is on, so that wasn\'t noted; the card stays as it was',
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (says) => ({ made: false, says });
const kept = (says, sent) => (sent ? says : `${says} (kept until the helper takes it)`);

// The views and the events, built from the state clone as writeViews builds them.
function viewsNow(project, now) {
  const damaged = [];
  const events = listEvents(stateDir(project), { report: () => {}, skipped: damaged });
  return { views: buildViews(events, readEnrolled(), { damaged, now }), events };
}

// The id of the live shown record that holds the card's reply code, or null when it has none.
function shownIdOf(shown, question) {
  const line = setLineOf(question);
  if (line === null || !isRecord(shown)) return null;
  const code = replyCode(line);
  const held = Object.hasOwn(shown, code) && isRecord(shown[code]) ? shown[code] : null;
  return held?.question === question && held.spent === false && typeof held.id === 'string' && MARKER.test(held.id) ? held.id : null;
}

const claimed = (project, id) => fs.existsSync(path.join(repliedDir(project), id));
const release = (files) => {
  for (const file of files) fs.rmSync(file, { force: true });
};

// The plain card answer, as the click writes it: kept in pending/ when the helper doesn't take
// it. True when the helper took it.
async function writeAnswer(project, api, left, question, label, now) {
  const body = { project, kind: 'card-answer', data: { question, label } };
  try {
    if (taken(await left(api.state.write(body)))) return true;
  } catch {
    // Kept below.
  }
  try {
    keep(project, 'write', body, now);
  } catch {
    // Not kept twice: a failure here is a failure to write the file too.
  }
  return false;
}

// The one prompt a turn hands the front desk: the card's number and its own label, nothing else.
function promptOf(kind, label, n) {
  return kind === 'question' && !PUT_OFF.includes(label)
    ? `${LEADS.pane} the director chose "${label}" on card ${n}.`
    : `${LEADS.pane} the director pressed ${label} on card ${n}.`;
}

// pressCard({ project, card, hash, label, client, now, liftStop, stopState, budget })
//   -> Promise<{ made, says, submit? }>
// `card` is the waiting card's id and `hash` what the pane drew it with. Refuses, recording
// nothing, a card that isn't waiting, one whose text changed, a label it doesn't offer, and one
// already answered in pending/ or claimed. Never throws.
export async function pressCard({ project, card, hash, label, client, now = () => new Date(), liftStop = defaultLift, stopState = defaultStopState, budget = BUDGET_MS } = {}) {
  try {
    return await press({ project, card, hash, label, client, now, liftStop, stopState, budget });
  } catch {
    return no(SAYS.failed);
  }
}

async function press({ project, card, hash, label, client, now, liftStop, stopState, budget }) {
  if (typeof card !== 'string' || !MARKER.test(card)) return no(SAYS.answered);
  let views;
  let events;
  try {
    ({ views, events } = viewsNow(project, now));
  } catch {
    return no(SAYS.unread);
  }
  const entry = (Array.isArray(views.waiting) ? views.waiting : []).find((w) => w?.id === card);
  if (!isRecord(entry?.data)) return no(SAYS.answered);
  const { data } = entry;
  // The text the pane drew: the question, or the title of a card that has none.
  const question = typeof data.question === 'string' ? data.question : typeof data.title === 'string' ? data.title : '';
  if (typeof hash !== 'string' || hash !== hashOf(question)) return no(SAYS.changed);
  if (typeof label !== 'string' || label === '' || label.length > LABEL_CHARS || /[\p{Cc}\p{Cf}]/u.test(label)) return no(SAYS.notOffered);
  const button = cardButtons(data).buttons.find((b) => b.label === label);
  if (!button) return no(`That card doesn't offer ${label}`);
  const shownId = shownIdOf(views.shown, question);
  const markers = shownId === null ? [card] : [card, shownId];
  if (answeredInPending(project, question) || markers.some((id) => claimed(project, id))) return no(SAYS.answered);

  // The number the board and the front desk give the card now.
  const n = numberedWaiting(views, events).find((item) => item.card === card)?.n;
  const what = `${label} on card ${n}`;
  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);

  if (label !== NOT_NOW && button.does === 'record') return signed({ project, question, label, what, markers, api, left, now, liftStop, stopState });

  if (stopState().on) {
    if (label === NOT_NOW) return no(SAYS.notNoted);
    return { made: false, says: `STOP is on, so that wasn't noted; the front desk has ${what}`, submit: [promptOf(kindOf(data), label, n)] };
  }
  const sent = await writeAnswer(project, api, left, question, label, now);
  const says = kept(`Recorded: ${what}`, sent);
  return label === NOT_NOW ? { made: true, says } : { made: true, says, submit: [promptOf(kindOf(data), label, n)] };
}

// A deciding press: the card is claimed, then the signed record a click on it earns is kept and
// sent, and only then is the plain answer written, so a stop between the two leaves the record,
// which closes the card on its own. Under STOP the plain answer is left out.
async function signed({ project, question, label, what, markers, api, left, now, liftStop, stopState }) {
  const held = [];
  for (const id of markers) {
    const file = claim(project, id);
    if (!file) {
      release(held);
      return no(SAYS.answered);
    }
    held.push(file);
  }
  let got;
  try {
    got = await earned({ project, question, label, client: api, now, left, stopState });
  } catch {
    release(held);
    return no(SAYS.failed);
  }
  if (!got) {
    // Nothing was recorded, so the card is let go and can be pressed again.
    release(held);
    return no(SAYS.noMatch);
  }
  let lifting = false;
  let record;
  try {
    record = keepEarned(project, got, { now, liftStop: () => { lifting = true; liftStop(); } });
  } catch {
    release(held);
    return no(lifting ? SAYS.cantLift : SAYS.cantSign);
  }
  let sent = false;
  try {
    sent = await sendKept(api, left, record);
  } catch {
    // Kept in pending/ for the next session start to send.
  }
  if (!stopState().on) await writeAnswer(project, api, left, question, label, now);
  return { made: true, says: kept(`Recorded: ${what}`, sent) };
}
