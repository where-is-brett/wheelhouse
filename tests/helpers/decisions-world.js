// tests/helpers/decisions-world.js
// A made-up project, harbour-demo, with decisions raised and answered in its record, for the decision tests. A decision is the
// answer card for a question an agent raised on a piece of work (here w-tide-1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './test-home.js';
import { composeCard, answerInput } from '../../scripts/cards/compose.js';
import { makeEvent, eventPath } from '../../scripts/state/events.js';
import { makeSigningKey, enrol } from '../../scripts/state/signing.js';
import { stateDir } from '../../scripts/lib/paths.js';

export const P = 'owner__harbour-demo';

// Runs fn with a scratch home holding an enrolled signing key, and puts the old home back.
export async function inHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-dec-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-01T00:00:00.000Z' });
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Keeps an event in the project's record, as the helper would have written it.
export function keep(event, project = P) {
  const file = path.join(stateDir(project), eventPath(event));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(event));
  return event;
}

// Raises a decision: records a question of the build and the answer card made from it. The card is the second event, a
// millisecond after the question. Returns the card event.
export function raiseBuildQuestion(id, at, { project = P, ask = 'Should the harbour map show tide times?', labels = ['Show them', 'Leave them out'], recommend = labels[0], work = 'w-tide-1' } = {}) {
  const data = {
    id,
    work,
    what: ask,
    why: 'It changes what the director\'s visitors see, so it is theirs to decide.',
    options: labels.map((label) => ({ label, says: `Go with ${label.toLowerCase()}.` })),
    recommendation: recommend,
    level: 3,
  };
  keep(makeEvent({ kind: 'question', data, now: () => new Date(at) }), project);
  const { card } = composeCard(answerInput(data, work));
  return keep(makeEvent({ kind: 'card', data: card, now: () => new Date(new Date(at).getTime() + 1) }), project);
}

let counter = 0;
// Raises a decision under a new question id, the second option recommended.
export function raise(ask, at, { labels = ['Daily', 'Weekly', 'Monthly'], project = P } = {}) {
  counter += 1;
  return raiseBuildQuestion(`q-w-tide-1-${counter}`, at, { project, ask, labels, recommend: labels[1] });
}

// The director's typed reply as the record keeps it, signed, at `at`.
export function typedAnswer(card, { n, label, words = '' }, at, project = P) {
  const option = label === 'own' ? '' : card.data.options['ABCD'.indexOf(label)];
  return keep(makeEvent({ kind: 'decision-answer', data: { question: card.data.question, n, label, option, words, where: 'chat' }, now: () => new Date(at) }), project);
}
