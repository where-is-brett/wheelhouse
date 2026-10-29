// scripts/hooks/prompt-record.js
// Turns the director's clicks on a card into records. Every answer is kept as a
// plain card-answer. A click on one of the card's own buttons, on a card that
// holds the exact line, also becomes a signed approval, confirmation or action.
// Only this hook signs. Each signed record is written to
// projects/<project>/pending/ before it is sent and removed once the helper has
// it, so a hook cut short by its time limit loses nothing; the next session
// start sends what is left. A confirmation of a setting in the director's
// profile goes to the profile; the answer itself still goes to the project.
// A card carrying one set line and its reply code also gets a signed shown record,
// so a later reply with that code (scripts/mod/reply.js) can count as the click.
// A Go ahead on a setup card becomes a signed setup action kept in
// <wheelhouseHome()>/setup/clicks/, where the helper reads it, since there may be no state to
// record it in yet (Task 13 copies the clicks into the state). An answer to a question a setup
// step asked becomes a signed setup-answer kept in setup/answers/ the same way. In a folder being
// set up (no project record yet: kit.js's beingSetUp) those are the only clicks recorded, and
// nothing else is. A setup card has no reply code, so it gets no shown record.
// An answer on a setup card that said it records something in the project's state (steps 4 and
// 5: the product's glossary entry and phase, the rules found; rulings R35, R59) earns those records
// first, signed and kept pending as every signed record is (scripts/lib/setup-writes.js), and is
// kept as a setup-answer only once they are, so a step never settles on an answer whose records
// were not made; in a folder with no project record yet (the one card, asked before step 3), those
// records are kept in setup's own folder, which the helper sends to the state once it exists. A typed answer the engine won't take (rulings R125, R132) is kept, in any folder, but
// records and claims nothing (ruling R137), judged by the engine's own rule (scripts/lib/setup-clicks.js).
// The baseline card reads the private note's figures back (scripts/measures/baseline.js): in any
// folder, a Record these on it becomes a signed baseline action kept in
// <wheelhouseHome()>/measures/clicks/, naming only the hash of the figures, and a Not now on it
// clears the figures waiting. Nothing of that card, not even its plain answer, goes to a project.
// A trust card (rulings R80, R81, retired with the records kept on this computer) is no longer handed
// out, and a click on one trusts nothing. An answer to one asked before still stays on this computer:
// nothing of it, not even its plain answer, goes to a project, and it has no reply code.
// Uninstall's card asks to remove Wheelhouse from a project (ruling R90): in any folder, a Remove it on
// it becomes a signed uninstall action kept in setup/clicks/, as a setup click is, naming the project
// and the full hash of the list, only on the very card the helper composed and recorded as shown for
// a folder holding this session's folder, word for word. It has no reply code. Its plain answer goes
// to a project as any card's does.
// A usage card offers a Thoroughness switch (design section 14.6): the click on its switch option is the setting
// change and the director's confirmation of it at once (the director, 25 October 2026). On the card the session
// start offered, whose line names an offer the state holds, it earns the setting, made here, and its signed
// confirmation, which carries it, as a Confirm click on the setting's confirm card would confirm it. Its other
// option earns nothing. It has no reply code.
// The premium model's card offers its separate opt-in (design section 14.6): on the card the helper offered, whose line
// names a signed offer the state holds, a click on one of its Allow options earns the premium setting that option names,
// made here, and its signed confirmation, in the same way. Not now and its other buttons earn nothing. No reply code.
import fs from 'node:fs';
import path from 'node:path';
import tools from '../../adapters/claude-code/tools.js';
import { runAndExit, projectOf, beingSetUp } from './kit.js';
import { keep, taken, sendPending, withinBudget, pendingDir, BUDGET_MS } from './pending.js';
import { helperGrace } from '../lib/helper-grace.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift, stopState as defaultStopState } from '../lib/stop.js';
import { profileDir, stateDir, computerId } from '../lib/paths.js';
import { readEnrolled, verify } from '../state/signing.js';
import { makeEvent, listEvents, confirmationFor, dataHash, CONFIRMABLE_KINDS } from '../state/events.js';
import { scanContent } from '../state/secret-scan.js';
import {
  approvalLine, confirmLine, LIFT_STOP_LINES, isLiftStopLine, runbookLine, RUNBOOK_TITLES, ciPushLine,
  approveWorkLine, answerLine, amendLine, liftIncidentLine, incidentFixLine, unattendedBuildsLine, ID, LANES, QUESTION_ID,
} from '../state/card-lines.js';
import {
  chatCopy, setLineOf, setLinesOf, replyCode, replyCodeLine, setupLine, SETUP_LABEL, SETUP_TITLES, BASELINE_LABEL, BASELINE_WORDS, baselineLine,
  TRUST_LINE, TAKEOVER_LABEL, TAKEOVER_LINE, UNINSTALL_LABEL, UNINSTALL_LINE, uninstallLine, KEEP_CONTROL_LINE, keepControlLine, USAGE_LINE, PREMIUM_LINE,
} from '../state/card-lines.js';
import {
  keepClick, shownHash, keepAnswer, askedFor, claimAnswer, releaseAnswer, keepUninstallClick, shownUninstall, typedVerdict, typedBefore, keepSetupRecords,
} from '../lib/setup-clicks.js';
import { setupRecordsOf } from '../lib/setup-writes.js';
import { settingWords } from '../settings/effective.js';
import { switchLabelOf } from '../routing/nudge.js';
import { ALWAYS_READY, columnsReadyOf } from '../routing/in-force.js';
import { offeredFrom, premiumValueOf, PREMIUM_CARD_MS } from '../routing/premium.js';
import { keepClick as keepBaselineClick, shownBaseline, dropPending, carriesFigures, cardText, sweepStale, cardHash } from '../lib/measures-clicks.js';
import { localViews } from './session-start.js';
import { REPLY_CODE_DAYS } from '../lib/core-numbers.js';
import { PUT_OFF } from '../lib/front-desk.js';
import { settingKey, UNATTENDED_CARD, USE_GUARDED } from '../protection/windows-builds.js';
import { startedAsScript } from '../lib/started-as-script.js';

