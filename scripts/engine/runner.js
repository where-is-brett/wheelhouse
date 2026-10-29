// scripts/engine/runner.js
// The helper's side of the card router (Archon design, sections 8.3 and 8.4), for one project on the engine. Each new
// ask is routed: the table's answers and a delegation's go back at once, with a Logbook line; the rest become cards,
// written within the director's cards a day. A card is a build question (its answer card is signed by its question
// line) or a pull request's approval (signed as any approval is), so the signing that exists signs it. Each tick, the
// director's signed answers go back to the engine, once each; one the engine refuses closes with one plain line.
// Under All stop nothing goes back: an answer signed then never reaches the build, and its question is asked again
// after the lift. What it did is kept in `file`, so a helper started again routes nothing twice.
//
// Each tick also keeps the caps (section 10.2): a running run past its minutes (running time only) or its tokens is
// cancelled, its worktree kept, and a cap card asks Give it more or Stop. Give it more resumes a run that stopped on
// a failure, skipping finished steps; a cancelled run can't be resumed (check 78), so it is started again on its
// branch to carry on from what's there, with the cap raised once and the spend before it carried. A run that ended
// gets one `cost` record.
import fs from 'node:fs';
import path from 'node:path';
import { composeCard } from '../cards/compose.js';
import { routeAsk, cardBudget, bundleApprovals, answerFor, dayOf, ignoresBudget, ENGINE_QUESTIONS } from './router.js';
import { runCost, runningMinutes } from './spend.js';
import { capReached, carriedSpend } from './caps.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const EMPTY = () => ({ routed: {}, waiting: [], shown: { day: null, count: 0 }, questions: {}, approvals: {}, delivered: {}, tries: {}, later: [], next: {}, noted: null, capped: {}, costed: {}, carried: {} });
// The failed tries after which the director is told an answer hasn't reached the build yet.
const UNREACHABLE_SAID = 3;
// The cap card's options: Give it more carries the work on with the cap raised once; Stop leaves it stopped.
export const MORE = 'Give it more';
export const STOP_LABEL = 'Stop';

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

