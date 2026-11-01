// scripts/mod/press.js
// A press on a card in the pane, which the bridge hands here for the origin `pane` only. It
// records what a click on the same button of the same card would: a deciding button earns the
// signed record the click earns, through the prompt record's own code, and then the plain card
// answer; Not now and Keep as is write the card answer alone (Keep as is also hands the front
// desk one short prompt naming the card, and its answer decides the card); Explain more, Show me
// and a question card's own options write the card answer and hand the front desk one short
// prompt naming the card. Why? and Suggest a change… have their own commands, whyCard and
// suggestCard below, and a press naming either is refused.
//
// The card is found in the waiting view built from the private record, as the reply code finds its
// card, so a record the helper took a moment ago has already closed it. A press names its card
// by id and by the hash of the text the pane drew, so a card that changed since records nothing.
// Before anything is signed the card is claimed with the reply code's own marker, and with its
// shown record's marker when it has a live code, so two presses, or a press and a reply, at once
// can't both get through. A choice on a question card closes the card too, so it is claimed the
// same way, and a choice kept in pending/ while the helper is down counts as an answer. Each
// prompt names the card by its number and its id, since a choice closes its card before the
// front desk reads the prompt and the numbers move.
//
// Why? writes its card answer quietly and hands nothing on. Suggest a change… writes its card
// answer, which holds no words, and hands the front desk one prompt carrying the director's words
// folded to one line and cut at SUGGEST_CHARS; the words are never signed, kept in pending/ or
// stored, and are never read as a reply code, since only the prompt carries them. The card is
// claimed while the answer is written, and let go again, so a suggestion and a press at once
// can't both write.
//
// The signed record and the plain answer after it go to the desk together, as `answer` with the
// record as its signed evidence, and Not now as `not-now`; the desk checks the card still stands as
// the pane drew it. While the helper can't be reached (the desk answers `away`), or when the desk
// doesn't take them, they go by the prompt record's own path as before, kept in pending/ when the
// helper doesn't take them either. The other plain answers (Explain more, Show me, Keep as is, a
// question card's options, Why? and Suggest a change…) sign nothing, so no act takes them without
// evidence; they are written as a click writes them.
//
// Under STOP the helper refuses /state/write and takes /state/record. So a deciding press still
// signs and sends its record, which closes the card on its own; no card answer is written or
// kept, so Not now notes nothing, and Explain more, Show me and a question card's options still
// give their prompt, since reading and explaining carry on; so does Suggest a change…, with no
// answer written.
//
// Two presses record nothing, whatever the card offers, as a reply code records nothing for them
// (reply.js): turning on or confirming a Windows build-commands setting (Turn on (dangerous), Use
// Guarded, or Confirm on the setting's card), which only a click on its own card when the front
// desk asks it sets (design section 12.2), and an Allow on a build-command question recorded on
// another computer, which would grant nothing there. Nor does any press on a setup card, whose
// step goes ahead only by the director's click on the very card setup showed.
import fs from 'node:fs';
import path from 'node:path';
import { earned, keepEarned, sendKept, signsOn } from '../hooks/prompt-record.js';
import { keep, taken, withinBudget, pendingDir, BUDGET_MS } from '../hooks/pending.js';
import { helperGrace } from '../lib/helper-grace.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift, stopState as defaultStopState } from '../lib/stop.js';
import { KEEP_AS_IS, PUT_OFF } from '../lib/front-desk.js';
import { LEADS } from '../lib/mod-numbers.js';
import { SUGGEST, WHY, SENT_TO_FRONT_DESK, CHANGED_WHILE_READING, WRITE_FIRST, decidedToast } from '../lib/calm-words.js';
import { numberedWaiting } from '../board/model.js';
import { setLineOf, replyCode } from '../state/card-lines.js';
import { cardButtons, kindOf, isSetupCard } from './buttons.js';
import { cardTextOf, hashOf } from './status.js';
import { modDesk, signedRecords } from '../desk/mod-desk.js';
import { claim, answeredInPending, repliedDir, viewsNow, confirmsBuilds, allowsElsewhere, ALLOWED_ELSEWHERE, CLICK_ONLY_LABELS } from './reply.js';

