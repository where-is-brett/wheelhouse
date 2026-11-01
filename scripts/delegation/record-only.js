// scripts/delegation/record-only.js
// The seals beside the card router (delegated decisions design, section 15, part 1). It changes no outcome: `onCard`
// only queues, after the card is written, and `tick` reads the facts and signs a `shadow` line, away from `engineTick`,
// with one tick at a time. A question card's view is built when it is sealed, and frozen; one reader at a time reads the
// cards that wait, with its tokens under its own line. A reader that can't run, or ends with no reading, leaves a
// `reader: 'none'` line and the card as it was. A card a reader may read is kept in `open` until it is scored against the
// director's answer, in a line of its own. A reading that names a card as the same decision is handed on, and what comes
// of it can only help the director (asked.js, closeMatch). A failure here costs a seal, a reading or a score, never a card, and says
// nothing to the director. What waits is kept in `file`, so a helper started again seals and scores each card once.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canBeRead, readingOf, sealOf, scoreOf, scoreLine, firstLines } from './seal.js';
import { setupStamp } from './stamp.js';
import { SEAL_TICK_MS, FACT_TRIES, SEAL_TRIES, SCORE_WAIT_DAYS, READER_MS, READER_TOKENS, READER_UNKNOWN_MS, READERS_WAITING_MOST } from './limits.js';
import { UNREAD_FACTS } from './facts.js';
import { READER_LANE, READER_WORK, mayRead, readerResult } from './reader.js';
import { runCost } from '../engine/spend.js';
import { verify } from '../state/signing.js';
import { answerLine } from '../state/card-lines.js';
import { SUGGEST } from '../lib/calm-words.js';
import { PUT_OFF } from '../lib/front-desk.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// `reading`: the cards a reader is yet to read, each with its frozen view; `reader`: the one under way; `lines`: reading
// lines yet to be written; `open`: the cards waiting for a score; `matches`: close matches yet to be handed on.
const EMPTY = () => ({ waiting: [], sealed: {}, tries: {}, fails: {}, open: {}, reading: [], reader: null, lines: [], matches: [] });
// The statuses of a run that hasn't ended.
const GOING = ['running', 'pending', 'paused'];
const DAY_MS = 24 * 60 * 60 * 1000;

function readState(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isPlain(kept) || !Array.isArray(kept.waiting) || !isPlain(kept.sealed) || !isPlain(kept.tries) || !isPlain(kept.fails)) return EMPTY();
    return { ...EMPTY(), ...kept, open: isPlain(kept.open) ? kept.open : {} };
  } catch {
    return EMPTY();
  }
}

// What a card's context can say today: a done check where the project has a test command, whether another question on
// the same work is open, and the card's lane, options and work's level, which a rule's scope reads. A candidate that needs more gives null.
export function cardContext({ views, card, testCommand }) {
  const open = Object.entries(views?.questions ?? {}).some(([id, q]) => id !== card.id && q?.question?.data?.work === card.work && !isPlain(q.answer));
  const work = views?.work?.[card.work]?.work?.data;
  return { doneCheck: testCommand ?? undefined, openDecision: open, lane: work?.lane, workLevel: work?.level, options: views?.questions?.[card.id]?.question?.data?.options };
}

// The lines of the cards on which the director stepped out of the options: a Suggest a change…, however the click named
// its card, words typed in place of an option, or a pick of Suggest in the chat, which writes only `chat-steer`.
function steppedOut(events) {
  const answers = events.filter((e) => e.kind === 'card-answer');
  const told = new Set(events.filter((e) => e.kind === 'chat-steer').map((e) => e.data?.card));
  const out = new Set();
  for (const card of events.filter((e) => e.kind === 'card' && typeof e.data?.line === 'string')) {
    const offered = Array.isArray(card.data.options) ? card.data.options : [];
    const leaves = (label) => label === SUGGEST || (typeof label === 'string' && !PUT_OFF.includes(label) && !offered.includes(label));
    const mine = (a) => a.at >= card.at && [a.data?.card, a.data?.question].some((name) => name === card.id || name === card.data.question);
    if (told.has(card.id) || answers.some((a) => mine(a) && leaves(a.data?.label))) out.add(card.data.line);
  }
  return out;
}

