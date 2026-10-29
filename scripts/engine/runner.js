// scripts/engine/runner.js
// The helper's side of the card router (Archon design, sections 8.3 and 8.4), for one project on the engine. Each new
// ask is routed: the table's answers and a delegation's go back at once, with a Logbook line; the rest become cards,
// written within the director's cards a day. A card is a build question (its answer card is signed by its question
// line) or a pull request's approval (signed as any approval is), so the signing that exists signs it. Each tick, the
// director's signed answers go back to the engine, once each; one the engine refuses closes with one plain line.
// Under All stop nothing goes back: an answer signed then never reaches the build, and its question is asked again
// after the lift. What it did is kept in `file`, so a helper started again routes nothing twice.
import fs from 'node:fs';
import path from 'node:path';
import { composeCard } from '../cards/compose.js';
import { routeAsk, cardBudget, bundleApprovals, answerFor, dayOf, ENGINE_QUESTIONS } from './router.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const EMPTY = () => ({ routed: {}, waiting: [], shown: { day: null, count: 0 }, questions: {}, approvals: {}, delivered: {}, later: [], next: {}, noted: null });

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

// engineRunner({ engine, file, readViews, write, stopped, now, settings, workOf, titleOf }) -> { onAsk, tick, file }.
// - `readViews()` the project's views (questions, approvals, levels), as the helper builds them;
// - `write(kind, data)` a record in the project's history; `stopped()` whether All stop is on;
// - `settings()` { cardsPerDay, bundleApprovals }; `workOf(runId)` { work, lane } from the project's run records;
// - `titleOf(work)` the work's title.
export function engineRunner({ engine, file, readViews, write, stopped = () => false, now = () => new Date(), settings = () => ({}), workOf = () => null, titleOf = (work) => work } = {}) {
  let state = readState(file);
  const keep = () => saveState(file, state);
  const note = (words, extra = {}) => write('note', { about: 'engine', words, ...extra });
  const titled = (work) => inSentence(String(titleOf(work) ?? work));

  async function answerEngine(runId, answer) {
    try {
      return (await engine.act(runId, { answer })) ?? { ok: false };
    } catch (error) {
      return { ok: false, refused: error instanceof Error ? error.message : 'unknown' };
    }
  }

  // Routes one ask (an `ask` EngineEvent), once.
  async function onAsk(ask) {
    if (!isPlain(ask) || typeof ask.id !== 'string' || state.routed[ask.id]) return;
    const found = workOf(ask.runId);
    const work = found?.work ?? ask.work;
    if (typeof work !== 'string') return;
    state.routed[ask.id] = true;
    let views = {};
    try { views = readViews() ?? {}; } catch { views = {}; }
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
      return;
    }
    if (routed.line) {
      keep();
      await note(routed.line, { work });
      return;
    }
    state.waiting.push({ importance: routed.importance, card: routed.card, work, runId: ask.runId, ask });
    keep();
    await show();
  }

  // Writes the waiting cards the day's budget has room for, and notes how many wait.
  async function show() {
    const today = dayOf(now());
    if (state.shown.day !== today) state.shown = { day: today, count: 0 };
    const { cardsPerDay = 3, bundleApprovals: bundling = false } = settings() ?? {};
    // Bundled approvals are shown together and count as one card; each is still its own signed approval.
    const groups = bundling
      ? bundleApprovals(state.waiting).map((g) => (g.card.bundle ? { importance: g.importance, items: state.waiting.filter((w) => w.card.approval && g.card.bundle.includes(w.card.approval)) } : { importance: g.importance, items: [g] }))
      : state.waiting.map((w) => ({ importance: w.importance, items: [w] }));
    const { show: shown, wait } = cardBudget({ cards: groups, cardsPerDay, shownToday: state.shown.count });
    for (const group of shown) {
      for (const item of group.items) {
        await writeCard(item);
        state.waiting = state.waiting.filter((w) => w !== item);
      }
      if (group.importance !== 0 && group.importance !== 2) state.shown.count += 1;
      keep();
    }
    const waiting = wait > 0 ? groups.filter((g) => !shown.includes(g)).reduce((n, g) => n + g.items.length, 0) : 0;
    if (state.noted !== waiting) {
      state.noted = waiting;
      keep();
      await write('note', { about: 'cards-waiting', count: waiting });
    }
  }

  async function writeCard({ card, work, runId, ask }) {
    if (card.approval) {
      const a = card.approval;
      const { card: composed } = composeCard({
        kind: 'approval', level: a.level === 4 ? 4 : 3, recommend: 'Approve',
        what: `Pull request #${a.pr} is ${titled(work)}, ready for you to look at before it is added.`,
        why: a.why, because: 'its checks passed and it is visible work, which you see first',
        meanwhile: 'Nothing is added until you approve it.',
        options: [{ label: 'Approve', says: 'It approves the change, and it is added to the product.' }],
        ...(a.level === 4 ? { checks: 'It changes no checks: the change is still checked before it is added.' } : {}),
        target: { pr: a.pr, sha: a.sha },
      });
      await write('card', composed);
      state.approvals[`${a.pr}:${a.sha}`] = { runId, ask, approve: a.engine.approve, work };
      return;
    }
    const q = card.question;
    const n = (state.next[work] ?? ENGINE_QUESTIONS) + 1;
    state.next[work] = n;
    const id = `q-${work}-${n}`;
    await write('question', {
      id, work, what: q.what, why: q.why, options: q.options, recommendation: q.recommendation ?? q.options[0]?.label, level: q.level,
      ...(q.level === 4 ? { checks: 'It changes no checks: the build still checks its work before it is added.' } : {}),
      engine: { runId, ask: ask.id, options: q.engine.options },
    });
    state.questions[id] = { runId, ask, work };
  }

  // Sends the director's signed answers to the engine, once each.
  async function deliver() {
    let views = {};
    try { views = readViews() ?? {}; } catch { views = {}; }
    const answered = [];
    for (const [id, kept] of Object.entries(state.questions)) {
      if (state.delivered[id]) continue;
      const answer = views.questions?.[id]?.answer;
      if (!isPlain(answer) || typeof answer.label !== 'string') continue;
      const engineRef = views.questions[id].question?.data?.engine ?? { ask: kept.ask.id, options: {} };
      answered.push({ key: id, kept, answer: answerFor(engineRef, answer.label, answer.words) });
    }
    for (const [key, kept] of Object.entries(state.approvals)) {
      if (state.delivered[key]) continue;
      const [pr, sha] = key.split(':');
      if (!views.approvals?.[pr]?.[sha]) continue;
      answered.push({ key, kept, answer: kept.approve ? { ask: kept.ask.id, choice: kept.approve } : null });
    }
    for (const { key, kept, answer } of answered) {
      if (stopped()) {
        state.delivered[key] = 'stop';
        // The ask is still open in the engine: it comes back as a new card once All stop is lifted.
        if (kept.ask?.type === 'ask') state.later.push(kept.ask);
        keep();
        await note(`All stop was on when you answered about ${titled(kept.work)}, so the build didn't get that answer; the question comes back once All stop is lifted.`, { work: kept.work });
        continue;
      }
      if (!answer) {
        state.delivered[key] = 'nothing';
        keep();
        continue;
      }
      const got = await answerEngine(kept.runId, answer);
      state.delivered[key] = got.ok ? 'answered' : 'refused';
      keep();
      if (!got.ok) await note(`Your answer about ${titled(kept.work)} wasn't needed: the build had already moved on.`, { work: kept.work });
    }
  }

  // Asks held while All stop was on are routed again once it is lifted.
  async function again() {
    if (stopped() || state.later.length === 0) return;
    const later = state.later;
    state.later = [];
    for (const ask of later) delete state.routed[ask.id];
    keep();
    for (const ask of later) await onAsk(ask);
  }

  return {
    file,
    onAsk,
    async tick() {
      await deliver();
      await again();
      await show();
    },
  };
}