const NOT_NOW = 'Not now';
// Longer than any option a card offers.
const LABEL_CHARS = 80;
// The most characters of the director's words a suggestion hands on.
const SUGGEST_CHARS = 500;
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
  cantLift: 'All stop couldn\'t be lifted, so nothing was recorded',
  notNoted: 'All stop is on, so that wasn\'t noted; the card stays as it was',
  lost: 'That wasn\'t noted this time, so the card stays as it was',
  buildsByClick: 'That setting is set only by a click on its own card when the First Mate asks it, so nothing was recorded',
  setupByClick: 'A setup step goes ahead only by a click on its own card when setup asks it, so nothing was recorded',
  elsewhere: ALLOWED_ELSEWHERE,
  noWords: WRITE_FIRST,
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
// than Not now, Explain more, Show me, Why? and Suggest a change….
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
  if (kind === 'blind' && !PUT_OFF.includes(label)) return `${LEADS.pane} the director picked "${label}" first on card ${n} (${id}). Run \`cards\` and ask the card it gives.`;
  return kind === 'question' && !PUT_OFF.includes(label)
    ? `${LEADS.pane} the director chose "${label}" on card ${n} (${id}).`
    : `${LEADS.pane} the director pressed ${label} on card ${n} (${id}).`;
}

// The desk's answer to an act, or null when it couldn't be asked.
async function asked(desk, command, args, evidence) {
  try {
    return await desk.act(command, args, evidence);
  } catch {
    return null;
  }
}

// pressCard({ project, card, hash, label, client, desk, now, liftStop, stopState, budget })
//   -> Promise<{ made, says, submit? }>
// `card` is the waiting card's id and `hash` what the pane drew it with. Refuses, recording
// nothing, a card that isn't waiting, one whose text changed, a label it doesn't offer, and one
// already answered in pending/ or claimed. `desk` is the mod's desk (one over `client` without it).
// Never throws.
export async function pressCard({ project, card, hash, label, client, desk, now = () => new Date(), liftStop = defaultLift, stopState = defaultStopState, budget = BUDGET_MS + helperGrace() } = {}) {
  try {
    return await press({ project, card, hash, label, client, desk, now, liftStop, stopState, budget });
  } catch {
    return no(SAYS.failed);
  }
}

async function press({ project, card, hash, label, client, desk, now, liftStop, stopState, budget }) {
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
  if (label === WHY || label === SUGGEST) return no(SAYS.notOffered);
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
  const mod = desk ?? modDesk({ project, client: api, now });

  // Not now and Keep as is sign nothing: each writes the plain card answer alone, as a click does.
  if (label !== NOT_NOW && label !== KEEP_AS_IS && button.does === 'record') {
    return signed({ project, card, hash, question, label, what, meanwhile: data.parts?.meanwhile, markers, shownAt: entry.at, api, desk: mod, left, now, liftStop, stopState });
  }

  const prompt = [promptOf(kindOf(data), label, n, card)];
  if (stopState().on) {
    if (label === NOT_NOW) return no(SAYS.notNoted);
    return { made: false, says: `All stop is on, so that wasn't noted; the First Mate has ${what}`, submit: prompt };
  }
  // A choice closes the card, so it is claimed first, and let go only when it was neither sent
  // nor kept.
  const choice = decides(data, label);
  const marker = choice ? claim(project, card) : null;
  if (choice && !marker) return no(SAYS.answered);
  // Not now goes to the desk, which needs no evidence for it; by the click's own path when the desk doesn't take it.
  const put = label === NOT_NOW && (await asked(mod, 'not-now', { card, hash }))?.ok === true ? 'sent' : null;
  const written = put ?? await writeAnswer(project, api, left, question, label, now);
  if (written === null) {
    if (marker) release([marker]);
    if (label === NOT_NOW || choice) return no(SAYS.lost);
    return { made: false, says: `That wasn't noted this time; the First Mate has ${what}`, submit: prompt };
  }
  const says = kept(`Recorded: ${what}`, written === 'sent');
  return label === NOT_NOW ? { made: true, says } : { made: true, says, submit: prompt };
}

