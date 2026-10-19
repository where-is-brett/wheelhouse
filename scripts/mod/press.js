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
// can't both get through. A choice on a question card closes the card too, so it is claimed the
// same way, and a choice kept in pending/ while the helper is down counts as an answer. Each
// prompt names the card by its number and its id, since a choice closes its card before the
// front desk reads the prompt and the numbers move.
//
// Under STOP the helper refuses /state/write and takes /state/record. So a deciding press still
// signs and sends its record, which closes the card on its own; no card answer is written or
// kept, so Not now notes nothing, and Explain more, Show me and a question card's options still
// give their prompt, since reading and explaining carry on.
//
// Two presses record nothing, whatever the card offers, as a reply code records nothing for them
// (reply.js): turning on or confirming a Windows build-commands setting (Turn on (dangerous), Use
// Guarded, or Confirm on the setting's card), which only a click on its own card when the front
// desk asks it sets (design section 12.2), and an Allow on a build-command question recorded on
// another computer, which would grant nothing there. Nor does any press on a setup card, whose
// step goes ahead only by the director's click on the very card setup showed.
import fs from 'node:fs';
import path from 'node:path';
import { earned, keepEarned, sendKept } from '../hooks/prompt-record.js';
import { keep, taken, withinBudget, pendingDir, BUDGET_MS } from '../hooks/pending.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift, stopState as defaultStopState } from '../lib/stop.js';
import { PUT_OFF } from '../lib/front-desk.js';
import { LEADS } from '../lib/mod-numbers.js';
import { numberedWaiting } from '../board/model.js';
import { setLineOf, replyCode } from '../state/card-lines.js';
import { cardButtons, kindOf, isSetupCard } from './buttons.js';
import { cardTextOf, hashOf } from './status.js';
import { claim, answeredInPending, repliedDir, viewsNow, confirmsBuilds, allowsElsewhere, ALLOWED_ELSEWHERE, CLICK_ONLY_LABELS } from './reply.js';

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
  noPrState: 'Wheelhouse couldn\'t check the pull request just now, so nothing was recorded; try again',
  failed: 'That card\'s answer can\'t be recorded now',
  cantSign: 'Wheelhouse couldn\'t sign that here, so nothing was recorded',
  cantLift: 'STOP couldn\'t be lifted, so nothing was recorded',
  notNoted: 'STOP is on, so that wasn\'t noted; the card stays as it was',
  lost: 'That wasn\'t noted this time, so the card stays as it was',
  buildsByClick: 'That setting is set only by a click on its own card when the front desk asks it, so nothing was recorded',
  setupByClick: 'A setup step goes ahead only by a click on its own card when setup asks it, so nothing was recorded',
  elsewhere: ALLOWED_ELSEWHERE,
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (says) => ({ made: false, says });
const kept = (says, sent) => (sent ? says : `${says} (kept until the helper takes it)`);

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

// Whether a label answers the card, as the waiting view decides it: one of its options, other
// than Not now, Explain more and Show me.
const decides = (data, label) => !PUT_OFF.includes(label) && (!Array.isArray(data.options) || data.options.includes(label));

// Whether a plain answer kept in pending/, not yet taken by the helper, answers the card: a
// card-answer on its question whose label decides it.
function decidedInPending(project, data, question) {
  let names;
  try {
    names = fs.readdirSync(pendingDir(project)).filter((n) => n.endsWith('.json'));
  } catch {
    return false;
  }
  return names.some((name) => {
    try {
      const { route, body } = JSON.parse(fs.readFileSync(path.join(pendingDir(project), name), 'utf8'));
      return route === 'write' && body?.kind === 'card-answer' && body.data?.question === question && decides(data, body.data?.label);
    } catch {
      return false;
    }
  });
}

// The plain card answer, as the click writes it: kept in pending/ when the helper doesn't take
// it. 'sent' when the helper took it, 'kept' when it is kept, and null when it is neither.
async function writeAnswer(project, api, left, question, label, now) {
  const body = { project, kind: 'card-answer', data: { question, label } };
  try {
    if (taken(await left(api.state.write(body)))) return 'sent';
  } catch {
    // Kept below.
  }
  try {
    keep(project, 'write', body, now);
    return 'kept';
  } catch {
    return null;
  }
}