const DAY = 24 * 60 * 60 * 1000;
const SHA12 = '([0-9a-f]{12})(?![0-9a-fA-F])';
const APPROVE = new RegExp(`Approve pull request #([1-9][0-9]*) at commit ${SHA12}`, 'g');
const APPROVE_WORK = new RegExp(`Approve (${ID}) \\((${LANES}) lane\\) as written, ${SHA12}(, and show it to me before it merges)?`, 'g');
const ANSWER = new RegExp(`Answer question (${QUESTION_ID})(?![a-z0-9-])`, 'g');
const AMEND = new RegExp(`Change the approved (${ID}) to this, ${SHA12}`, 'g');
const LIFT_INCIDENT = new RegExp(`End incident (${ID}) and let merges carry on`, 'g');
const INCIDENT_FIX = new RegExp(`Merge pull request #([1-9][0-9]*) as the fix for incident (${ID})(?![a-z0-9-])`, 'g');
const SETUP = new RegExp(`Set up step ([0-9]{1,2}) as listed, ${SHA12}`, 'g');
const SETUP_LINE = new RegExp(`^${SETUP.source}$`);
const CONFIRM_ALL_LINE = /^Confirm all [1-9][0-9]* rules? as listed, [0-9a-f]{12}$/;
const CI_PUSH = new RegExp(`Push the CI change on (\\S+) at commit ${SHA12} with your own sign-in`, 'g');
const BASELINE_TEXT = BASELINE_WORDS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BASELINE = new RegExp(`${BASELINE_TEXT}, ${SHA12}`, 'g');

// Whether a card reads as the baseline card (any of its fixed words however written, or its header
// with the figures) or holds the figures waiting for the click, anywhere it shows them (its question,
// header, options' labels and descriptions) or in `more` (the label chosen or typed): the private
// note's figures never go to a project's state, however the card was reworded.
const carriesBaseline = (card, now, ...more) => carriesFigures(cardText(card, ...more), card?.header, { now });

function ciEntry(project, branch, sha12, now) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(stateDir(project), '..', 'ci-pending.json'), 'utf8'));
    const entry = Object.hasOwn(all, branch) ? all[branch] : null;
    if (!entry || entry.branch !== branch || typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) return null;
    if (!entry.sha.startsWith(sha12)) return null;
    const age = now().getTime() - Date.parse(entry.at);
    return age >= 0 && age < DAY ? entry : null;
  } catch {
    return null;
  }
}

// The one runbook line a question holds, or null when it holds none, more than
// one, or one whose commit does not read as twelve lowercase hex characters.
function runbookOf(question) {
  if ((question.match(/Runbook step \d/g) ?? []).length !== 1) return null;
  for (const step of Object.keys(RUNBOOK_TITLES).map(Number)) {
    const base = runbookLine(step);
    const at = question.indexOf(base);
    if (at < 0) continue;
    if (question.indexOf(base, at + 1) >= 0) return null;
    const rest = question.slice(at + base.length);
    let sha;
    if (rest.startsWith(', to commit')) {
      const tail = new RegExp(`^, to commit ${SHA12}`).exec(rest);
      if (!tail) return null;
      sha = tail[1];
    }
    if (step === 3 && sha === undefined) return null;
    return { step, sha };
  }
  return null;
}

// The only match of a global pattern, or null when there are none or several.
function only(pattern, text) {
  const all = [...text.matchAll(pattern)];
  return all.length === 1 ? all[0] : null;
}

// The deciding labels a reply code can answer with. A reply to an answer card may also use any
// of the question's own options (scripts/mod/reply.js), which earned checks against the question.
// Turn on (dangerous) and Use Guarded earn a record from a click alone, by design.
export const SIGNED_LABELS = ['Approve', 'Confirm', 'Lift All stop', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix'];

// The events of one kind that the state holds, oldest first.
function held(project, kind) {
  return listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === kind);
}

// The record a click on an answer card earns: the question must be one the state
// holds and the label one of its options.
function answerOf(project, question, label) {
  if (PUT_OFF.includes(label)) return null;
  const m = only(ANSWER, question);
  if (!m || !question.includes(answerLine(m[1]))) return null;
  const asked = held(project, 'question').filter((e) => e.data?.id === m[1]).at(-1);
  const options = Array.isArray(asked?.data?.options) ? asked.data.options : [];
  return options.some((o) => o?.label === label) ? { action: 'answer', questionId: m[1], questionHash: dataHash(asked.data) } : null;
}

// The record a click on a work card earns: the card's lane and hash must be the latest work event's.
function approveWorkOf(project, question, match) {
  const [, work, lane, h12, shown] = match;
  const shownFirst = shown !== undefined;
  if (!question.includes(approveWorkLine(work, lane, h12, { shownFirst }))) return null;
  const latest = held(project, 'work').filter((e) => e.data?.id === work).at(-1);
  const hash = latest?.data?.doc?.hash;
  if (latest?.data?.lane !== lane || typeof hash !== 'string' || !hash.startsWith(h12)) return null;
  return { action: 'approve-work', work, lane, hash, shownFirst };
}