// A deciding press: the card is claimed, then the signed record a click on it earns is kept and
// sent, and only then is the plain answer written, so a stop between the two leaves the record,
// which closes the card on its own. Under STOP the plain answer is left out.
// The card's own time goes to earned as `shownAt`, as a reply's does: the pane drew the card
// then, so a Lift STOP card from before this STOP began can't lift it.
async function signed({ project, card, hash, question, label, what, meanwhile, markers, shownAt, api, desk, left, now, liftStop, stopState }) {
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
  if (got?.refused !== undefined) {
    // A Start the goal's rules refuse: nothing is written, the card is let go, and the pane says why.
    release(held);
    return no(`The goal wasn't started: ${got.refused}`);
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
  // The record and the answer after it, through the desk; by the click's own path when the desk
  // doesn't take them (a record the helper took already is taken again as the same record).
  let sent = false;
  const decided = await asked(desk, 'answer', { card, option: label, hash }, { form: 'signed', records: signedRecords(record) });
  if (decided?.ok === true) {
    fs.rmSync(record.file, { force: true });
    sent = true;
  } else {
    try {
      sent = await sendKept(api, left, record);
    } catch {
      // Kept in pending/ for the next session start to send.
    }
    if (!stopState().on) await writeAnswer(project, api, left, question, label, now);
  }
  return { made: true, says: kept(signsOn(label, question) ? decidedToast(label, meanwhile) : `Recorded: ${what}`, sent) };
}

// The waiting card a Why? or Suggest a change… names, when the pane drew it as it is now and
// still offers `label`, else null: { card, data, question, views, events }.
function waitingCard(project, card, hash, label, now) {
  if (typeof card !== 'string' || !MARKER.test(card) || typeof hash !== 'string') return null;
  let views;
  let events;
  try {
    ({ views, events } = viewsNow(project, now));
  } catch {
    return null;
  }
  const entry = (Array.isArray(views.waiting) ? views.waiting : []).find((w) => w?.id === card);
  if (!isRecord(entry?.data)) return null;
  const { data } = entry;
  const question = cardTextOf(data);
  if (hash !== hashOf(question) || isSetupCard(data) || !cardButtons(data).buttons.some((b) => b.label === label)) return null;
  const shownId = shownIdOf(views.shown, question);
  const markers = shownId === null ? [card] : [card, shownId];
  if (answeredInPending(project, question) || decidedInPending(project, data, question) || markers.some((id) => claimed(project, id))) return null;
  return { card, data, question, views, events };
}

// whyCard({ project, card, hash, client, now, stopState, budget }) -> Promise<{ made }>
// Notes Why? on a waiting card the pane drew as it is now, quietly: the answer is written (kept
// in pending/ when the helper doesn't take it) and nothing is handed on. A card that changed, and
// STOP, note nothing. Never throws.
export async function whyCard({ project, card, hash, client, now = () => new Date(), stopState = defaultStopState, budget = BUDGET_MS + helperGrace() } = {}) {
  try {
    const found = waitingCard(project, card, hash, WHY, now);
    if (found === null || stopState().on) return { made: false };
    const api = client ?? helperClient({ timeout: budget });
    const written = await writeAnswer(project, api, withinBudget(Date.now() + budget), found.question, WHY, now);
    return { made: written !== null };
  } catch {
    return { made: false };
  }
}

// The director's words on one line, cut at SUGGEST_CHARS; '' when there are none.
const foldedWords = (words) => (typeof words === 'string' ? Array.from(words.replace(/[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim()).slice(0, SUGGEST_CHARS).join('').trim() : '');

// suggestCard({ project, card, hash, words, client, now, stopState, budget })
//   -> Promise<{ made, says, submit? }>
// Refuses empty words, and a card that changed or closed (nothing is handed on). Otherwise the
// answer labelled Suggest a change… is written (not under STOP) and the one prompt naming the
// card by its number and id, with the words, is handed back. Never throws.
export async function suggestCard({ project, card, hash, words, client, now = () => new Date(), stopState = defaultStopState, budget = BUDGET_MS + helperGrace() } = {}) {
  try {
    const text = foldedWords(words);
    if (text === '') return no(SAYS.noWords);
    const found = waitingCard(project, card, hash, SUGGEST, now);
    if (found === null) return no(CHANGED_WHILE_READING);
    const marker = claim(project, card);
    if (!marker) return no(CHANGED_WHILE_READING);
    try {
      if (!stopState().on) await writeAnswer(project, client ?? helperClient({ timeout: budget }), withinBudget(Date.now() + budget), found.question, SUGGEST, now);
    } finally {
      release([marker]);
    }
    const n = numberedWaiting(found.views, found.events).find((item) => item.card === card)?.n;
    return { made: true, says: SENT_TO_FRONT_DESK, submit: [`${LEADS.pane} the director suggested a change on card ${n} (${card}): ${text}`] };
  } catch {
    return no(SAYS.failed);
  }
}
