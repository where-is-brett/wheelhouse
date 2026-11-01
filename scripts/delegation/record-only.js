// scripts/delegation/record-only.js
// The seals beside the card router (delegated decisions design, section 15, part 1). It changes no outcome: `onCard`
// only queues, after the card is written, and `tick` reads the facts and signs a `shadow` line, away from `engineTick`,
// with one tick at a time. A card a reader may read is then kept in `open` until it is scored against the director's
// answer, in a line of its own. A failure here costs a seal or a score, never a card, and says nothing to the director.
// What waits is kept in `file`, so a helper started again seals and scores each card once.
import fs from 'node:fs';
import path from 'node:path';
import { sealOf, scoreOf, scoreLine, firstLines } from './seal.js';
import { setupStamp } from './stamp.js';
import { SEAL_TICK_MS, FACT_TRIES, SEAL_TRIES, SCORE_WAIT_DAYS } from './limits.js';
import { UNREAD_FACTS } from './facts.js';
import { verify } from '../state/signing.js';
import { answerLine } from '../state/card-lines.js';
import { SUGGEST } from '../lib/calm-words.js';
import { PUT_OFF } from '../lib/front-desk.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const EMPTY = () => ({ waiting: [], sealed: {}, tries: {}, fails: {}, open: {} });
const DAY_MS = 24 * 60 * 60 * 1000;

function readState(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isPlain(kept) || !Array.isArray(kept.waiting) || !isPlain(kept.sealed) || !isPlain(kept.tries) || !isPlain(kept.fails)) return EMPTY();
    return { ...kept, open: isPlain(kept.open) ? kept.open : {} };
  } catch {
    return EMPTY();
  }
}

// What a card's context can say today: a done check where the project has a test command, and whether another question
// on the same work is open. A candidate that needs more gives null.
export function cardContext({ views, card, testCommand }) {
  const open = Object.entries(views?.questions ?? {}).some(([id, q]) => id !== card.id && q?.question?.data?.work === card.work && !isPlain(q.answer));
  return { doneCheck: testCommand ?? undefined, openDecision: open };
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

// recordOnly({ file, write, stopped, now, factsOf, contextOf, stampOf, history }) -> { onCard(card), tick(), settled() }.
// - `write(kind, data)` a signed record in the project's history; `stopped()` whether nothing should be read now;
// - `factsOf(card)` the change's facts (facts.js); `contextOf(card)` what the candidates read beside them;
// - `stampOf()` the setup's stamp (stamp.js); `history()` the signed record, as historyOf gives it, or null. `card` is
//   { id, kind, work, runId?, level, branch?, folder? }.
export function recordOnly({ file, write, stopped = () => false, now = () => new Date(), factsOf = async () => UNREAD_FACTS, contextOf = () => ({}), stampOf = () => setupStamp(), history = () => null } = {}) {
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
      const seal = sealOf({ card, facts, ctx, stamp: quietly(stampOf, setupStamp()), at: now().toISOString() });
      writing.add(card.id);
      try {
        await write('shadow', seal);
        state.sealed[card.id] = true;
        if (seal.reader === true) state.open[card.id] = seal.at;
        forget(card.id);
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

  function tick() {
    const at = now().getTime();
    if (flight !== null && at - startedAt < SEAL_TICK_MS) return Promise.resolve();
    if ((state.waiting.length === 0 && Object.keys(state.open).length === 0) || stopped()) return Promise.resolve();
    const mine = {};
    flight = mine;
    startedAt = at;
    going = look(mine).then(() => score(mine)).catch(() => {}).finally(() => {
      if (flight === mine) flight = null;
    });
    return going;
  }

  return { onCard, tick, settled: () => going };
}