// The one full hash of a proposed change that the card's twelve characters name, or null.
function amendmentHash(project, work, h12) {
  const all = new Set(held(project, 'amendment')
    .filter((e) => e.data?.work === work && typeof e.data?.hash === 'string' && e.data.hash.startsWith(h12))
    .map((e) => e.data.hash));
  return all.size === 1 ? [...all][0] : null;
}

const declared = (project, id) => held(project, 'incident').some((e) => e.data?.id === id);

// The record a Confirm on a card keeping a feature's files that steer agents earns (ruling P7-31):
// the card carries that one set line, and the state holds one finding of the watcher's for that
// work (signed by an enrolled computer, ruling P7-33) whose full hash the line's twelve characters name. The record names the work and that hash,
// which the watcher matches against what it finds before it keeps the files as they are.
function keepControlOf(project, question) {
  const lines = setLinesOf(question);
  if (lines.length !== 1) return null;
  const m = KEEP_CONTROL_LINE.exec(lines[0]);
  if (!m || lines[0] !== keepControlLine(m[1], m[2])) return null;
  const enrolled = readEnrolled();
  const hashes = new Set(held(project, 'control-file')
    .filter((e) => e.data?.work === m[1] && typeof e.data?.hash === 'string' && e.data.hash.startsWith(m[2]) && verify(e, enrolled))
    .map((e) => e.data.hash));
  return hashes.size === 1 ? { action: 'keep-control-files', work: m[1], hash: [...hashes][0] } : null;
}

// How long a return card's switch counts after it is offered, a designer's call (design section 14.6 says only that
// it is offered at the first front-desk turn after the reset): a week, the allowance week it opens. A card that
// switches down or up counts until the reset its offer names.
const RETURN_DAYS = 7;

// The settings kept in pending/ with their confirmations, still to be sent: a usage card's switch taken there is taken.
function pendingSettings(project) {
  let names = [];
  try {
    names = fs.readdirSync(pendingDir(project)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const { route, body } = JSON.parse(fs.readFileSync(path.join(pendingDir(project), name), 'utf8'));
      return route === 'record' && body?.target?.kind === 'setting' ? [body.target] : [];
    } catch {
      return [];
    }
  });
}

// The records a click on a usage card's switch earns (design section 14.6; the director, 25 October 2026): the card
// carries one set line, a usage card's, naming the level and the time of an offer the state holds, signed by this
// computer's own enrolled key (the session start's); the card is the very card that offer names by its hash (text,
// header and options), so a card reworded, the Lightest card's safety cost left out, earns nothing; the label is that
// offer's switch option; the offer's week isn't over; the level is ready (`ready`, the columns ready beyond Balanced
// and Thorough, as the settings pane's press holds it); and no setting in the state, or waiting in pending/, came from
// that offer yet. The
// setting is made here, with the offer's time, and goes with its confirmation, as setup's confirmed records do, so it
// is in force once the helper takes them. Null for anything else, the stay option among them.
function usageOf(project, question, label, shown, now, ready) {
  const lines = setLinesOf(question);
  const m = lines.length === 1 ? USAGE_LINE.exec(lines[0]) : null;
  if (!m) return null;
  const [, to, at] = m;
  const hash = cardHash(shown);
  if (hash === null || shown.question !== question) return null;
  const enrolled = readEnrolled();
  const own = computerId();
  const offers = new Set(held(project, 'usage-card')
    .filter((e) => e.data?.at === at && e.data?.to === to && e.data?.hash === hash && e.computer === own && e.sig?.computer === own && verify(e, enrolled))
    .map((e) => `${e.data.card} ${e.data.reset}`));
  if (offers.size !== 1) return null;
  const [card, reset] = [...offers][0].split(' ');
  if (label !== switchLabelOf(card, to)) return null;
  const until = card === 'return' ? Date.parse(at) + RETURN_DAYS * DAY : Date.parse(reset);
  if (!(now().getTime() < until)) return null;
  if (!ALWAYS_READY.includes(to) && !ready({ project }).includes(to)) return null;
  if ([...held(project, 'setting'), ...pendingSettings(project)].some((e) => e.data?.usageCard === at)) return null;
  const target = makeEvent({ kind: 'setting', data: { key: 'efficiency', value: to, usageCard: at, words: settingWords('efficiency', to) }, now });
  return { made: confirmationFor(target), target };
}

