// scripts/engine/runner.js
// The helper's side of the card router (Archon design, sections 8.3 and 8.4), for one project on the engine. Each new
// ask is routed: the table's answers and a delegation's go back at once, with a Logbook line; the rest become cards,
// written at once, the director's cards a day limiting which are pushed. A card is a build question (its answer card is signed by its question
// line) or a pull request's approval (signed as any approval is), so the signing that exists signs it. Each tick, the
// director's signed answers go back to the engine, once each; one the engine refuses closes with one plain line.
// Under All stop nothing goes back: an answer signed then never reaches the build, and its question is asked again
// after the lift. What it did is kept in `file`, so a helper started again routes nothing twice. The click counts at
// once, and delivery waits for a place (delegated decisions design, section 8.3): an answered piece enters the
// dispatcher's list, and its answer goes once it is admitted, with no incident open. An answer that stops the work, the
// fix lane and the merge queue don't wait.
//
// Each tick also keeps the caps (section 10.2): a running run past its minutes (running time only) or its tokens is
// cancelled, its worktree kept, and a cap card asks Give it more or Stop. Give it more resumes a run that stopped on
// a failure, skipping finished steps; a cancelled run can't be resumed (check 78), so it is started again on its
// branch to carry on from what's there, with the cap raised once and the spend before it carried. A run paused at its
// cap spends nothing, so it is held instead, which keeps Give it more's way of carrying it on: none of its answers goes
// back until Give it more lifts the hold, and Stop cancels it. A run that ended gets one `cost` record.
import fs from 'node:fs';
import path from 'node:path';
import { composeCard } from '../cards/compose.js';
import { blindDue } from '../delegation/blind.js';
import { routeAsk, cardBudget, bundleApprovals, answerFor, dayOf, ignoresBudget, ENGINE_QUESTIONS } from './router.js';
import { runCost, runningMinutes } from './spend.js';
import { capReached, carriedSpend } from './caps.js';
import { RED_MAIN, FIX_LANE, redMainIncident, openRedMain } from './fix-main.js';
import { MERGE_WORK } from './dispatcher.js';
import { routerWaiting, routerCards, overtaken, approvalAnswers } from './waiting.js';
import { endedBy } from '../foreman/queue.js';
import { gateTargetOf } from '../state/views.js';
import { READER_WORK } from '../delegation/reader.js';
import { alike, normaliseWords } from '../delegation/words.js';
import { closeMatch, decisionKey, earlierAnswer, reuse, spokenSince } from '../delegation/asked.js';
import { REPEAT_READ_MS } from '../delegation/limits.js';
import { mergeQuestionWords, parkedWords, PARKED_WHY, PARKED_BECAUSE, PARKED_MEANWHILE, PARKED_APPROVE_SAYS, PARKED_CHANGED } from './words.js';
import { parkChoice } from './archon/asks.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const EMPTY = () => ({ routed: {}, waiting: [], held: [], shown: { day: null, count: 0 }, questions: {}, approvals: {}, delivered: {}, tries: {}, later: [], next: {}, noted: null, capped: {}, capsOwed: {}, costed: {}, reviewsKept: {}, carried: {}, reworks: {}, answers: {}, sending: {}, parked: {}, reused: {}, repeats: {}, unsure: {} });
// The failed tries after which the director is told an answer hasn't reached the build yet.
const UNREACHABLE_SAID = 3;
// The cap card's options: Give it more carries the work on with the cap raised once; Stop leaves it stopped.
export const MORE = 'Give it more';
export const STOP_LABEL = 'Stop';
// A blocked exit's answers: Stop ends the work; any other ends the run, and the work starts again on its branch, with
// the director's answer (other than Send it back, which says nothing more) in its order.
const STOP = 'stop';
const REWORK = 'rework';
// The labels that stop work: an answer with one of these needs no place.
export const STOPS_WORK = Object.freeze(new Set([STOP_LABEL, 'Stop here', STOP]));
// Give it more under way: marked before it acts, so a crash part way is finished and never done twice.
const GOING = 'going';
// The bug lane's proposal when a bug proves bigger than a bug (scripts/engine/bug-size.js): the work stops in the bug
// lane, and the First Mate records it again in the lane the director picked (intake, route 2).
const BIGGER = 'bigger-than-a-bug';
const MOVES = Object.freeze({ small: 'a small change', feature: 'a feature' });
// The question an ask puts, as the step wrote it.
// What a question card is to the seals: the merge queue's question and trouble are never a rule's.
const cardKind = (ask) => (isPlain(ask?.mergeQuestion) ? 'merge' : ask?.kind === 'trouble' ? 'trouble' : 'question');
const questionOf = (ask) => [ask?.reason, ask?.context?.reason, ask?.context?.question].find((q) => typeof q === 'string' && q !== '') ?? null;

function readState(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlain(kept) ? { ...EMPTY(), ...kept } : EMPTY();
  } catch {
    return EMPTY();
  }
}
function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

// A title inside a sentence: its first letter small, unless it is a name.
const inSentence = (title) => (/^[A-Z][a-z]/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title);