// The one prompt a turn hands the front desk: the card's number, its id and its own label,
// nothing else.
function promptOf(kind, label, n, id) {
  return kind === 'question' && !PUT_OFF.includes(label)
    ? `${LEADS.pane} the director chose "${label}" on card ${n} (${id}).`
    : `${LEADS.pane} the director pressed ${label} on card ${n} (${id}).`;
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
  const question = cardTextOf(data);
  if (typeof hash !== 'string' || hash !== hashOf(question)) return no(SAYS.changed);
  if (typeof label !== 'string' || label === '' || label.length > LABEL_CHARS || /[\p{Cc}\p{Cf}]/u.test(label)) return no(SAYS.notOffered);
  if (CLICK_ONLY_LABELS.includes(label) || (label === 'Confirm' && confirmsBuilds(project, question))) return no(SAYS.buildsByClick);
  if (isSetupCard(data)) return no(SAYS.setupByClick);
  const button = cardButtons(data).buttons.find((b) => b.label === label);
  if (!button) return no(`That card doesn't offer ${label}`);
  const line = setLineOf(question);
  if (line?.startsWith('Answer question ') && allowsElsewhere(project, line.slice('Answer question '.length), label)) return no(SAYS.elsewhere);
  const shownId = shownIdOf(views.shown, question);
  const markers = shownId === null ? [card] : [card, shownId];
  if (answeredInPending(project, question) || decidedInPending(project, data, question) || markers.some((id) => claimed(project, id))) {
    return no(SAYS.answered);
  }

  // The number the board and the front desk give the card now.
  const n = numberedWaiting(views, events).find((item) => item.card === card)?.n;
  const what = `${label} on card ${n}`;
  const api = client ?? helperClient({ timeout: budget });
  const left = withinBudget(Date.now() + budget);

  if (label !== NOT_NOW && button.does === 'record') {
    return signed({ project, question, label, what, markers, shownAt: entry.at, api, left, now, liftStop, stopState });
  }

  const prompt = [promptOf(kindOf(data), label, n, card)];
  if (stopState().on) {
    if (label === NOT_NOW) return no(SAYS.notNoted);
    return { made: false, says: `STOP is on, so that wasn't noted; the front desk has ${what}`, submit: prompt };
  }
  // A choice closes the card, so it is claimed first, and let go only when it was neither sent
  // nor kept.
  const choice = decides(data, label);
  const marker = choice ? claim(project, card) : null;
  if (choice && !marker) return no(SAYS.answered);
  const written = await writeAnswer(project, api, left, question, label, now);
  if (written === null) {
    if (marker) release([marker]);
    if (label === NOT_NOW || choice) return no(SAYS.lost);
    return { made: false, says: `That wasn't noted this time; the front desk has ${what}`, submit: prompt };
  }
  const says = kept(`Recorded: ${what}`, written === 'sent');
  return label === NOT_NOW ? { made: true, says } : { made: true, says, submit: prompt };
}

// A deciding press: the card is claimed, then the signed record a click on it earns is kept and
// sent, and only then is the plain answer written, so a stop between the two leaves the record,
// which closes the card on its own. Under STOP the plain answer is left out.
// The card's own time goes to earned as `shownAt`, as a reply's does: the pane drew the card
// then, so a Lift STOP card from before this STOP began can't lift it.
async function signed({ project, question, label, what, markers, shownAt, api, left, now, liftStop, stopState }) {
  const held = [];
  for (const id of markers) {
    const file = claim(project, id);
    if (!file) {
      release(held);
      return no(SAYS.answered);
    }
    held.push(file);
  }
  // Whether earned asked the helper for a pull request's head and got no answer: an error, a
  // refusal or no answer in time, which earned reads as nothing earned, as it does a moved head.
  let prUnanswered = false;
  const watched = {
    ...api,
    prState: (args) => {
      prUnanswered = true;
      const asked = Promise.resolve().then(() => api.prState(args));
      asked.then((state) => { prUnanswered = state?.ok !== true; }, () => {});
      return asked;
    },
  };
  let got;
  try {
    got = await earned({ project, question, label, client: watched, now, left, stopState, shownAt });
  } catch {
    release(held);
    return no(SAYS.failed);
  }
  if (!got) {
    // Nothing was recorded, so the card is let go and can be pressed again.
    release(held);
    return no(prUnanswered ? SAYS.noPrState : SAYS.noMatch);
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