// The records a click on the premium model's card earns (design section 14.6; the director's rulings of 24 October
// 2026): the card carries one set line, the premium card's, naming the time of an offer the state holds, signed by this
// computer's own enrolled key (the helper's); the card is the very card that offer names by its hash, so a card
// reworded, its cost left out, earns nothing; the label is one of that offer's Allow options, which says the setting
// (within the plan, or paid credits too: a Yes of its own, never read from the other); the offer is under a day old;
// the premium setting in force is still the one the offer was made from (`current`, from the views); and no setting in
// the state, or waiting in pending/, came from that offer yet. The setting is made here, naming the offer, and goes
// with its confirmation. Null for anything else, Not now among them.
function premiumClickOf(project, question, label, shown, now, current) {
  const lines = setLinesOf(question);
  const m = lines.length === 1 ? PREMIUM_LINE.exec(lines[0]) : null;
  if (!m) return null;
  const at = m[1];
  const hash = cardHash(shown);
  if (hash === null || shown.question !== question) return null;
  const enrolled = readEnrolled();
  const own = computerId();
  const offers = new Set(held(project, 'premium-card')
    .filter((e) => e.data?.at === at && e.data?.hash === hash && e.computer === own && e.sig?.computer === own && verify(e, enrolled))
    .map((e) => e.data.from));
  if (offers.size !== 1) return null;
  const [from] = [...offers];
  const value = premiumValueOf(from, label);
  if (value === null) return null;
  const age = now().getTime() - Date.parse(at);
  if (!(age >= 0 && age < PREMIUM_CARD_MS)) return null;
  // `current` is the setting the card must be offered from now, and, once a Yes's evaluation failed, the time of that
  // failure, which an offer must come after: a card offered before it stands for the Yes that failed.
  const standing = current({ project });
  const { from: wanted, after = null } = typeof standing === 'string' || standing === null ? { from: standing } : standing;
  if (wanted !== from) return null;
  if (typeof after === 'string' && !(at > after)) return null;
  if ([...held(project, 'setting'), ...pendingSettings(project)].some((e) => e.data?.premiumCard === at)) return null;
  const target = makeEvent({ kind: 'setting', data: { key: 'premium', value, premiumCard: at, words: settingWords('premium', value) }, now });
  return { made: confirmationFor(target), target };
}

// The record a click on the take-over card earns (design section 9, "One computer at a time"): the card carries one set
// line, the take-over card's, naming the computer that holds the lock and its counter, and is the card as it was
// asked; the label is Take over here. The record is the director's click; the helper acts on it only while the lock
// still stands as the card named it. Null for anything else, Leave it there among them. `takeOver` tells the caller
// to ask the helper to take the lock once the record is in.
function takeOverOf(question, label, shown) {
  if (label !== TAKEOVER_LABEL || shown?.question !== question) return null;
  const lines = setLinesOf(question);
  const m = lines.length === 1 ? TAKEOVER_LINE.exec(lines[0]) : null;
  if (!m) return null;
  return { made: { kind: 'action', data: { action: 'take-over', holder: m[1], counter: Number(m[2]), question: lines[0], label } }, takeOver: true };
}

// The setting a premium card for `project` is offered from now, as the last sync's views hold it (a Yes whose
// evaluation failed counts as off), or null when they can't be read.
function premiumNow({ project }) {
  const view = localViews(project, ['premium'])?.premium;
  if (typeof view?.value !== 'string') return null;
  return { from: offeredFrom(view), after: typeof view.failed?.at === 'string' ? view.failed.at : null };
}