// engineRunner({ engine, file, readViews, write, stopped, now, settings, workOf, titleOf, endRun }) -> { onAsk, onMatch, tick, file }.
// - `readViews()` the project's views (questions, approvals, levels), as the helper builds them;
// - `write(kind, data)` a record in the project's history; `stopped()` whether All stop is on;
// - `settings()` { cardsPerDay, bundleApprovals }; `workOf(runId)` { work, lane } from the project's run records;
// - `onCard(card)` tells the seals of a card once it is written (scripts/delegation/record-only.js); `onReaderAsk(ask)`
//   tells them of an ask on a reader's run, which never becomes a card;
// - `titleOf(work)` the work's title; `endRun(runId)` ends a run's process tree by pid, as All stop does, for a run the
//   engine wouldn't stop at its cap ({ ended, survivors });
// - `openedOf(pr)` the helper's own record of what opened a pull request ({ lane, work, ... }), or null; `prTitleOf(pr)`
//   its title from the host, or null; `keepReviews(runId)` keeps what an ended run's task reviews last said, in the
//   helper's own record, true once done;
// - `blindRoll(id)` a number in [0, 1) for a question, which draws its blind card (scripts/delegation/blind.js); by default none is;
// - `release(work)` ends a piece's reservation (dispatch-run.js), for an end that writes no report: the director's Stop
//   and a bug that moves lane;
// - `admittedTo(work)` whether the dispatcher has given a piece its place; `delivered(work, key)` and `drop(work, key)` tell
//   it an answer went back or was refused or not used; `startAdmitted(args)` starts a run on the place already held;
//   `carryOver(work, { branch, answers })` keeps what Carry on needs of an answer All stop kept from being used.
// - `comingBack(work)` whether a piece waits for a place, so no answer may wake it from here;
// - `headOf(place)` a piece's head, `commitsSince(place, head)` its commits after that head and `exclusionsOf(place)` the
//   common exclusions it hits, `place` being { branch, folder }; each null when it can't be read, and none may hold up a tick.
// - `handBack({ pr })` hands a parked pull request the director approved to the merge queue again
//   (dispatch-run.js): { ok }, { ok: false, waiting } or { ok: false, refused }.
//
// One unclear pull request holds nothing back (delegated decisions design, section 8): where the queue offers `park`
// it is taken, which only leaves that pull request, and the director's approval card is raised for its head. `parked`
// keeps { [pr]: { head, at, runId, choice, work, ask, taken, handed } }: `taken` once the engine has it, so a restart
// between the two still raises the card, and `handed` once an approval has gone back to the queue. Only an approval
// signed since `at` counts for it: an older one, for a pull request shown first, never saw what the queue is unsure of.
export function engineRunner({ engine, file, readViews, write, stopped = () => false, now = () => new Date(), settings = () => ({}), workOf = () => null, titleOf = (work) => work, endRun = async () => ({ ended: [], survivors: [] }), openedOf = () => null, prTitleOf = async () => null, keepReviews = async () => true, onCard = () => {}, onReaderAsk = () => {}, blindRoll = () => 1, release = () => {}, handBack = async () => ({ ok: false, refused: 'nothing hands work to the merge queue here' }), admittedTo = () => true, delivered = () => {}, drop = () => {}, startAdmitted = async () => ({ ok: false, refused: 'nothing starts runs here' }), carryOver = () => {}, comingBack = () => false, headOf = async () => null, commitsSince = async () => null, exclusionsOf = async () => null } = {}) {
  let state = readState(file);
  const keep = () => saveState(file, state);
  const note = (words, extra = {}) => write('note', { about: 'engine', words, ...extra });
  const titled = (work) => inSentence(String(titleOf(work) ?? work));
  // A card has been written: the seals' trouble is never the card's.
  const sealCard = (card) => {
    try { onCard(card); } catch { /* it costs a seal, never a card */ }
  };
  const letGo = (work) => {
    try { release(work); } catch { /* the files stay held, which only holds new work back */ }
  };
  const placeOf = (ask) => ({ branch: ask?.context?.branch ?? null, folder: ask?.context?.folder ?? null });

  let enter = () => {};
  const viewsNow = () => {
    try { return readViews() ?? {}; } catch { return {}; }
  };
  let mergeRuled = () => {};
  const safely = (fn) => Promise.resolve().then(fn).catch(() => null);
  // A run held at its cap while paused: nothing goes back to it until Give it more.
  const held = (runId) => state.capped[runId]?.held === true;
  async function inspect(runId) {
    try { return (await engine.inspect(runId)) ?? null; } catch { return null; }
  }

  // The engine's answer to an answer: { ok }, a refusal ({ ok: false, refused }), or `unreachable` when the engine
  // couldn't be heard from (the call threw, or the engine says so), which is tried again on the next tick.
  async function answerEngine(runId, answer) {
    try {
      return (await engine.act(runId, { answer })) ?? { ok: false, unreachable: true };
    } catch (error) {
      return { ok: false, unreachable: true, refused: error instanceof Error ? error.message : 'unknown' };
    }
  }

  // The merge queue's question with what its run's record says it asked: the card's words name the pull request, and
  // `mergeChoice` is the answer that merges.
  async function mergeQuestionOf(ask) {
    const asked = await Promise.resolve().then(() => engine.mergeAsked?.(ask.runId)).catch(() => null);
    const pr = asked?.pr ?? ask.mergeQuestion.pr;
    const title = Number.isInteger(pr) ? await Promise.resolve().then(() => prTitleOf(pr)).catch(() => null) : null;
    return { asked, ask: { ...ask, mergeQuestion: { ...ask.mergeQuestion, pr, park: asked?.park ?? null }, reason: mergeQuestionWords(pr, title), mergeChoice: asked?.merge ?? null } };
  }

  // Whether the director has already decided this: the pull request is a feature's own or was parked, by the helper's
  // record, and a verified, signed approval names exactly the head the queue asked about. The merge itself still needs
  // that approval at the gate; this only spares the second question.
  function alreadyApproved(asked, views) {
    if (!isPlain(asked) || typeof asked.merge !== 'string' || asked.merge === '') return false;
    const approval = views.approvals?.[asked.pr]?.[asked.head];
    return isPlain(approval) && (openedOf(asked.pr)?.lane === 'feature' || (state.parked[asked.pr]?.taken === true && approvedSince(state.parked[asked.pr], approval)));
  }
  const approvedSince = (kept, approval) => isPlain(approval) && approvalAnswers(approval, kept);

  // The card for a parked pull request no longer stands for what waits.
  function retireCard(pr) {
    for (const [key, approval] of Object.entries(state.approvals)) if (approval.parked && key.startsWith(`${pr}:`)) delete state.approvals[key];
    const other = (w) => !(w.card.approval?.parked && w.card.approval.pr === Number(pr));
    state.waiting = state.waiting.filter(other);
    state.held = state.held.filter(other);
  }

  // Leaves the queue's pull request alone and raises the director's card. Gives whether the ask is settled here; one that
  // isn't stays the blocking question it is today.
  async function leaveAlone(ask, asked, choice, work) {
    const pr = asked.pr;
    const kept = state.parked[pr];
    if (kept?.head === asked.head) {
      // A second question about the one pull request: the card already open stands for both (check 90). Once its
      // approval has gone back, this is a question the queue should not need, so the director sees it.
      if (kept.handed) return false;
      const got = await answerEngine(ask.runId, { ask: ask.id, choice });
      keep();
      return got.ok === true;
    }
    retireCard(pr);
    state.parked[pr] = { head: asked.head, at: now().toISOString(), runId: ask.runId, choice, work, ask, taken: false, handed: false };
    keep();
    await takePark(pr);
    return true;
  }

  // Answers `park`, and raises the card once it holds. A run still paused after a refusal is asked as ever. One that has
  // ended has nothing left to hold, whatever became of the answer, so the card comes either way.
  const taking = new Set();
  async function takePark(pr) {
    const kept = state.parked[pr];
    if (taking.has(kept) || kept.taken) return;
    taking.add(kept);
    try {
      await takeParkNow(pr, kept);
    } finally {
      taking.delete(kept);
    }
  }
  async function takeParkNow(pr, kept) {
    const got = await answerEngine(kept.runId, { ask: kept.ask.id, choice: kept.choice });
    if (!got.ok) {
      if (got.unreachable === true) return;
      const status = (await inspect(kept.runId))?.status;
      if (status === 'paused') {
        const routed = routeAsk(kept.ask);
        state.waiting.push({ importance: routed.importance, exempt: routed.exempt === true, card: routed.card, work: kept.work, runId: kept.runId, ask: kept.ask });
        delete state.parked[pr];
        keep();
        await show();
        return;
      }
      if (status !== 'ended') return;
    }
    kept.taken = true;
    const { holdsAll, ...ask } = kept.ask;
    state.waiting.push({
      importance: 3, exempt: false, work: kept.work, runId: kept.runId, ask,
      card: { approval: { pr: Number(pr), sha: kept.head, level: 3, parked: true, what: parkedWords(ask.reason), plainWhat: parkedWords(mergeQuestionWords(Number(pr))), why: PARKED_WHY, engine: { approve: null } } },
    });
    keep();
    await show();
  }

  // Parks still to be taken, and approved pull requests going back to the queue. Under All stop nothing moves, and a
  // signed approval waits for the lift.
  async function parks() {
    if (stopped()) return;
    const approvals = viewsNow().approvals;
    for (const [pr, kept] of Object.entries(state.parked)) {
      if (!kept.taken) {
        if (!held(kept.runId)) await takePark(pr);
        continue;
      }
      if (kept.handed || !approvedSince(kept, approvals?.[pr]?.[kept.head])) continue;
      const got = await safely(() => handBack({ pr: Number(pr) }));
      if (got?.gone === true) {
        delete state.parked[pr];
        retireCard(pr);
        keep();
        await note(`Your approval of pull request #${pr} wasn't used: that work has ended, or the pull request has closed.`, { work: kept.work, level: 3 });
      } else if (got?.ok === true) {
        kept.handed = true;
        keep();
        mergeRuled();
        await note(`You approved pull request #${pr} at ${kept.head.slice(0, 7)}, so it goes back to the merge queue to be added.`, { work: kept.work, level: 3 });
      } else if (typeof got?.refused === 'string' && kept.said !== got.refused) {
        kept.said = got.refused;
        keep();
        await note(`Pull request #${pr} couldn't go back to the merge queue yet: ${got.refused}.`, { work: kept.work, level: 3 });
      }
    }
  }

  // Routes one ask (an `ask` EngineEvent), once.
  async function onAsk(given) {
    let ask = given;
    if (!isPlain(ask) || typeof ask.id !== 'string' || state.routed[ask.id]) return;
    // A held run the director stopped is never asked about again.
    if (state.capped[ask.runId]?.stopped === true) return;
    if (held(ask.runId)) {
      // Routed once the hold is lifted.
      if (!state.later.some((a) => a.id === ask.id)) state.later.push(ask);
      keep();
      return;
    }
    const found = workOf(ask.runId);
    if (found?.work === READER_WORK) {
      try { onReaderAsk(ask); } catch { /* it costs a reading, never a card */ }
      return;
    }
    // A merge-queue run the helper didn't start, not yet seen by the dispatcher, still waits on an answer.
    const work = found?.work ?? ask.work ?? (isPlain(ask.mergeQuestion) ? MERGE_WORK : null);
    if (typeof work !== 'string') return;
    state.routed[ask.id] = true;
    let views = {};
    try { views = readViews() ?? {}; } catch { views = {}; }
    if (isPlain(ask.mergeQuestion)) {
      const { asked, ask: named } = await mergeQuestionOf(ask);
      ask = named;
      if (alreadyApproved(asked, views)) {
        if (stopped()) {
          // Answered once All stop is lifted, never under it.
          state.later.push(given);
          keep();
          return;
        }
        const got = await answerEngine(ask.runId, { ask: ask.id, choice: asked.merge });
        keep();
        if (got.ok) {
          mergeRuled();
          await note(`The merge queue asked about pull request #${asked.pr} at ${asked.head.slice(0, 7)}. You approved that commit, so it goes ahead on your approval.`, { work, level: 3 });
          return;
        }
      }
      const choice = parkChoice(ask);
      if (choice !== null && isPlain(asked) && Number.isInteger(asked.pr)) {
        if (stopped()) {
          // Left alone once All stop is lifted, never under it.
          state.later.push(given);
          keep();
          return;
        }
        if (await leaveAlone(ask, asked, choice, work)) return;
      }
    }
    const routed = routeAsk(ask, { levels: views.levels ?? {} });
    if (routed.answer) {
      if (stopped()) {
        // Answered once All stop is lifted, never under it.
        state.later.push(ask);
        keep();
        return;
      }
      const got = await answerEngine(ask.runId, { ask: ask.id, ...routed.answer });
      keep();
      await note(got.ok ? routed.line : `The build's question about ${titled(work)} wasn't answered by the standing rule: the build had already moved on.`, { work, level: routed.level ?? 1 });
      // A red main line's hold opens one red-main incident, which holds other work until the main line is green.
      if (got.ok && ask.opens === RED_MAIN && !openRedMain(viewsNow())) await write('incident', redMainIncident(ask));
      return;
    }
    if (routed.line) {
      keep();
      await note(routed.line, { work });
      return;
    }
    const asked = routed.card.question ? await askedBefore(ask, work, routed.card.question) : null;
    if (asked?.answer !== undefined) {
      if (stopped()) {
        // Answered once All stop is lifted, never under it.
        state.later.push(ask);
        keep();
        return;
      }
      takeEarlier(ask, work, routed.card.question, asked);
      await sendEarlier(ask.id);
      return;
    }
    await raise(routed, ask, work, asked?.earlier);
  }

  async function raise(routed, ask, work, earlier = null) {
    if (earlier && routed.card.question.level === 3) routed.card.question.saidBefore = earlier.answer;
    state.waiting.push({ importance: routed.importance, exempt: routed.exempt === true, card: routed.card, work, runId: ask.runId, ask });
    keep();
    await show();
  }

  // The key of a decision: an ask in the build's own words, never the merge queue's or trouble.
  const keyOf = (ask, work) => (cardKind(ask) === 'question' && questionOf(ask) !== null && work !== MERGE_WORK ? decisionKey(work, questionOf(ask)) : null);
  // A look at a piece's branch, which gives null when it can't be read or doesn't answer in time.
  function lookAt(read) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), REPEAT_READ_MS);
      timer.unref?.();
      safely(read).then((got) => {
        clearTimeout(timer);
        resolve(got ?? null);
      });
    });
  }

  // Whether the director has answered this decision on this piece (delegated decisions design, section 7.4), as `reuse`
  // says with `earlier` beside it, or null. An answer is taken once, so a piece that keeps asking comes to a card and can't
  // go round on its own. Nothing that ends or moves a piece is taken from before. A piece with another card open has given
  // up its place, one coming back has none yet, and under an incident answers wait, so each comes as a card, which
  // waits by the ordinary rules. The ask is kept on `later` while its branch is read: a helper started again routes it
  // anew, since nothing else names it yet. Everything but the branch is read after that, so a click meanwhile counts.
  const reading = new Set();
  async function askedBefore(ask, work, question) {
    const key = keyOf(ask, work);
    const settled = (id) => state.delivered[id] === 'answered' && state.unsure[id] !== true;
    const first = key === null ? null : earlierAnswer({ views: viewsNow(), work, key, settled });
    if (first === null) return null;
    const place = placeOf(ask);
    reading.add(ask.id);
    state.later.push(ask);
    keep();
    const [commits, exclusions] = await Promise.all([
      typeof first.head === 'string' ? lookAt(() => commitsSince(place, first.head)) : null,
      lookAt(() => exclusionsOf(place)),
    ]);
    reading.delete(ask.id);
    state.later = state.later.filter((a) => a.id !== ask.id);
    const views = viewsNow();
    const earlier = earlierAnswer({ views, work, key, settled });
    if (earlier === null) return null;
    const label = optionNamed(question, earlier.answer);
    const ends = STOPS_WORK.has(earlier.answer) || STOPS_WORK.has(label) || question.engine.options[label] === STOP || ask.topic === BIGGER;
    const got = reuse({
      ask: { kind: ask.kind, level: question.level, options: question.options }, earlier, commitsSince: earlier.id === first.id ? commits : null, exclusions,
      spokenSince: spokenSince({ views, work, earlier }), changed: earlier.changed,
      asksAgain: state.reused[earlier.id] === true || ends || typeof earlier.words === 'string' || held(ask.runId) || waitingOn().has(work)
        || comingBack(work) === true || (views.incidents?.open?.length ?? 0) > 0,
    });
    return got && { ...got, earlier };
  }
  // A close match from the reader (asked.js, closeMatch). It is signed, since a build's own record can't join a card in other
  // words, and it answers nothing: the lead's card is issued again with both wordings, and a card held back has no more to wait for.
  async function onMatch({ card, sameAs }) {
    const kept = state.questions[card];
    if (!kept || state.delivered[card]) return;
    const views = viewsNow();
    const got = closeMatch({ card, sameAs, views });
    if (got === null) return;
    await write('match', { card, work: kept.work, ...(got.join ? { joins: got.join } : { saidBefore: got.line, from: sameAs }) });
    if (got.join) {
      state.questions[card] = { ...kept, joins: got.join, options: views.questions[card].question.data.engine?.options ?? {} };
      state.held = state.held.filter((h) => h.id !== card);
      keep();
    }
  }
  const optionNamed = (question, label) => question.options.find((o) => normaliseWords(o.label) === normaliseWords(label))?.label;

  // Marks the director's earlier answer as going to the build. A blocked ask's run ends on it as on any answer, so the
  // piece starts again; that is marked first, so a crash after the answer leaves no piece stranded.
  function takeEarlier(ask, work, question, { earlier }) {
    const label = optionNamed(question, earlier.answer);
    const answer = answerFor(question.engine, label);
    if (startsAgain({ ask, work, runId: ask.runId }, laneOf({ work, runId: ask.runId }, viewsNow()))) {
      state.reworks[ask.runId] = { work, answer: answer.choice !== REWORK ? { question: questionOf(ask), answer: label } : null };
    }
    state.reused[earlier.id] = true;
    state.repeats[ask.id] = { ask, work, label, answer, earlier: earlier.id };
    keep();
  }

  // Sends an earlier answer, as `deliver` sends any: an engine that couldn't be heard from is tried again on the next tick,
  // and one that refuses after a try that may have landed took it the first time. One that refuses it outright has moved
  // on from what the answer was for, so the director is asked.
  async function sendEarlier(id) {
    const entry = state.repeats[id];
    if (!entry || stopped() || held(entry.ask.runId)) return;
    const sentBefore = entry.sent === true;
    entry.sent = true;
    keep();
    let got = await answerEngine(entry.ask.runId, entry.answer);
    if (!got.ok && got.unreachable !== true && sentBefore) got = { ok: true };
    if (!got.ok && got.unreachable === true) {
      entry.tries = (entry.tries ?? 0) + 1;
      keep();
      if (entry.tries === UNREACHABLE_SAID) await note(`The build couldn't take your answer about ${titled(entry.work)} yet; it keeps trying.`, { work: entry.work });
      return;
    }
    delete state.repeats[id];
    if (got.ok) {
      keep();
      await note(`The build asked again about ${titled(entry.work)}, and was given your earlier answer: ${entry.label}.`, { work: entry.work, level: 3 });
      return;
    }
    delete state.reused[entry.earlier];
    delete state.reworks[entry.ask.runId];
    const routed = routeAsk(entry.ask, { levels: viewsNow().levels ?? {} });
    if (routed.card?.question) await raise(routed, entry.ask, entry.work, { answer: entry.label });
    else keep();
  }

  // Writes every waiting card at once (delegated decisions design, section 8.5); the day's budget says only which are
  // pushed. One showing at a time: an ask routed while a tick shows cards waits for it, so no card is written twice.
  let showing = Promise.resolve();
  function show() {
    showing = showing.then(showNow, showNow);
    return showing;
  }
  // The id a card goes by: a question's, or an approval's pull request and head, as the seals and `state.approvals` name it.
  function nameCard(item) {
    if (typeof item.id === 'string') return;
    const a = item.card.approval;
    if (a) {
      item.id = `${a.pr}:${a.sha}`;
      return;
    }
    const n = (state.next[item.work] ?? ENGINE_QUESTIONS) + 1;
    state.next[item.work] = n;
    item.id = `q-${item.work}-${n}`;
  }
  // Whether the director has answered a held card, on the Logbook or a card of its own.
  function answered(id, views) {
    if (state.delivered[id] || typeof views.questions?.[id]?.answer?.label === 'string') return true;
    const [pr, sha] = id.split(':');
    return Boolean(sha) && approvalAnswers(views.approvals?.[pr]?.[sha], state.parked[pr]?.head === sha ? state.parked[pr] : null);
  }
  // Whether a card may stand for others or join one: a question in the build's own words, never the fixed words of an ask
  // that gave none, the merge queue's or trouble, and never one that ignores the budget, which is asked for itself.
  const bundles = (item) => isPlain(item.card?.question) && cardKind(item.ask) === 'question' && questionOf(item.ask) !== null && item.work !== MERGE_WORK && !ignoresBudget(item);
  // Alike questions are one card, across pieces or within one (delegated decisions plan, choice 12). A question alike an
  // open card's, written or still to come, is marked to join it, and a mark whose lead has gone is taken off.
  function bundleAlike(views) {
    for (const item of state.waiting) {
      if (typeof item.joins === 'string' && !state.waiting.some((w) => w.id === item.joins) && !state.questions[item.joins]) delete item.joins;
    }
    const open = Object.entries(state.questions).filter(([id, kept]) => !kept.cap && !kept.joins && isPlain(kept.ask) && !state.delivered[id] && isPlain(views.questions?.[id]) && !isPlain(views.questions[id].answer))
      .map(([id, kept]) => ({ id, work: kept.work, words: views.questions[id].question?.data, kept }))
      .filter((lead) => cardKind(lead.kept.ask) === 'question' && questionOf(lead.kept.ask) !== null && lead.kept.work !== MERGE_WORK);
    for (const item of state.waiting) {
      if (typeof item.joins === 'string' || !bundles(item)) continue;
      const lead = open.find((l) => alike(l.words, item.card.question));
      if (lead) item.joins = lead.id;
      else open.push({ id: item.id, work: item.work, words: item.card.question });
    }
  }
  async function showNow() {
    const today = dayOf(now());
    if (state.shown.day !== today) state.shown = { day: today, count: 0 };
    const { cardsPerDay = 3, bundleApprovals: bundling = false } = settings() ?? {};
    let views = {};
    try { views = readViews() ?? {}; } catch { views = {}; }
    // A pull lifts a card and spends no budget; an answered card has nothing left to hold.
    const pulled = new Set(Array.isArray(views.cardsWaiting?.pulled) ? views.cardsWaiting.pulled : []);
    state.held = state.held.filter((h) => !pulled.has(h.id) && !answered(h.id, views));
    state.waiting.forEach(nameCard);
    bundleAlike(views);
    const items = [...state.held, ...state.waiting.filter((w) => typeof w.joins !== 'string')];
    // Bundled approvals are shown together and count as one card; each is still its own signed approval.
    // A bundle is exempt when any card in it is, so what holds up all work is never held back with it.
    const groupOf = (importance, members) => ({ importance, exempt: members.some(ignoresBudget), items: members });
    const groups = bundling
      ? bundleApprovals(items).map((g) => groupOf(g.importance, g.card.bundle ? items.filter((w) => w.card.approval && g.card.bundle.includes(w.card.approval)) : [g]))
      : items.map((w) => groupOf(w.importance, [w]));
    const { show: shown } = cardBudget({ cards: groups, cardsPerDay, shownToday: state.shown.count });
    const over = groups.filter((g) => !shown.includes(g)).flatMap((g) => g.items);
    keep();
    // Named as held before it is written, so no tick reads a held card as pushed.
    const ids = over.map((item) => item.id);
    const listed = JSON.stringify(ids);
    if (state.noted !== listed) {
      await write('note', { about: 'cards-waiting', count: ids.length, ids });
      state.noted = listed;
      keep();
    }
    // A card the record refuses is tried again on the next tick, said once, and holds up none behind it.
    const written = async (item) => {
      if (!state.waiting.includes(item)) return true;
      try {
        await writeCard(item);
      } catch {
        if (item.refused !== true) {
          await note(`A question about ${titled(item.work)} couldn't be shown yet; it keeps trying.`, { work: item.work }).then(() => { item.refused = true; keep(); }, () => {});
        }
        return false;
      }
      state.waiting = state.waiting.filter((w) => w !== item);
      return true;
    };
    for (const group of shown) {
      let all = true;
      for (const item of group.items) {
        if (await written(item)) state.held = state.held.filter((h) => h !== item);
        else all = false;
      }
      if (all && !ignoresBudget(group)) state.shown.count += 1;
      keep();
    }
    for (const item of over) {
      if (!state.waiting.includes(item) || !await written(item)) continue;
      state.held.push(item);
      keep();
    }
    // A joiner follows its lead, whose card has to be on the record first. It raises no card and spends no budget.
    for (const item of state.waiting.filter((w) => typeof w.joins === 'string' && !state.waiting.some((l) => l.id === w.joins))) {
      await written(item);
      keep();
    }
  }

  async function writeCard({ id, card, work, runId, ask, joins, exempt }) {
    if (card.approval) {
      const a = card.approval;
      // A park at a new head: this card takes the place of the old head's, which nothing would close.
      const before = a.parked ? (viewsNow().waiting ?? []).filter((w) => w.data?.kind === 'approval' && gateTargetOf(w) === `pull request #${a.pr}` && !w.data.line?.includes(a.sha.slice(0, 12))).at(-1) : undefined;
      const compose = (what) => composeCard({
        kind: 'approval', level: a.level === 4 ? 4 : 3, recommend: 'Approve',
        ...(before ? { revises: before.id, changed: PARKED_CHANGED } : {}),
        what,
        why: a.why, because: a.parked ? PARKED_BECAUSE : 'its checks passed and it is visible work, which you see first',
        meanwhile: a.parked ? PARKED_MEANWHILE : 'Nothing is added until you approve it.',
        options: [{ label: 'Approve', says: a.parked ? PARKED_APPROVE_SAYS : 'It approves the change, and it is added to the product.' }],
        ...(a.level === 4 ? { checks: 'It changes no checks: the change is still checked before it is added.' } : {}),
        target: { pr: a.pr, sha: a.sha },
      });
      let composed;
      try {
        ({ card: composed } = compose(a.parked ? a.what : `Pull request #${a.pr} is ${titled(work)}, ready for you to look at before it is added.`));
      } catch (error) {
        // A pull request's title is the host's text, which a card can refuse. The card still has to come.
        if (!a.parked) throw error;
        ({ card: composed } = compose(a.plainWhat));
      }
      await write('card', composed);
      state.approvals[id] = { runId, ask, approve: a.engine.approve, work, ...(a.parked ? { parked: true } : {}) };
      sealCard({ id, kind: 'approval', work, runId, level: a.level === 4 ? 4 : 3, ...placeOf(ask) });
      return;
    }
    const q = card.question;
    const key = keyOf(ask, work);
    const head = key === null ? null : await lookAt(() => headOf(placeOf(ask)));
    // A joiner raises no card, so it has nothing to show blind, and a card saying what was said before asks for one click.
    const day = dayOf(now());
    const blind = typeof joins !== 'string' && typeof q.saidBefore !== 'string' && blindDue({ ask, card: { level: q.level, exempt }, day, lastDay: state.blindDay, roll: blindRoll(id), off: settings()?.blindCards === false });
    await write('question', {
      id, work, what: q.what, why: q.why, options: q.options, recommendation: q.recommendation ?? q.options[0]?.label, level: q.level,
      ...(q.level === 4 ? { checks: 'It changes no checks: the build still checks its work before it is added.' } : {}),
      engine: { runId, ask: ask.id, options: q.engine.options },
      ...(typeof joins === 'string' ? { joins } : {}),
      ...(key === null ? {} : { key }),
      ...(typeof head === 'string' ? { head } : {}),
      ...(typeof q.saidBefore === 'string' ? { saidBefore: q.saidBefore } : {}),
      ...(blind ? { blind: true } : {}),
    });
    if (blind) state.blindDay = day;
    state.questions[id] = { runId, ask, work, ...(typeof joins === 'string' ? { joins, options: q.engine.options } : {}) };
    // A joiner raises no card, so it has none to seal.
    if (typeof joins !== 'string') sealCard({ id, kind: cardKind(ask), work, runId, level: q.level, ...placeOf(ask) });
  }

  function waitingOn() {
    let views;
    try { views = readViews() ?? {}; } catch { return new Set(); }
    return routerWaiting({ state, views, prWork: (pr) => openedOf(pr)?.work ?? null });
  }

  // The lane of the run an answer goes to.
  const laneOf = (kept, views) => (views.runs?.[kept.work] ?? []).filter((r) => r?.data?.runId === kept.runId).at(-1)?.data?.lane ?? workOf(kept.runId)?.lane;
  // Whether an answer ends a run whose piece then starts again. The fix lane and the merge queue keep their own rules, and
  // neither has a work record to start again from.
  const startsAgain = (kept, runLane) => kept.ask?.kind === 'blocked' && runLane !== FIX_LANE && runLane !== 'merge' && kept.work !== MERGE_WORK;
  // Whether a piece may be sent its answer now.
  const hasPlace = (work, key, views) => (views.incidents?.open?.length ?? 0) === 0 && admittedTo(work, key);
  // Whether a question was answered as part of a bundle, as a joiner or as the lead of one.
  const bundled = (key, kept) => typeof kept.joins === 'string' || Object.values(state.questions).some((k) => k.joins === key);
  // Tells the dispatcher of each answer already settled, so a crash just after one leaves no entry behind.
  function settled() {
    for (const [key, how] of Object.entries(state.delivered)) {
      const work = (state.questions[key] ?? state.approvals[key])?.work;
      if (typeof work !== 'string' || how === GOING) continue;
      if (how === 'answered') delivered(work, key);
      else drop(work, key);
    }
  }

  // Sends the director's signed answers to the engine, once each.
  async function deliver() {
    let views = {};
    try { views = readViews() ?? {}; } catch { views = {}; }
    settled();
    const answered = [];
    for (const [id, kept] of Object.entries(state.questions)) {
      if (state.delivered[id] && state.delivered[id] !== GOING) continue;
      const answer = views.questions?.[id]?.answer;
      if (!isPlain(answer) || typeof answer.label !== 'string') continue;
      // A joiner signs nothing of its own, so its answer goes where it was routed, whatever its record says now.
      const engineRef = kept.joins ? { ask: kept.ask?.id, options: kept.options } : views.questions[id].question?.data?.engine ?? { ask: kept.ask?.id, options: {} };
      answered.push({ key: id, kept, answer: answerFor(engineRef, answer.label, answer.words) });
    }
    for (const [key, kept] of Object.entries(state.approvals)) {
      // A parked pull request's run has ended: its approval goes to the queue instead (`parks`).
      if (state.delivered[key] || kept.parked) continue;
      const [pr, sha] = key.split(':');
      if (!views.approvals?.[pr]?.[sha]) continue;
      answered.push({ key, kept, answer: kept.approve ? { ask: kept.ask.id, choice: kept.approve } : null });
    }
    for (const { key, kept, answer } of answered) {
      const label = views.questions?.[key]?.answer?.label;
      const stops = answer?.choice === STOP || STOPS_WORK.has(label);
      if (!stopped() && overtaken(kept, views)) {
        state.delivered[key] = 'overtaken';
        keep();
        drop(kept.work, key);
        await note(`Your answer about ${titled(kept.work)} wasn't used: the work was queued again since, and that run doesn't carry on.`, { work: kept.work });
        continue;
      }
      if (kept.cap) {
        if (stopped()) continue;
        const more = label === MORE;
        if (more) {
          enter({ work: kept.work, lane: kept.lane, via: 'more', key, runId: kept.runId });
          if (!hasPlace(kept.work, key, views)) continue;
        }
        const again = state.delivered[key] === GOING;
        state.delivered[key] = GOING;
        keep();
        // A Give it more with no place after all stays to be carried out on a later tick.
        if ((await capAnswer(kept, label, key, again)) === false) continue;
        state.delivered[key] = 'answered';
        keep();
        continue;
      }
      if (stopped()) {
        // Unheard, it is looked at again on the next tick: nothing is told or kept on a guess.
        const record = await inspect(kept.runId);
        if (!record) continue;
        state.delivered[key] = 'stop';
        const over = record.status === 'ended';
        if (over && stops) letGo(kept.work);
        else if (over && answer) {
          // Its run is gone, so nothing goes back; Carry on starts it on its branch with this answer in its order.
          const said = typeof answer.words === 'string' ? answer.words : label;
          const question = questionOf(kept.ask);
          const answers = [...(state.answers[kept.work] ?? []), ...(question && typeof said === 'string' ? [{ question, answer: said }] : [])];
          carryOver(kept.work, { branch: record.branch ?? placeOf(kept.ask).branch, answers });
        }
        drop(kept.work, key);
        // The ask is still open in the engine unless All stop cancelled its run: it comes back as a new card once All stop is lifted.
        if (!over && kept.ask?.type === 'ask') state.later.push(kept.ask);
        keep();
        await note(over
          ? `All stop was on when you answered about ${titled(kept.work)}, and it had cancelled that work, so the answer isn't used. What the work did is kept on its branch.`
          : `All stop was on when you answered about ${titled(kept.work)}, so the build didn't get that answer; the question comes back once All stop is lifted.`, { work: kept.work });
        continue;
      }
      // Stopped at its cap by the director: the record has ended it, so no answer goes back to carry it on.
      if (state.capped[kept.runId]?.stopped === true) {
        state.delivered[key] = 'stopped';
        keep();
        drop(kept.work, key);
        await note(`Your answer about ${titled(kept.work)} wasn't sent: you stopped it at its cap, so it doesn't carry on.`, { work: kept.work });
        continue;
      }
      // Held at its cap: sent once Give it more lifts the hold.
      if (held(kept.runId)) continue;
      // A piece that ended left the bundle: the answer goes to the rest, and of this one nothing is said.
      // An answer already sent goes on below, so what follows from it still follows.
      if (state.sending[key] !== true && bundled(key, kept) && (views.runs?.[kept.work] ?? []).filter((r) => r?.data?.runId === kept.runId).at(-1)?.data?.state === 'ended') {
        state.delivered[key] = 'ended';
        keep();
        drop(kept.work, key);
        if (stops) letGo(kept.work);
        continue;
      }
      if (!answer) {
        state.delivered[key] = 'nothing';
        keep();
        continue;
      }
      const runLane = laneOf(kept, views);
      if (!stops && runLane !== FIX_LANE && runLane !== 'merge' && kept.work !== MERGE_WORK) {
        // The piece comes back once, with both answers, when a second card of it is still open.
        if (waitingOn().has(kept.work)) continue;
        // Its work ended with this run still paused: nothing is left to carry on, and only the end of the run gives its place back.
        if (endedBy(views.reports, kept.work, views.work?.[kept.work]?.work)) {
          // Ended first: a crash or a refused write comes back here, and neither step minds being done twice.
          await cancelPaused(kept.runId, 'its work has ended');
          await endInRecord(kept);
          state.delivered[key] = 'ended';
          delete state.tries[key];
          delete state.sending[key];
          keep();
          drop(kept.work, key);
          await note(`Your answer about ${titled(kept.work)} wasn't sent: that work has ended, so nothing carries on from it.`, { work: kept.work });
          continue;
        }
        enter({ work: kept.work, lane: runLane, via: 'answer', key, runId: kept.runId });
        if (!hasPlace(kept.work, key, views)) continue;
      }
      // Marked before it is sent. An answer the engine refuses after that was taken the first time: the reply was lost,
      // or a crash came first, and what follows from it must still follow.
      const sentBefore = state.sending[key] === true;
      state.sending[key] = true;
      keep();
      let got = await answerEngine(kept.runId, answer);
      if (!got.ok && got.unreachable !== true && sentBefore) {
        // Unheard before, it may never have got there: what follows still follows, but it decides nothing later.
        if (state.tries[key] > 0) state.unsure[key] = true;
        got = { ok: true };
      }
      if (!got.ok && got.unreachable === true) {
        // Not delivered: sent again on the next tick, and said once.
        state.tries[key] = (state.tries[key] ?? 0) + 1;
        keep();
        if (state.tries[key] === UNREACHABLE_SAID) await note(`The build couldn't take your answer about ${titled(kept.work)} yet; it keeps trying.`, { work: kept.work });
        continue;
      }
      state.delivered[key] = got.ok ? 'answered' : 'refused';
      delete state.tries[key];
      delete state.sending[key];
      keep();
      if (got.ok) delivered(kept.work, key);
      else drop(kept.work, key);
      if (got.ok && answer.choice === STOP) letGo(kept.work);
      if (got.ok && typeof kept.ask?.mergeChoice === 'string' && answer.choice === kept.ask.mergeChoice) mergeRuled();
      const move = got.ok && runLane === 'bug' && kept.ask?.kind === 'blocked' && kept.ask?.topic === BIGGER && Object.hasOwn(MOVES, answer.choice) ? MOVES[answer.choice] : undefined;
      if (move) {
        letGo(kept.work);
        keep();
        await note(`${titleOf(kept.work)} is bigger than a bug, so it stops in the bug lane; the First Mate records it as ${move} and asks you to approve it.`, { work: kept.work });
        continue;
      }
      if (got.ok && answer.choice !== STOP && startsAgain(kept, runLane)) {
        const said = typeof answer.words === 'string' ? answer.words : label;
        const question = questionOf(kept.ask);
        state.reworks[kept.runId] = { work: kept.work, answer: answer.choice !== REWORK && question && typeof said === 'string' ? { question, answer: said } : null };
      }
      keep();
      if (!got.ok) await note(`Your answer about ${titled(kept.work)} wasn't needed: the build had already moved on.`, { work: kept.work });
    }
  }

  // A paused run's cancel keeps its worktree; abandoning it would remove the uncommitted work. An engine built without the
  // patch for paused runs refuses, and the run stays paused there, spending nothing. Either way `endInRecord` ends it,
  // which gives back its build slot.
  const cancelPaused = async (runId, reason) => (await safely(() => engine.act(runId, { cancel: { reason } })))?.ok === true;
  async function endInRecord(kept) {
    const records = (viewsNow().runs?.[kept.work] ?? []).filter((r) => r?.data?.runId === kept.runId);
    const latest = records.at(-1)?.data ?? {};
    const branch = latest.branch ?? records.find((r) => r.data.branch)?.data.branch ?? kept.branch ?? null;
    if (latest.state === 'ended') return;
    await write('run', {
      work: kept.work, lane: latest.lane ?? kept.lane, engine: latest.engine ?? engine.name ?? 'engine',
      runId: kept.runId, state: 'ended', outcome: 'stopped', ...(branch ? { branch } : {}),
    });
  }

  // The cap card for a run stopped at its cap (or one the engine itself stopped on its budget).
  async function capped({ runId, work, lane, branch, reached, stuck = null, paused = false }) {
    if (state.capped[runId]) return;
    const n = (state.next[work] ?? ENGINE_QUESTIONS) + 1;
    state.next[work] = n;
    const id = `q-${work}-${n}`;
    state.capped[runId] = { question: id, reached, ...(paused ? { held: true } : {}) };
    state.questions[id] = { cap: true, runId, work, lane, branch };
    const amount = reached.cap === 'minutes' ? `${reached.limit} minutes of work` : `${reached.limit.toLocaleString('en-GB')} tokens`;
    state.capsOwed[id] = {
      id, work, level: 3,
      what: paused
        ? `${titleOf(work)} reached its cap of ${amount} while it was waiting, so Wheelhouse is holding it there: it spends nothing while it waits, and it doesn't carry on unless you give it more. What it has done so far is kept.`
        : stuck
        ? `${titleOf(work)} reached its cap of ${amount}, and the build engine didn't stop it when asked twice, so Wheelhouse ended its processes${stuck.survivors?.length ? `, though some are still running: ${stuck.survivors.join(', ')}` : ''}. What it has done so far is kept.`
        : `${titleOf(work)} reached its cap of ${amount}, so it was stopped. What it has done so far is kept.`,
      why: stuck
        ? 'A run the build engine won\'t stop is yours to look at, and spending more than the cap allows is yours to decide, at level 3.'
        : 'Spending more than the cap allows is yours to decide, at level 3.',
      options: [
        { label: MORE, says: 'It carries on from what is there, with the cap raised by half, once.' },
        { label: STOP_LABEL, says: 'It stays stopped; the work waits in the queue.' },
      ],
      recommendation: STOP_LABEL,
      engine: { runId, ask: `cap:${runId}`, options: { [MORE]: 'more', [STOP_LABEL]: 'stop' } },
    };
    keep();
    await writeCapCard(id);
  }
  // Owed until it is written, so a record that refuses it costs a tick and never the card.
  async function writeCapCard(id) {
    const { work, engine: { runId } } = state.capsOwed[id];
    await write('question', state.capsOwed[id]);
    delete state.capsOwed[id];
    keep();
    const { branch } = state.questions[id] ?? {};
    sealCard({ id, kind: 'cap', work, runId, level: 3, branch: branch ?? null, folder: null });
  }
  async function owedCaps() {
    const { questions } = viewsNow();
    if (!isPlain(questions)) return;
    for (const id of Object.keys(state.capsOwed)) {
      if (isPlain(questions[id])) {
        delete state.capsOwed[id];
        keep();
      } else await writeCapCard(id).catch(() => {});
    }
  }

  // `again` is a Give it more that a crash cut short: a run already carrying on needs nothing more.
  async function capAnswer(kept, label, key, again = false) {
    if (label !== MORE) {
      letGo(kept.work);
      if (held(kept.runId)) {
        const cancelled = await cancelPaused(kept.runId, 'the director stopped it at its cap');
        state.capped[kept.runId].held = false;
        state.capped[kept.runId].stopped = true;
        // Its asks not yet shown never become cards.
        state.later = state.later.filter((ask) => ask.runId !== kept.runId);
        state.waiting = state.waiting.filter((w) => w.runId !== kept.runId);
        keep();
        await endInRecord(kept);
        await note(`${titleOf(kept.work)} stays stopped, as you chose. ${cancelled ? 'It' : 'It stays paused in the build engine, spending nothing, and'} no longer holds a build slot; what it has done so far is kept on its branch.`, { work: kept.work });
        return;
      }
      await note(`${titleOf(kept.work)} stays stopped, as you chose.`, { work: kept.work });
      return;
    }
    if (held(kept.runId)) {
      // The hold is lifted and the run is looked at against its raised cap again from now on.
      delete state.capped[kept.runId];
      state.carried[kept.runId] = { raised: true, runs: state.carried[kept.runId]?.runs ?? [] };
      keep();
      // A run paused on an ask carries on once it is answered; one paused on nothing the runner knows is resumed.
      const asking = (k) => k.runId === kept.runId && !k.cap;
      const open = state.later.some((a) => a.runId === kept.runId) || state.waiting.some(asking)
        || Object.entries(state.questions).some(([key, k]) => asking(k) && !state.delivered[key])
        || Object.entries(state.approvals).some(([key, k]) => asking(k) && !state.delivered[key]);
      if (!open) await safely(() => engine.act(kept.runId, { resume: {} }));
      delivered(kept.work, key);
      return;
    }
    const record = await inspect(kept.runId);
    if (again && record?.status === 'running') {
      delete state.capped[kept.runId];
      state.carried[kept.runId] = { raised: true, runs: state.carried[kept.runId]?.runs ?? [] };
      keep();
      delivered(kept.work, key);
      return;
    }
    if (record?.outcome === 'failed' || record?.status === 'paused') {
      const got = await safely(() => engine.act(kept.runId, { resume: {} }));
      if (got?.ok) {
        delete state.capped[kept.runId];
        state.carried[kept.runId] = { raised: true, runs: state.carried[kept.runId]?.runs ?? [] };
        keep();
        delivered(kept.work, key);
        return;
      }
    }
    // Refused, it stays on the way back: the dispatcher says so, and the place goes back until it is tried again.
    const got = await startAdmitted({
      work: kept.work, key, lane: kept.lane, branch: kept.branch ?? null, carryOn: true, raised: true,
      carried: { raised: true, runs: [...(state.carried[kept.runId]?.runs ?? []), kept.runId] },
    });
    return got?.noPlace !== true;
  }

  // Cancelled, tried once more if the engine didn't take it; a run still going after that has its processes ended, as
  // All stop ends them, so it can't spend past its cap unseen. Gives what was ended ({ ended, survivors }), or null.
  async function stopAtCap(runId, reached) {
    const cancel = () => safely(() => engine.act(runId, { cancel: { reason: `the run reached its ${reached.cap} cap` } }));
    if ((await cancel())?.ok !== true && (await cancel())?.ok !== true && (await inspect(runId))?.status !== 'ended') {
      return (await safely(() => endRun(runId))) ?? { ended: [], survivors: [] };
    }
    return null;
  }

  // Each running run of the project, against its caps; each ended one, its cost record.
  async function caps() {
    const v = viewsNow();
    const { capMinutes = {}, capTokens = {} } = settings() ?? {};
    for (const [work, list] of Object.entries(isPlain(v.runs) ? v.runs : {})) {
      // A reader's limits are its own (scripts/delegation/record-only.js): no cap reads it, and no piece pays for it.
      if (work === READER_WORK) continue;
      const byRun = new Map();
      for (const e of Array.isArray(list) ? list : []) if (typeof e?.data?.runId === 'string') (byRun.get(e.data.runId) ?? byRun.set(e.data.runId, []).get(e.data.runId)).push(e);
      for (const [runId, records] of byRun) {
        const latest = records.at(-1).data;
        if (latest.state === 'ended') {
          // However it ended: a hold in a run cancelled before its close lasts from here (routes.js).
          if (!state.reviewsKept[runId] && (await safely(() => keepReviews(runId))) === true) {
            state.reviewsKept[runId] = true;
            keep();
          }
          if (!state.costed[runId]) await costOf(runId, work, records);
          continue;
        }
        if (held(runId) && !stopped()) {
          // An answer that went back just before the hold was set can carry a held run on: it is stopped then.
          if ((await inspect(runId))?.status !== 'running') continue;
          state.capped[runId].held = false;
          keep();
          const stuck = await stopAtCap(runId, state.capped[runId].reached);
          await note(`${titleOf(work)} carried on past its cap while it was held, so it was stopped${stuck ? ' and its processes ended' : ''}.`, { work });
          continue;
        }
        if (latest.state !== 'started' || state.capped[runId] || stopped()) continue;
        const record = await inspect(runId);
        if (!record) continue;
        const carried = state.carried[runId] ?? { raised: false, runs: [] };
        const reached = capReached({
          lane: latest.lane, minutes: runningMinutes(records, now()), tokens: runCost(record).tokens,
          raised: carried.raised, carried: carriedSpend((v.costs?.[work] ?? []), carried.runs),
        }, { capMinutes, capTokens });
        if (!reached) continue;
        if (record.status === 'paused' && latest.lane !== FIX_LANE) {
          await capped({ runId, work, lane: latest.lane, branch: latest.branch ?? records.find((r) => r.data.branch)?.data.branch ?? null, reached, paused: true });
          continue;
        }
        const stuck = await stopAtCap(runId, reached);
        // A fix for a red main line asks no cap card: the dispatcher's card for a fix that didn't make it green asks
        // what next (dispatch-run.js).
        if (latest.lane === FIX_LANE) {
          state.capped[runId] = { reached };
          keep();
          await note(`The fix for the red main line reached its cap, so it was stopped${stuck ? ' and its processes ended' : ''}.`, { work });
          continue;
        }
        await capped({ runId, work, lane: latest.lane, branch: latest.branch ?? records.find((r) => r.data.branch)?.data.branch ?? null, reached, stuck });
      }
    }
  }

  async function costOf(runId, work, records) {
    const record = await inspect(runId);
    if (!record) return;
    const cost = runCost(record);
    state.costed[runId] = true;
    keep();
    await write('cost', {
      runId, work,
      // A run whose spend is unknown names no tokens it didn't count.
      tokens: cost.source === 'unknown' && cost.tokens === 0 ? null : cost.tokens,
      dollars: cost.dollars, floorDollars: cost.floorDollars, premiumRequests: cost.premiumRequests,
      minutes: cost.minutes > 0 ? cost.minutes : runningMinutes(records, now()), source: cost.source, byRole: cost.byRole,
      ...(cost.kinds ? { kinds: cost.kinds } : {}),
    });
  }

  // Work the director answered at a blocked exit starts again on its branch once its run has ended, carrying on from
  // what is there, with its cap not raised, the spend so far still counted against it, and the director's answers
  // so far in its order, from this record alone.
  async function reworks() {
    if (stopped()) return;
    for (const [runId, { work, answer }] of Object.entries(state.reworks)) {
      const records = (viewsNow().runs?.[work] ?? []).filter((r) => r?.data?.runId === runId);
      const latest = records.at(-1)?.data;
      if (latest?.state !== 'ended') continue;
      const lane = latest.lane ?? workOf(runId)?.lane;
      const branch = latest.branch ?? records.find((r) => r.data.branch)?.data.branch ?? null;
      const answers = [...(state.answers[work] ?? []), ...(answer ? [answer] : [])];
      // Entered before it is cleared: an entry is idempotent, so a crash between the two loses nothing.
      enter({ work, lane, via: 'rework', key: `rework:${runId}`, branch, carryOn: true, raised: false, answers, carried: { raised: false, runs: [...(state.carried[runId]?.runs ?? []), runId] } });
      delete state.reworks[runId];
      state.answers[work] = answers;
      keep();
    }
  }

  // Asks held while All stop was on are routed again once it is lifted, and a held run's once its hold is.
  async function again() {
    if (stopped() || state.later.length === 0) return;
    const later = state.later.filter((ask) => !held(ask.runId) && !reading.has(ask.id));
    if (later.length === 0) return;
    state.later = state.later.filter((ask) => !later.includes(ask));
    for (const ask of later) delete state.routed[ask.id];
    // An approval keeps its key, so its answer under All stop mustn't stand against the same ask asked again.
    const askedAgain = new Set(later.map((ask) => ask.id));
    for (const [key, kept] of Object.entries(state.approvals)) if (askedAgain.has(kept.ask?.id) && state.delivered[key] === 'stop') delete state.delivered[key];
    keep();
    // A run All stop cancelled has nothing left to ask.
    for (const ask of later) if ((await inspect(ask.runId))?.status !== 'ended') await onAsk(ask);
  }

  return {
    file,
    onAsk,
    onMatch,
    capped,
    async tick() {
      await deliver();
      await reworks();
      for (const id of Object.keys(state.repeats)) await sendEarlier(id);
      await again();
      await parks();
      await owedCaps();
      await caps();
      await show();
    },
    // How the runner asks for a place back: the dispatcher's `enter`.
    onEnter(fn) { if (typeof fn === 'function') enter = fn; },
    // A run on the way back has started, carrying these figures.
    started(runId, carried) {
      if (!isPlain(carried)) return;
      state.carried[runId] = carried;
      keep();
    },
    // Told when an answer to the merge queue's question merges: the queue is then due at once.
    onMergeRuled(fn) { if (typeof fn === 'function') mergeRuled = fn; },
    // What a run carries: { raised, runs } (the runs before it whose spend counts against its caps).
    carried: (runId) => state.carried[runId] ?? null,
    questionOf: (runId) => state.capped[runId]?.question ?? null,
    // The pieces with a cap card still to be written, which the dispatcher mustn't ask about a second time.
    owedWork: () => new Set(Object.values(state.capsOwed).map((card) => card.work)),
    // The pull requests the queue has left alone until the director approves them, { [pr]: head }.
    parkedHeads: () => Object.fromEntries(Object.entries(state.parked).filter(([, kept]) => kept.taken && !kept.handed).map(([pr, kept]) => [pr, kept.head])),
    // The pieces with a card of the router's open. Views that can't be read name none, so each keeps its place.
    waitingWork: () => waitingOn(),
    // The pieces whose run an answer is ending, to start again on its branch.
    reworkWork: () => Object.values(state.reworks).map((r) => r.work),
    // The written cards behind them, [{ id, work, rank }]. Views that can't be read name none.
    openCards() {
      let views;
      try { views = readViews() ?? {}; } catch { return []; }
      return routerCards({ state, views, prWork: (pr) => openedOf(pr)?.work ?? null });
    },
  };
}
