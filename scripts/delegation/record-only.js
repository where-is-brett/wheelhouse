// scripts/delegation/record-only.js
// The seals beside the card router (delegated decisions design, section 15, part 1). It changes no outcome: `onCard`
// only queues, after the card is written, and `tick` reads the facts and signs a `shadow` line, away from `engineTick`,
// with one tick at a time. A failure here costs a seal, never a card, and says nothing to the director. What waits is
// kept in `file`, so a helper started again seals each card once.
import fs from 'node:fs';
import path from 'node:path';
import { sealOf } from './seal.js';
import { setupStamp } from './stamp.js';
import { SEAL_TICK_MS, FACT_TRIES, SEAL_TRIES } from './limits.js';
import { UNREAD_FACTS } from './facts.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const EMPTY = () => ({ waiting: [], sealed: {}, tries: {} });

function readState(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlain(kept) && Array.isArray(kept.waiting) && isPlain(kept.sealed) && isPlain(kept.tries) ? kept : EMPTY();
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

// recordOnly({ file, write, stopped, now, factsOf, contextOf, stampOf }) -> { onCard(card), tick() }.
// - `write(kind, data)` a signed record in the project's history; `stopped()` whether nothing should be read now;
// - `factsOf(card)` the change's facts (facts.js); `contextOf(card)` what the candidates read beside them;
// - `stampOf()` the setup's stamp (stamp.js). `card` is { id, kind, work, runId?, level, branch?, folder? }.
export function recordOnly({ file, write, stopped = () => false, now = () => new Date(), factsOf = async () => UNREAD_FACTS, contextOf = () => ({}), stampOf = () => setupStamp() } = {}) {
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

  // One look over what waits. `flight` is this look's own mark: a look given up for hanging stops where it wakes, so
  // it can't write beside the one that took over.
  let flight = null;
  let startedAt = 0;
  async function look(mine) {
    for (const card of [...state.waiting]) {
      if (mine !== flight || stopped()) return;
      const tried = (state.tries[card.id] ?? 0) + 1;
      if (tried > SEAL_TRIES) {
        forget(card.id);
        quietly(keep);
        continue;
      }
      state.tries[card.id] = tried;
      quietly(keep);
      const facts = await factsFor(card, tried);
      if (mine !== flight || stopped()) return;
      const ctx = quietly(() => contextOf(card), {}) ?? {};
      const seal = sealOf({ card, facts, ctx, stamp: quietly(stampOf, setupStamp()), at: now().toISOString() });
      try {
        await write('shadow', seal);
      } catch {
        // Tried again on the next tick, and given up after SEAL_TRIES.
        continue;
      }
      state.sealed[card.id] = true;
      forget(card.id);
      quietly(keep);
    }
  }

  function tick() {
    const at = now().getTime();
    if (flight !== null && at - startedAt < SEAL_TICK_MS) return Promise.resolve();
    if (state.waiting.length === 0 || stopped()) return Promise.resolve();
    const mine = {};
    flight = mine;
    startedAt = at;
    return look(mine).catch(() => {}).finally(() => {
      if (flight === mine) flight = null;
    });
  }

  return { onCard, tick };
}