// Works out the signed record a click earns, if any. May ask the helper for a
// pull request's head. Returns { made, profile?, lift? }, or null. A Lift STOP earns nothing
// while STOP is off, so an old card's click or reply code can't stand for a later STOP. A reply
// passes `shownAt`, when its card was shown: its Lift STOP earns a record only when the card was
// shown after this STOP began, so a code from a card about an earlier STOP can't lift a later one. A usage card's
// switch gives `target` too, the setting its confirmation carries.
export async function earned({ project, question, label, card, client, now, left, stopState = defaultStopState, shownAt, ready = columnsReadyOf, premiumIn = premiumNow }) {
  const action = (data) => ({ made: { kind: 'action', data: { ...data, question, label } } });
  // A card with an answer line is a question card: its buttons are answers, whatever else it says.
  if (question.includes('Answer question q-')) {
    const answer = answerOf(project, question, label);
    return answer ? action(answer) : null;
  }
  // `card` is the question as AskUserQuestion was given it; a reply or a pane press has none, so earns nothing here.
  if (setLinesOf(question).some((line) => USAGE_LINE.test(line))) return usageOf(project, question, label, card, now, ready);
  if (setLinesOf(question).some((line) => PREMIUM_LINE.test(line))) return premiumClickOf(project, question, label, card, now, premiumIn);
  if (setLinesOf(question).some((line) => TAKEOVER_LINE.test(line))) return takeOverOf(question, label, card);
  if (label === 'Approve') {
    const prs = [...question.matchAll(APPROVE)];
    const works = [...question.matchAll(APPROVE_WORK)];
    if (prs.length + works.length !== 1) return null;
    if (works.length === 1) {
      const record = approveWorkOf(project, question, works[0]);
      return record ? action(record) : null;
    }
    const m = prs[0];
    if (!question.includes(approvalLine(m[1], m[2]))) return null;
    const pr = Number(m[1]);
    const state = await left(client.prState({ project, number: pr }));
    const head = state?.result?.headSha;
    if (state?.ok === true && state.result?.state === 'open' && /^[0-9a-f]{40}$/.test(head ?? '') && head.startsWith(m[2])) {
      return { made: { kind: 'approval', data: { pr, commit: head, words: 'Approve', question } } };
    }
    return null;
  }
  if (label === 'Confirm' && setLinesOf(question).some((line) => KEEP_CONTROL_LINE.test(line))) {
    const kept = keepControlOf(project, question);
    return kept ? action(kept) : null;
  }
  if (label === 'Confirm') {
    // A line may name an event in the project's state or in the director's profile; one
    // that names events in both, or several, records nothing.
    const named = (dir) => listEvents(dir, { report: () => {} })
      .filter((e) => CONFIRMABLE_KINDS.includes(e.kind) && question.includes(confirmLine(e)));
    const found = named(stateDir(project));
    const inProfile = named(profileDir());
    if (found.length + inProfile.length !== 1) return null;
    return found.length === 1 ? { made: confirmationFor(found[0]) } : { made: confirmationFor(inProfile[0]), profile: true };
  }
  if (label === 'Turn on (dangerous)') {
    // The Unattended card for build commands on Windows: it says the design's words on the risk,
    // its line names one setting event, written on this computer for this computer, and the
    // confirmation carries the line, so the level counts Unattended from this card alone.
    if (!question.includes(UNATTENDED_CARD().risk)) return null;
    const computer = computerId();
    const found = held(project, 'setting').filter((e) => e.computer === computer && e.data?.key === settingKey(computer)
      && e.data?.value === 'unattended' && question.includes(unattendedBuildsLine(e.id, computer)));
    if (found.length !== 1) return null;
    const { kind, data } = confirmationFor(found[0]);
    return { made: { kind, data: { ...data, line: unattendedBuildsLine(found[0].id, computer) } } };
  }
  if (label === USE_GUARDED) {
    // Use Guarded on the Unattended card (ruling 22): the card carries exactly one confirm line,
    // for a setting event proposing Guarded, written on this computer for this computer, and the
    // click confirms that event as Confirm would, with no line, so the level counts Guarded (once
    // this computer's self-test passes).
    const confirms = setLinesOf(question).filter((line) => line.startsWith('Confirm '));
    if (confirms.length !== 1) return null;
    const computer = computerId();
    const found = held(project, 'setting').filter((e) => e.computer === computer && e.data?.key === settingKey(computer)
      && e.data?.value === 'guarded' && confirmLine(e) === confirms[0]);
    return found.length === 1 ? { made: confirmationFor(found[0]) } : null;
  }
  // Lift All stop, or Lift STOP on a card made before the switch was called All stop, which carries the earlier line.
  if (label === 'Lift All stop' || label === 'Lift STOP') {
    const stop = stopState();
    if (!LIFT_STOP_LINES.some((line) => question.includes(line)) || !stop.on) return null;
    if (shownAt !== undefined && !(Date.parse(shownAt) > Date.parse(stop.at))) return null;
    return { ...action({ action: 'lift-stop' }), lift: true };
  }
  if (label === 'Do it') {
    const found = runbookOf(question);
    return found ? action({ action: 'runbook', step: found.step, ...(found.sha ? { sha: found.sha } : {}) }) : null;
  }
  if (label === 'Push it') {
    const m = only(CI_PUSH, question);
    if (!m || !question.includes(ciPushLine(m[1], m[2]))) return null;
    const entry = ciEntry(project, m[1], m[2], now);
    return entry ? action({ action: 'ci-push', branch: entry.branch, sha: entry.sha }) : null;
  }
  if (label === 'Change it') {
    const m = only(AMEND, question);
    if (!m || !question.includes(amendLine(m[1], m[2]))) return null;
    const hash = amendmentHash(project, m[1], m[2]);
    return hash ? action({ action: 'amend', work: m[1], hash }) : null;
  }
  if (label === 'End it') {
    const m = only(LIFT_INCIDENT, question);
    if (!m || !question.includes(liftIncidentLine(m[1])) || !declared(project, m[1])) return null;
    return action({ action: 'lift-incident', incident: m[1] });
  }
  if (label === 'Merge the fix') {
    const m = only(INCIDENT_FIX, question);
    if (!m || !question.includes(incidentFixLine(m[2], m[1])) || !declared(project, m[2])) return null;
    return action({ action: 'incident-fix', incident: m[2], pr: Number(m[1]) });
  }
  return null;
}

// The signed record a Go ahead on a setup card earns: the card carries one set line, setup's, and
// is the very card the helper composed for the list its twelve characters name, for the folder
// this session is in, word for word (its text, header and options), so a card reworded around the
// right set line earns nothing.
// The record names the run the card was shown for and that list's full hash, which the helper
// matches against its run for the folder and the list it works out again.
function setupClickOf(cwd, { question, label, card }) {
  if (label !== SETUP_LABEL) return null;
  const m = only(SETUP, question);
  if (!m) return null;
  const step = Number(m[1]);
  if (!Object.hasOwn(SETUP_TITLES, step) || setLineOf(question) !== setupLine(step, m[2])) return null;
  const shown = shownHash({ cwd, step, h12: m[2], card });
  return shown === null ? null : { kind: 'action', data: { action: 'setup', runId: shown.runId, step, hash: shown.hash, question, label } };
}

// The signed record an answer to a setup step's question earns (ruling R30): the card is exactly
// one setup asked, for a folder holding this session's folder, and the answer is one of its own
// options, never Explain more or Not now, or, on a card that takes one, typed text in which no
// secret is found. The record names the run and step the question was asked for, and its id.
// Gives { made, asked }: the record to sign and the asked record it answers.
function setupAnswerOf(cwd, { question, label, card, signable, typed }) {
  if (PUT_OFF.includes(label) || !(signable || typed)) return null;
  const asked = askedFor({ cwd, card });
  if (asked === null || asked.card.question !== question) return null;
  const data = { action: 'setup-answer', runId: asked.runId, step: asked.step, questionId: asked.id, question };
  if (signable) return { asked, made: { kind: 'action', data: { ...data, label, text: null } } };
  if (asked.typed !== true || label.trim() === '' || scanContent(label).length > 0) return null;
  return { asked, made: { kind: 'action', data: { ...data, label: null, text: label } } };
}

