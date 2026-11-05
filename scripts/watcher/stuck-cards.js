// scripts/watcher/stuck-cards.js
// A stuck work must never stay silent. The watcher's `stuck` wake tells the Bosun to ask the director, but a Bosun that
// closes that wake `--idle` without running `act ask` leaves no card. This reads the measures the Bosun's `wake.js
// done` leaves: for each wake closed idle that carried a `stuck` event, the question is put to the director here, in
// code, unless the work already has an open question from the Bosun, or has moved on (its feature is done or closed).
import fs from 'node:fs';
import path from 'node:path';
import { FOREMAN_QUESTIONS, questionIdOf } from '../lib/build-loop.js';
import { questionProblem } from '../cards/compose.js';
import { stuckQuestion } from '../foreman/ask-help.js';
import { loadViews } from '../foreman/wake.js';
import { readCapped } from '../feature/status.js';
import {
  readWake, watcherDir, watcherFolder, wakesDir, writeJsonFile,
} from './waker.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const KEPT = 200;

const doneFile = (project) => path.join(watcherDir(project), 'stuck-cards.json');

function readDone(project) {
  try {
    const kept = JSON.parse(readCapped(doneFile(project), 64 * 1024) ?? '{}');
    return Array.isArray(kept?.done) ? kept.done.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// The wakes the Bosun closed idle, oldest first.
function idleWakes(project) {
  let text = null;
  try {
    text = readCapped(path.join(watcherDir(project), 'measures.jsonl'), 64 * 1024 * 1024);
  } catch { /* none */ }
  const out = [];
  for (const line of (text ?? '').split('\n')) {
    try {
      const m = JSON.parse(line);
      if (isPlain(m) && m.outcome === 'idle' && typeof m.wake === 'string') out.push(m.wake);
    } catch { /* a damaged line */ }
  }
  return out;
}

// Puts a question to the director for each stuck work in a wake closed idle, once. Gives the ids it wrote.
export async function raiseStuckCards({ project, client }) {
  watcherFolder(project);
  const done = readDone(project);
  const fresh = idleWakes(project).filter((id) => !done.includes(id));
  if (fresh.length === 0) return [];
  let views;
  try {
    ({ views } = await loadViews(project, client));
  } catch {
    return []; // looked at again at the next loop
  }
  const written = [];
  const handled = [];
  for (const id of fresh) {
    const wake = readWake(path.join(wakesDir(project), `${id}.json`));
    const stuck = (Array.isArray(wake?.events) ? wake.events : []).filter((e) => e?.type === 'stuck' && typeof e.work === 'string');
    let failed = false;
    for (const e of stuck) {
      const step = views.features?.[e.work]?.data?.step;
      if (step === 'closed' || e.detail?.phase === 'done') continue;
      const open = Object.values(views.questions ?? {}).some((q) => q?.answer === null && questionIdOf(q?.question?.data?.id)?.work === e.work && questionIdOf(q.question.data.id).foreman);
      if (open) continue;
      const numbers = Object.values(views.questions ?? {}).map((q) => questionIdOf(q?.question?.data?.id)).filter((n) => n?.work === e.work && n.foreman).map((n) => n.n);
      const qid = `q-${e.work}-${Math.max(FOREMAN_QUESTIONS, ...numbers) + 1}`;
      const data = { id: qid, work: e.work, ...stuckQuestion(e.work, e.detail ?? {}) };
      if (questionProblem(data) !== null) continue;
      try {
        const answer = await client.state.write({ project, kind: 'question', data });
        if (answer?.ok !== true) throw new Error('refused');
        written.push(qid);
        views.questions = { ...(views.questions ?? {}), [qid]: { question: { key: qid, data }, answer: null } };
      } catch {
        failed = true;
      }
    }
    if (!failed) handled.push(id);
  }
  if (handled.length > 0) writeJsonFile(doneFile(project), { done: [...done, ...handled].slice(-KEPT) });
  return written;
}