// What the signed record says of a card, for scoring. `lines(id)` its first seal, reading and score, from lines this
// computer can verify; `answer(id)` its answer, and whether the director stepped out of the options on any of its cards.
export function historyOf({ events, enrolled, views }) {
  const lines = firstLines(events.filter((e) => e.kind === 'shadow' && typeof e.data?.card === 'string' && verify(e, enrolled)));
  const steered = steppedOut(events);
  return {
    lines: (id) => lines.get(id) ?? {},
    answer: (id) => ({ answer: views?.questions?.[id]?.answer ?? null, steered: steered.has(answerLine(id)) }),
  };
}

// A view's hash, which the reading line keeps in its place: the view itself stays out of the record.
const viewHash = (view) => crypto.createHash('sha256').update(JSON.stringify(view)).digest('hex');

// recordOnly({ file, write, stopped, now, factsOf, contextOf, stampOf, rulesOf, history, engine, readViews, viewOf, startReader, gate, trusted, onMatch })
//   -> { onCard(card), tick(), settled(), viewFor(card id), readerOf(run id), onReaderAsk(ask), reading() }.
// - `write(kind, data)` a signed record in the project's history; `stopped()` whether nothing should be read now;
// - `factsOf(card)` the change's facts (facts.js); `contextOf(card)` what the candidates read beside them;
// - `stampOf()` the setup's stamp (stamp.js); `rulesOf()` what a seal may earn evidence for (rules.js); `history()` the signed record, as historyOf gives it, or null. `card` is
//   { id, kind, work, runId?, level, branch?, folder? };
// - `viewOf(card, facts)` the card's view (view.js), and with no `viewOf` no reader runs; `startReader(card)` starts one,
//   { ok, runId } or a refusal; `gate()` { running, pace, counted, incident }; `trusted(record)` whether a run's pack is the
//   installed one; `readViews()` the project's views; `engine` { inspect, outputs, act }; `onMatch({ card, sameAs })` is told
//   of a close match, and one that throws is tried again.
export function recordOnly({
  file, write, stopped = () => false, now = () => new Date(), factsOf = async () => UNREAD_FACTS, contextOf = () => ({}), stampOf = () => setupStamp(), rulesOf = () => [], history = () => null,
  engine = null, readViews = () => ({}), viewOf = null, startReader = async () => ({ ok: false, refused: 'nothing starts a reader here' }), gate = () => ({ running: 0, pace: 0 }), trusted = () => true, onMatch = async () => {},
} = {}) {
  const state = readState(file);
  function keep() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  const quietly = (fn, otherwise) => {
    try { return fn(); } catch { return otherwise; }
  };
  const forget = (id) => {
    state.waiting = state.waiting.filter((c) => c.id !== id);
    delete state.tries[id];
    delete state.fails[id];
  };

  function onCard(card) {
    quietly(() => {
      if (!isPlain(card) || typeof card.id !== 'string' || state.sealed[card.id] || state.waiting.some((c) => c.id === card.id)) return;
      state.waiting.push(card);
      keep();
    });
  }

  async function factsFor(card, tried) {
    if (tried > FACT_TRIES) return UNREAD_FACTS;
    return (await Promise.resolve().then(() => factsOf(card)).catch(() => null)) ?? UNREAD_FACTS;
  }

  // Whether a card's change may yet be read: it has a place to read, and said nothing of a head.
  const worthAnotherTry = (card, facts, tried) => facts.readable !== true && facts.head === undefined && Boolean(card.branch && card.folder) && tried <= FACT_TRIES;

  // One look over what waits. `flight` is this look's own mark: a look given up for hanging stops where it wakes, so
  // it can't write beside the one that took over. `writing` holds the seal a given-up look may still be writing.
  let flight = null;
  let startedAt = 0;
  let going = Promise.resolve();
  const writing = new Set();
  async function look(mine) {
    for (const card of [...state.waiting]) {
      if (mine !== flight || stopped()) return;
      if (writing.has(card.id)) continue;
      if ((state.fails[card.id] ?? 0) >= SEAL_TRIES) {
        forget(card.id);
        quietly(keep);
        continue;
      }
      const tried = (state.tries[card.id] ?? 0) + 1;
      state.tries[card.id] = tried;
      quietly(keep);
      const facts = await factsFor(card, tried);
      if (mine !== flight || stopped()) return;
      if (worthAnotherTry(card, facts, tried)) continue;
      // Facts in hand: a write that fails doesn't count against reading them.
      if (facts.readable === true) delete state.tries[card.id];
      const ctx = quietly(() => contextOf(card), {}) ?? {};
      const view = viewOf && canBeRead(card) ? await Promise.resolve().then(() => viewOf(card, facts)).catch(() => ({ refused: 'the view couldn\'t be built' })) : null;
      if (mine !== flight || stopped()) return;
      const rules = quietly(rulesOf, []);
      const seal = sealOf({ card, facts, ctx, stamp: quietly(stampOf, setupStamp()), at: now().toISOString(), refused: Boolean(view?.refused), rules });
      writing.add(card.id);
      try {
        await write('shadow', seal);
        state.sealed[card.id] = true;
        if (seal.reader === true) state.open[card.id] = seal.at;
        forget(card.id);
        if (view && !view.refused) awaitReader(card, view);
      } catch {
        // Tried again on the next tick, and given up after SEAL_TRIES.
        state.fails[card.id] = (state.fails[card.id] ?? 0) + 1;
      }
      writing.delete(card.id);
      quietly(keep);
    }
  }

  const closeScore = (id) => {
    delete state.open[id];
    delete state.fails[id];
  };

  // One look over the cards waiting for a score. A reading may come after the answer, so a card with an answer and no
  // reading stays open, and a reader that gave nothing closes it with no score.
  async function score(mine) {
    if (mine !== flight || Object.keys(state.open).length === 0) return;
    const record = quietly(history, null);
    if (record === null) return;
    for (const [id, sealedAt] of Object.entries(state.open)) {
      if (mine !== flight || stopped()) return;
      if (writing.has(id)) continue;
      if ((state.fails[id] ?? 0) >= SEAL_TRIES || now().getTime() - Date.parse(sealedAt) > SCORE_WAIT_DAYS * DAY_MS) {
        closeScore(id);
        quietly(keep);
        continue;
      }
      const { seal, reading, score: scored } = quietly(() => record.lines(id), {});
      const { answer = null, steered = false } = quietly(() => record.answer(id), null) ?? {};
      if (!seal || (!answer && !steered) || (!reading && !scored)) continue;
      const result = scored ? null : scoreOf({ seal, reading, answer: answer ?? { label: SUGGEST }, steered });
      if (result === null) {
        closeScore(id);
        quietly(keep);
        continue;
      }
      writing.add(id);
      try {
        await write('shadow', scoreLine({ seal, score: result, at: now().toISOString() }));
        closeScore(id);
      } catch {
        // Tried again on the next tick, and given up after SEAL_TRIES.
        state.fails[id] = (state.fails[id] ?? 0) + 1;
      }
      writing.delete(id);
      quietly(keep);
    }
  }

  // A line with why a card has no reading, or with its reading; written by `say`, so a failed write is tried again.
  const noReading = (entry, why, extra = {}) => state.lines.push({ tries: 0, ...readingOf({ card: entry.card, work: entry.work, why, at: now().toISOString(), ...extra }) });

  function awaitReader(card, view) {
    if (state.reading.length >= READERS_WAITING_MOST) noReading({ card: card.id, work: card.work }, 'too-many-waiting');
    else state.reading.push({ card: card.id, work: card.work, view });
  }

  async function say() {
    for (const { tries, ...line } of [...state.lines]) {
      const entry = state.lines.find((l) => l.hash === line.hash);
      try {
        await write('shadow', line);
        state.lines = state.lines.filter((l) => l !== entry);
      } catch {
        entry.tries = tries + 1;
        if (entry.tries >= SEAL_TRIES) state.lines = state.lines.filter((l) => l !== entry);
      }
      quietly(keep);
    }
  }

  async function handOn() {
    for (const entry of [...state.matches]) {
      const { tries, ...match } = entry;
      try {
        await onMatch(match);
        state.matches = state.matches.filter((m) => m !== entry);
      } catch {
        entry.tries = tries + 1;
        if (entry.tries >= SEAL_TRIES) state.matches = state.matches.filter((m) => m !== entry);
      }
      quietly(keep);
    }
  }

  // The tokens a reader spent, under its own line: against no piece and no cap.
  async function spend(runId, record, minutes) {
    const cost = runCost(record);
    await Promise.resolve().then(() => write('cost', {
      runId, work: READER_WORK,
      tokens: cost.source === 'unknown' && cost.tokens === 0 ? null : cost.tokens,
      dollars: cost.dollars, floorDollars: cost.floorDollars, premiumRequests: cost.premiumRequests,
      minutes: cost.minutes > 0 ? cost.minutes : minutes, source: cost.source, byRole: cost.byRole,
      ...(cost.kinds ? { kinds: cost.kinds } : {}),
    })).catch(() => {});
  }

  // Ends the reader under way, with its reading or why there is none.
  function endReader(fields) {
    const { card, work, run, view } = state.reader;
    const answered = quietly(() => isPlain(readViews()?.questions?.[card]?.answer), false);
    noReading({ card, work }, fields.reading ? null : fields.why, { run, reading: fields.reading ?? null, view: viewHash(view), afterAnswer: answered === true });
    if (fields.reading?.sameAs) state.matches.push({ card, sameAs: fields.reading.sameAs, tries: 0 });
    state.reader = null;
    quietly(keep);
  }

  async function cancelReader(reason) {
    await Promise.resolve().then(() => engine.act(state.reader.run, { cancel: { reason } })).catch(() => {});
  }

  // One look at the reader under way: a run past its limits, or in trouble of its own, is cancelled, with no card.
  async function watchReader(mine) {
    const { run, started, trouble, view } = state.reader;
    const age = now().getTime() - started;
    const record = run ? await Promise.resolve().then(() => engine.inspect(run)).catch(() => null) : null;
    if (mine !== flight) return;
    const status = record?.status ?? 'unknown';
    if (status === 'unknown') {
      if (age < READER_UNKNOWN_MS) return;
      if (run) await cancelReader('the engine lost sight of the reader');
      endReader({ why: 'lost' });
      return;
    }
    if (GOING.includes(status)) {
      const past = age >= READER_MS || runCost(record).tokens > READER_TOKENS;
      if (!past && !trouble && status !== 'paused') return;
      await cancelReader('the reader went past its limit');
      await spend(run, record, age / 60_000);
      endReader({ why: past ? 'past-its-limit' : 'lost' });
      return;
    }
    await spend(run, record, age / 60_000);
    if (status === 'failed' || status === 'cancelled') {
      endReader({ why: status });
      return;
    }
    const outputs = await Promise.resolve().then(() => engine.outputs(run)).catch(() => null);
    const reading = outputs && quietly(() => trusted(record), false) === true ? readerResult(outputs, view.labels, view.cards) : null;
    endReader(reading ? { reading } : { why: 'no-reading' });
  }

  async function startNext(mine) {
    const next = state.reading[0];
    const open = quietly(gate, null);
    if (!next || !open || open.incident === true) return;
    if (open.counted === true) {
      state.reading.shift();
      noReading(next, 'counted');
      return;
    }
    if (!mayRead({ running: open.running, pace: open.pace, live: 0, counted: false })) return;
    // Named before the start: the run's first step asks for the view as soon as it has its ticket.
    state.reading.shift();
    state.reader = { ...next, run: null, started: now().getTime() };
    quietly(keep);
    const got = await Promise.resolve().then(() => startReader(next)).catch(() => null);
    if (mine !== flight) {
      if (got?.ok) await Promise.resolve().then(() => engine.act(got.runId, { cancel: { reason: 'another look took over' } })).catch(() => {});
      return;
    }
    if (got?.ok && typeof got.runId === 'string') state.reader.run = got.runId;
    else endReader({ why: 'no-start' });
  }

  async function readers(mine) {
    if (mine !== flight || stopped()) return;
    if (state.reader) await watchReader(mine);
    if (mine === flight && !state.reader && !stopped()) await startNext(mine);
    quietly(keep);
    if (mine === flight) await say();
    if (mine === flight && !stopped()) await handOn();
  }

  function tick() {
    const at = now().getTime();
    if (flight !== null && at - startedAt < SEAL_TICK_MS) return Promise.resolve();
    if (stopped() || (state.waiting.length === 0 && Object.keys(state.open).length === 0 && state.reading.length === 0 && !state.reader && state.lines.length === 0 && state.matches.length === 0)) return Promise.resolve();
    const mine = {};
    flight = mine;
    startedAt = at;
    going = look(mine).then(() => readers(mine)).then(() => score(mine)).catch(() => {}).finally(() => {
      if (flight === mine) flight = null;
    });
    return going;
  }

  return {
    onCard,
    tick,
    settled: () => going,
    // The view of the card being read, for its run's first step, and nothing for any other card.
    viewFor: (id) => (state.reader?.card === id ? state.reader.view : null),
    // The reader's run, named as the merge queue's are, so the engine's events on it are its own.
    readerOf: (runId) => (state.reader?.run === runId ? { work: READER_WORK, lane: READER_LANE, branch: null } : null),
    // An ask on a reader's run never becomes a card: its next look cancels it.
    onReaderAsk: (ask) => {
      if (state.reader?.run !== ask?.runId) return;
      state.reader.trouble = true;
      quietly(keep);
    },
    reading: () => (state.reader ? { card: state.reader.card, runId: state.reader.run } : null),
  };
}