// Signs each setup click and answer and keeps it in setup/clicks/ or setup/answers/. One failing
// does not stop the rest. An answer that records something in the project's state has those
// records kept pending in `project` first; they are given back, as keepEarned gives them, to be
// sent. With no project, such an answer is not kept.
function keepSetupClicks(cwd, out, now, project = null) {
  const queued = [];
  for (const click of out) {
    try {
      const made = click.signable ? setupClickOf(cwd, click) : null;
      if (made) {
        keepClick(makeEvent({ ...made, now }));
        continue;
      }
      const answer = setupAnswerOf(cwd, click);
      if (!answer) continue;
      // A typed answer the engine won't take (the choice handed back, or a first question on its
      // question) is kept as given, so the card is asked again saying why, but it records nothing
      // and claims nothing: the answer that follows, typed or clicked, is the one (ruling R137).
      const { runId, step, questionId, question, label, text } = answer.made.data;
      if (label === null && typedVerdict(text, typedBefore({ runId, step, questionId, question })) !== null) {
        keepAnswer(makeEvent({ ...answer.made, now }));
        continue;
      }
      const records = setupRecordsOf(answer.asked, answer.made.data, { now });
      if (records.length === 0) {
        keepAnswer(makeEvent({ ...answer.made, now }));
        continue;
      }
      // An answer that records something is taken once, and its records are kept only with it: a
      // second click on the same card records nothing, and records whose answer could not be kept
      // are taken back, so the question asked again can't record them twice.
      const claim = claimAnswer(answer.made.data);
      if (claim === null) continue;
      const kept = [];
      try {
        // In a folder with no project yet (the one card, asked before step 3: design section 15.1),
        // the records are kept in setup's own folder, and the helper sends them once the state exists.
        if (project === null) kept.push(...keepSetupRecords(answer.made.data.runId, records, now).map((file) => ({ file, later: true })));
        else {
          for (const { route, body } of records) {
            const full = { project, ...body };
            kept.push({ file: keep(project, route, full, now), body: full, route });
          }
        }
        keepAnswer(makeEvent({ ...answer.made, now }));
      } catch (error) {
        for (const { file } of kept) fs.rmSync(file, { force: true });
        releaseAnswer(claim);
        throw error;
      }
      queued.push(...kept.filter((k) => !k.later));
    } catch (e) { if (process.env.SETUP_E2E_DEBUG) process.stderr.write(`KEEP ${e.stack}\n`); /* not kept: the helper then refuses the step for want of a click, or asks the question again */ }
  }
  return queued;
}

// Acts on each click on the baseline card, in whatever folder: the card carries one set line, the
// baseline's, and is the very card the helper composed for the figures its twelve characters name,
// word for word. Record these is signed and kept in measures/clicks/, naming the full hash of the
// figures and the set line alone; Not now clears the figures waiting. One failing does not stop
// the rest.
const NOT_NOW = 'Not now';
function keepBaselineClicks(out, now) {
  for (const click of out) {
    if (!click.signable) continue;
    try {
      const m = only(BASELINE, click.question);
      if (!m || setLineOf(click.question) !== baselineLine(m[1])) continue;
      const hash = shownBaseline({ h12: m[1], card: click.card, now });
      if (hash === null) continue;
      if (click.label === BASELINE_LABEL) {
        keepBaselineClick(makeEvent({ kind: 'action', data: { action: 'baseline', hash, question: baselineLine(hash), label: click.label }, now }));
      } else if (click.label === NOT_NOW) {
        dropPending(hash);
      }
    } catch { /* not kept: the helper then records nothing for want of a click, and the card is asked again */ }
  }
}

// Whether a question carries a trust card's set line: its answers stay on this computer.
const carriesTrust = (question) => setLinesOf(question).some((line) => TRUST_LINE.test(line));

// The signed record a Remove it on uninstall's card earns (ruling R90): the card carries one set line,
// uninstall's, and is the very card the helper composed for the list its twelve characters name, for
// the project the line names and a folder holding this session's folder, word for word (its text,
// header and options). The record names that project and the list's full hash, and its question is
// the set line alone; the helper matches it against the list it works out again.
function uninstallClickOf(cwd, { question, label, card }) {
  if (label !== UNINSTALL_LABEL) return null;
  const line = setLineOf(question);
  const m = line === null ? null : UNINSTALL_LINE.exec(line);
  if (!m) return null;
  const shown = shownUninstall({ cwd, project: m[1], h12: m[2], card });
  if (shown === null) return null;
  return { kind: 'action', data: { action: 'uninstall', project: shown.project, hash: shown.hash, question: uninstallLine(shown.project, shown.hash), label } };
}

// Signs each Remove it on uninstall's card and keeps it in setup/clicks/, in whatever folder. One
// failing does not stop the rest.
function keepUninstallClicks(cwd, out, now) {
  for (const click of out) {
    if (!click.signable) continue;
    try {
      const made = uninstallClickOf(cwd, click);
      if (made) keepUninstallClick(makeEvent({ ...made, now }));
    } catch { /* not kept: the helper then refuses to remove anything for want of a click */ }
  }
}