// engineRunner({ engine, file, readViews, write, stopped, now, settings, workOf, titleOf, endRun }) -> { onAsk, tick, file }.
// - `readViews()` the project's views (questions, approvals, levels), as the helper builds them;
// - `write(kind, data)` a record in the project's history; `stopped()` whether All stop is on;
// - `settings()` { cardsPerDay, bundleApprovals }; `workOf(runId)` { work, lane } from the project's run records;
// - `titleOf(work)` the work's title; `endRun(runId)` ends a run's process tree by pid, as All stop does, for a run the
//   engine wouldn't stop at its cap ({ ended, survivors }).
export function engineRunner({ engine, file, readViews, write, stopped = () => false, now = () => new Date(), settings = () => ({}), workOf = () => null, titleOf = (work) => work, endRun = async () => ({ ended: [], survivors: [] }) } = {}) {
  let state = readState(file);
  const keep = () => saveState(file, state);
  const note = (words, extra = {}) => write('note', { about: 'engine', words, ...extra });
  const titled = (work) => inSentence(String(titleOf(work) ?? work));

  let startRun = async () => ({ ok: false, refused: 'nothing starts runs here' });
  const viewsNow = () => {
    try { return readViews() ?? {}; } catch { return {}; }
  };
  const safely = (fn) => Promise.resolve().then(fn).catch(() => null);
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
    state.waiting.push({ importance: routed.importance, exempt: routed.exempt === true, card: routed.card, work, runId: ask.runId, ask });
    keep();
    await show();
  }

  // Writes the waiting cards the day's budget has room for, and notes how many wait. One showing at a time: an ask
  // routed while a tick shows cards waits for it, so no card is written twice.
  let showing = Promise.resolve();
  function show() {
    showing = showing.then(showNow, showNow);
    return showing;
  }
  async function showNow() {
    const today = dayOf(now());
    if (state.shown.day !== today) state.shown = { day: today, count: 0 };
    const { cardsPerDay = 3, bundleApprovals: bundling = false } = settings() ?? {};
    // Bundled approvals are shown together and count as one card; each is still its own signed approval.
    const groups = bundling
      ? bundleApprovals(state.waiting).map((g) => (g.card.bundle ? { importance: g.importance, exempt: g.exempt === true, items: state.waiting.filter((w) => w.card.approval && g.card.bundle.includes(w.card.approval)) } : { importance: g.importance, exempt: g.exempt === true, items: [g] }))
      : state.waiting.map((w) => ({ importance: w.importance, exempt: w.exempt === true, items: [w] }));
    const { show: shown, wait } = cardBudget({ cards: groups, cardsPerDay, shownToday: state.shown.count });
    for (const group of shown) {
      for (const item of group.items) {
        await writeCard(item);
        state.waiting = state.waiting.filter((w) => w !== item);
      }
      if (!ignoresBudget(group)) state.shown.count += 1;
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
      const engineRef = views.questions[id].question?.data?.engine ?? { ask: kept.ask?.id, options: {} };
      answered.push({ key: id, kept, answer: answerFor(engineRef, answer.label, answer.words) });
    }
    for (const [key, kept] of Object.entries(state.approvals)) {
      if (state.delivered[key]) continue;
      const [pr, sha] = key.split(':');
      if (!views.approvals?.[pr]?.[sha]) continue;
      answered.push({ key, kept, answer: kept.approve ? { ask: kept.ask.id, choice: kept.approve } : null });
    }
    for (const { key, kept, answer } of answered) {
      if (kept.cap) {
        if (stopped()) continue;
        state.delivered[key] = 'answered';
        keep();
        await capAnswer(kept, views.questions?.[key]?.answer?.label);
        continue;
      }
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
      if (!got.ok && got.unreachable === true) {
        // Not delivered: sent again on the next tick, and said once.
        state.tries[key] = (state.tries[key] ?? 0) + 1;
        keep();
        if (state.tries[key] === UNREACHABLE_SAID) await note(`The build couldn't take your answer about ${titled(kept.work)} yet; it keeps trying.`, { work: kept.work });
        continue;
      }
      state.delivered[key] = got.ok ? 'answered' : 'refused';
      delete state.tries[key];
      keep();
      if (!got.ok) await note(`Your answer about ${titled(kept.work)} wasn't needed: the build had already moved on.`, { work: kept.work });
    }
  }

  // The cap card for a run stopped at its cap (or one the engine itself stopped on its budget).
  async function capped({ runId, work, lane, branch, reached, stuck = null }) {
    if (state.capped[runId]) return;
    const n = (state.next[work] ?? ENGINE_QUESTIONS) + 1;
    state.next[work] = n;
    const id = `q-${work}-${n}`;
    state.capped[runId] = { question: id, reached };
    state.questions[id] = { cap: true, runId, work, lane, branch };
    keep();
    const amount = reached.cap === 'minutes' ? `${reached.limit} minutes of work` : `${reached.limit.toLocaleString('en-GB')} tokens`;
    await write('question', {
      id, work, level: 3,
      what: stuck
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
    });
  }

  async function capAnswer(kept, label) {
    if (label !== MORE) {
      await note(`${titleOf(kept.work)} stays stopped, as you chose.`, { work: kept.work });
      return;
    }
    const record = await inspect(kept.runId);
    if (record?.outcome === 'failed' || record?.status === 'paused') {
      const got = await safely(() => engine.act(kept.runId, { resume: {} }));
      if (got?.ok) {
        state.carried[kept.runId] = { raised: true, runs: state.carried[kept.runId]?.runs ?? [] };
        keep();
        return;
      }
    }
    const got = await startRun({ work: kept.work, lane: kept.lane, branch: kept.branch ?? null, carryOn: true, raised: true });
    if (got?.ok && typeof got.runId === 'string') {
      state.carried[got.runId] = { raised: true, runs: [...(state.carried[kept.runId]?.runs ?? []), kept.runId] };
      keep();
    } else {
      await note(`${titleOf(kept.work)} couldn't be carried on: ${got?.refused ?? 'the build engine didn\'t start it'}.`, { work: kept.work });
    }
  }

  // Each running run of the project, against its caps; each ended one, its cost record.
  async function caps() {
    const v = viewsNow();
    const { capMinutes = {}, capTokens = {} } = settings() ?? {};
    for (const [work, list] of Object.entries(isPlain(v.runs) ? v.runs : {})) {
      const byRun = new Map();
      for (const e of Array.isArray(list) ? list : []) if (typeof e?.data?.runId === 'string') (byRun.get(e.data.runId) ?? byRun.set(e.data.runId, []).get(e.data.runId)).push(e);
      for (const [runId, records] of byRun) {
        const latest = records.at(-1).data;
        if (latest.state === 'ended') {
          if (!state.costed[runId]) await costOf(runId, work, records);
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
        // Cancelled, tried once more if the engine didn't take it; a run still going after that has its processes
        // ended, as All stop ends them, so it can't spend past its cap unseen.
        const cancel = () => safely(() => engine.act(runId, { cancel: { reason: `the run reached its ${reached.cap} cap` } }));
        let stuck = null;
        if ((await cancel())?.ok !== true && (await cancel())?.ok !== true && (await inspect(runId))?.status !== 'ended') {
          stuck = (await safely(() => endRun(runId))) ?? { ended: [], survivors: [] };
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
    capped,
    async tick() {
      await deliver();
      await again();
      await caps();
      await show();
    },
    // How the runner starts a run again (the dispatcher's own start): ({ work, lane, branch, carryOn, raised }) -> { ok, runId }.
    onStart(fn) { if (typeof fn === 'function') startRun = fn; },
    // What a run carries: { raised, runs } (the runs before it whose spend counts against its caps).
    carried: (runId) => state.carried[runId] ?? null,
    questionOf: (runId) => state.capped[runId]?.question ?? null,
  };
}