// What was answered, and which answers came from a click on a button the card offered
// (`signable`) or were typed on a single-choice card (`typed`, AskUserQuestion's Other).
function clicks(input) {
  const ti = input.tool_input ?? {};
  const answers = ti.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  const asked = new Map((Array.isArray(ti.questions) ? ti.questions : []).map((q) => [q?.question, q]));
  const echoed = input.tool_response?.answers;
  const echo = echoed && typeof echoed === 'object' && !Array.isArray(echoed) ? echoed : null;
  const out = [];
  for (const [question, raw] of Object.entries(answers)) {
    const many = Array.isArray(raw);
    if (!many && typeof raw !== 'string') continue;
    if (many && !raw.every((x) => typeof x === 'string')) continue;
    const q = asked.get(question);
    const offered = Array.isArray(q?.options) && !many && q.options.some((o) => o?.label === raw);
    const agrees = echo === null || (Object.hasOwn(echo, question) && JSON.stringify(echo[question]) === JSON.stringify(raw));
    const single = Array.isArray(q?.options) && !many && q.multiSelect !== true && agrees;
    out.push({
      question,
      label: many ? raw.join(', ') : raw,
      signable: offered && single,
      typed: !offered && single,
      card: q,
    });
  }
  return out;
}

export { sendPending, BUDGET_MS };

// The text the state keeps for a card asked in the chat's words (chatCopy, scripts/state/card-lines.js), or null when
// the question isn't one: a card whose copy is the asked text with the same buttons. Where cards with different texts
// share those words (the same pull request asked again at a new head, say), only the one card still waiting counts;
// with none, or several, the question stays as asked, and nothing is signed from it.
export function storedText(project, q, { events = listEvents(stateDir(project), { report: () => {} }), waiting } = {}) {
  if (typeof q?.question !== 'string' || !Array.isArray(q.options) || setLineOf(q.question) !== null) return null;
  const labels = JSON.stringify(q.options.map((o) => o?.label));
  const texts = [...new Set(events.filter((e) => e.kind === 'card' && typeof e.data?.question === 'string' && e.data.question !== q.question
    && chatCopy(e.data.question) === q.question && JSON.stringify(e.data.options) === labels).map((e) => e.data.question))];
  if (texts.length <= 1) return texts[0] ?? null;
  const live = new Set((waiting ?? localViews(project, ['waiting'])?.waiting ?? []).map((c) => c?.data?.question));
  const left = texts.filter((t) => live.has(t));
  return left.length === 1 ? left[0] : null;
}

// `input` with each question asked in the chat's words put back as the state keeps its card, in the questions, the
// answers and the answers echoed, so a click signs and is recorded as one on the card's whole text always has.
function withStoredText(project, input) {
  const questions = Array.isArray(input.tool_input?.questions) ? input.tool_input.questions : [];
  let events;
  const swap = new Map();
  for (const q of questions) {
    if (typeof q?.question !== 'string' || setLineOf(q.question) !== null) continue;
    events ??= listEvents(stateDir(project), { report: () => {} });
    const text = storedText(project, q, { events });
    if (text !== null) swap.set(q.question, text);
  }
  if (swap.size === 0) return input;
  const rekey = (answers) => (answers && typeof answers === 'object' && !Array.isArray(answers)
    ? Object.fromEntries(Object.entries(answers).map(([k, v]) => [swap.get(k) ?? k, v])) : answers);
  return {
    ...input,
    tool_input: { ...input.tool_input, questions: questions.map((q) => (swap.has(q?.question) ? { ...q, question: swap.get(q.question) } : q)), answers: rekey(input.tool_input.answers) },
    ...(input.tool_response ? { tool_response: { ...input.tool_response, answers: rekey(input.tool_response.answers) } } : {}),
  };
}

// Signs what an answer earned and keeps it pending, then lifts STOP when it asks to; a lift
// that fails leaves no record. Returns what sendKept sends. Shared by a click and a reply code.
export function keepEarned(project, got, { now, liftStop = defaultLift }) {
  const event = makeEvent({ ...got.made, now });
  const route = got.profile ? 'profile-record' : 'record';
  const body = got.profile ? { event } : { project, event, ...(got.target === undefined ? {} : { target: got.target }) };
  const file = keep(project, route, body, now);
  try {
    if (got.lift) liftStop();
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  return { file, body, route };
}

// Sends one kept record, removing it once the helper has it. True when it was taken.
export async function sendKept(api, left, { file, body, route }) {
  const send = { 'profile-record': () => api.profile.record(body), write: () => api.state.write(body) }[route] ?? (() => api.state.record(body));
  const result = await left(send());
  if (!taken(result)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

// The shown records a card asks for: one for each single-choice question that carries exactly
// one set line and the line with that line's reply code, whatever was clicked, unless the shown
// view already holds the code, live (unspent and in date at `at`), for this question. The
// options are the card's own labels. A Lift STOP card shown again under a STOP that began after
// its held record gets a new one, since a reply lifts STOP only by a card shown after it began.
function shownFor(project, input, at, stopState = defaultStopState, carrying = new Set()) {
  const questions = input.tool_input?.questions;
  if (!Array.isArray(questions)) return [];
  const held = localViews(project, ['shown'])?.shown;
  const out = [];
  for (const q of questions) {
    if (typeof q?.question !== 'string' || q.multiSelect === true || !Array.isArray(q.options)) continue;
    if (carrying.has(q.question)) continue;
    const line = setLineOf(q.question);
    // A setup card, setup's card of the rules found, a trust card, uninstall's card, a Keep card, a usage card and the
    // premium model's card have no reply code (rulings R36, R80, R90, P7-31; design section 14.6): only the click on
    // the card itself counts.
    if (line === null || SETUP_LINE.test(line) || CONFIRM_ALL_LINE.test(line) || TRUST_LINE.test(line) || TAKEOVER_LINE.test(line) || UNINSTALL_LINE.test(line) || KEEP_CONTROL_LINE.test(line) || USAGE_LINE.test(line) || PREMIUM_LINE.test(line)) continue;
    const code = replyCode(line);
    const codes = q.question.split(/\r\n|[\n\r\u2028\u2029]/).filter((l) => l.startsWith('Reply code:'));
    if (codes.length !== 1 || codes[0] !== replyCodeLine(code)) continue;
    const was = held && Object.hasOwn(held, code) ? held[code] : null;
    const stop = isLiftStopLine(line) ? stopState() : null;
    const beforeStop = stop?.on === true && !(Date.parse(was?.at) > Date.parse(stop.at));
    if (was?.question === q.question && was.spent === false && at.getTime() - Date.parse(was.at) < REPLY_CODE_DAYS * DAY && !beforeStop) continue;
    out.push({ kind: 'shown', data: { code, question: q.question, options: q.options.map((o) => o?.label) } });
  }
  return out;
}

// On an agent whose hooks only read (`writeVia: 'helper'`), nothing here runs: no click is signed, kept or sent,
// and `earned` is never asked. Such an agent's chat click is recorded by the helper (/cards/chat-click), unsigned
// and naming its proof (rulings P5-12, P5-17).
export async function decide(input, { client, now = () => new Date(), projectOf: find = projectOf, dir, budget = BUDGET_MS + helperGrace(), liftStop = defaultLift, stopState, ready, premiumIn, writeVia = 'self' } = {}) {
  if (writeVia !== 'self') return undefined;
  if (input.tool_name !== tools.ask) return undefined;
  const answered = clicks(input);
  const at = now();
  // Which questions and answers carry the private note's figures is settled first, before a Not now
  // on the baseline card clears the figures waiting, which the test reads.
  const asked = Array.isArray(input.tool_input?.questions) ? input.tool_input.questions : [];
  const carrying = new Set([
    ...asked.filter((q) => typeof q?.question === 'string' && carriesBaseline(q, () => at)).map((q) => q.question),
    ...answered.filter((click) => carriesBaseline(click.card ?? { question: click.question }, () => at, click.question, click.label)).map((click) => click.question),
  ]);
  keepBaselineClicks(answered, () => at);
  sweepStale(() => at);
  // The baseline card's answers and a trust card's stay on this computer: none is sent to the
  // project, and none is kept as a setup answer, which a later step copies into the project's state.
  const out = answered.filter((click) => !carrying.has(click.question) && !carriesTrust(click.question));
  keepUninstallClicks(input.cwd, out, () => at);
  const found = find(input.cwd, { dir });
  if (!found) {
    if (beingSetUp(input.cwd) !== null) keepSetupClicks(input.cwd, out, () => at);
    return undefined;
  }
  const project = found.project;
  // A card asked in the chat's words is signed and recorded from the text the state keeps for it.
  let whole = input;
  try {
    whole = withStoredText(project, input);
  } catch {
    // The state can't be read: the questions stay as asked.
  }
  if (whole !== input) {
    input = whole;
    out.splice(0, out.length, ...clicks(input).filter((click) => !carrying.has(click.question) && !carriesTrust(click.question)));
  }
  const api = client ?? helperClient({ timeout: budget });
  const end = Date.now() + budget;
  const left = withinBudget(end);

  // First the signed records, each written down before it is sent. The cards' shown records
  // go first and are dated a millisecond before the clicks, so a record a click earns sorts
  // after its card's shown record and spends the code.
  const queued = [];
  const takeOvers = [];
  const clock = () => at;
  const shownAt = new Date(at.getTime() - 1);
  queued.push(...keepSetupClicks(input.cwd, out, clock, project));
  // An answer on a card a setup step asked goes only to setup/answers/, or nowhere when it was
  // refused (ruling R53): it earns no record in the state and is not sent as a card-answer.
  const setupAsked = new Set(out.filter((c) => askedFor({ cwd: input.cwd, card: c.card }) !== null).map((c) => c.question));
  let cards = [];
  try {
    cards = shownFor(project, input, at, stopState, carrying);
  } catch {
    // No reply codes this time; the clicks are still recorded.
  }
  for (const made of cards) {
    try {
      queued.push(keepEarned(project, { made }, { now: () => shownAt, liftStop }));
    } catch {
      // A card whose options a shown record can't hold has no reply code.
    }
  }
  for (const click of out) {
    if (!click.signable || setupAsked.has(click.question)) continue;
    try {
      const got = await earned({ project, ...click, client: api, now: clock, left, stopState, ...(ready === undefined ? {} : { ready }), ...(premiumIn === undefined ? {} : { premiumIn }) });
      if (got) {
        queued.push(keepEarned(project, got, { now: clock, liftStop }));
        if (got.takeOver) takeOvers.push(queued.at(-1));
      }
    } catch {
      // One question failing does not stop the rest; a lift that did not happen leaves no record.
    }
  }
  const sent = new Map();
  for (const kept of queued) sent.set(kept, await sendKept(api, left, kept));
  // A Take over here the helper has the record of: it takes the lock, if the lock still stands as the card named it.
  if (takeOvers.some((kept) => sent.get(kept) === true)) await left(api.lock.takeOver({ project }));
  // Then the plain answers. What cannot be sent in time is kept.
  for (const { question, label } of out) {
    if (setupAsked.has(question)) continue;
    const body = { project, kind: 'card-answer', data: { question, label } };
    try {
      const result = await left(api.state.write(body));
      if (!taken(result)) keep(project, 'write', body, now);
    } catch {
      // Not kept twice: a failure here is a failure to write the file too.
    }
  }
  return undefined;
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'PostToolUse' });
}
