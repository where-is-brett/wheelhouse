// tests/helpers/setup-steps.js
// Steps for the setup engine's tests, standing in for Tasks 7 to 13. Each step reads what it
// would change from <WHEELHOUSE_HOME>/test-world.json, so a test can change the list between the
// card and the click:
//   { "<step>": [{ file, key, value, home? }], "planMs": n, "hold": [<step>],
//     "fail": { "<step>": why }, "planFail": { "<step>": why },
//     "what": { "<step>": what }, "ask": { "<step>": [{ id, options, typed?, what? }] },
//     "uses": { "<step>": ["<step>.<id>"] }, "settle": [<step>], "record": { "<step>": record },
//     "wait": { "<step>": { ms, why } } }
// A file is in the folder being set up, or with `home` in the user's home the step is given;
// `planMs` makes each plan take that long, so a test can have two requests planning at once. Apply
// writes each listed key with ctx.applyJsonKey, which records the change in the journal as it is
// made, and returns them too. A step in `hold` waits for <WHEELHOUSE_HOME>/release-<step> before it
// begins; a step in `fail` throws `why` once it has made its changes; a step in `planFail` throws
// `why` from its plan. Step 2 is long: it makes its first change, then waits for
// <WHEELHOUSE_HOME>/release-2 before it makes the rest, so a test can read its progress.
//
// The answer path: `what` gives a step's Go-ahead card its own first part. A step in `wait` gives
// that wait. A step with `ask` asks each of its questions, in order, until ctx.answers holds an
// answer to it, as `<step>.<id>`. A step in `settle` then settles with its answers as the record
// (or with `record`'s for it, as given);
// otherwise its list has, after the keys listed, one key in <folder>/.claude/answers.json for each
// answer in `uses`, named `<step>.<id>`, holding the answer's label or text (null when there is none).
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../../scripts/lib/paths.js';
import { SETUP_TITLES } from '../../scripts/state/card-lines.js';

function world() {
  try {
    return JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'test-world.json'), 'utf8'));
  } catch {
    return {};
  }
}

const card = (n, what) => ({
  kind: 'setup',
  level: 3,
  what: what ?? `Setup step ${n}, ${SETUP_TITLES[n]}: the keys listed below are written.`,
  why: 'Nothing changes on your computer without your click.',
  options: [
    { label: 'Go ahead', says: 'Setup writes the keys listed.' },
    { label: 'Not now', says: 'Setup waits here; nothing changes.' },
  ],
  recommend: 'Go ahead',
  because: 'the list is what setup needs',
  meanwhile: 'Setup waits; nothing changes.',
});

// A question a step asks: the composer's input without its kind, which the engine gives.
const questionCard = (n, { options, what }) => ({
  level: 2,
  what: what ?? `Setup step ${n} needs to know which one you use.`,
  why: 'Setup sets it up the way you work.',
  options: options.map((label) => ({ label, says: `Setup uses ${label}.` })),
  recommend: options[0],
  because: 'it is the usual one',
  meanwhile: 'Setup waits at this step.',
});

async function released(n) {
  const file = path.join(wheelhouseHome(), `release-${n}`);
  const until = Date.now() + 30000;
  while (!fs.existsSync(file)) {
    if (Date.now() > until) throw new Error('the test never released the step');
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
}

function step(n, { long = false } = {}) {
  return {
    n,
    title: SETUP_TITLES[n],
    ...(long ? { long: true } : {}),
    async plan(ctx) {
      const { [n]: listed = [], planMs = 0, planFail = {}, what = {}, ask = {}, uses = {}, settle = [], record = {}, wait = {} } = world();
      if (planMs > 0) await new Promise((resolve) => { setTimeout(resolve, planMs); });
      if (typeof planFail[n] === 'string') throw new Error(planFail[n]);
      if (wait[n]) return { wait: wait[n].ms, why: wait[n].why };
      const answers = ctx.answers ?? {};
      const questions = ask[n] ?? [];
      const open = questions.find((q) => !Object.hasOwn(answers, `${n}.${q.id}`));
      if (open) return { ask: { id: open.id, card: questionCard(n, open), ...(open.typed ? { typed: true } : {}) } };
      if (settle.includes(n)) {
        if (Object.hasOwn(record, n)) return { settled: { record: record[n] } };
        return { settled: { record: Object.fromEntries(questions.map((q) => [q.id, answers[`${n}.${q.id}`].label ?? answers[`${n}.${q.id}`].text])) } };
      }
      const answerOf = (key) => (Object.hasOwn(answers, key) ? answers[key].label ?? answers[key].text : null);
      return {
        changes: [
          ...listed.map((k) => ({ kind: 'json-key', target: path.join(k.home ? ctx.userHome : ctx.folder, k.file), key: k.key, after: k.value })),
          ...(uses[n] ?? []).map((key) => ({ kind: 'json-key', target: path.join(ctx.folder, '.claude', 'answers.json'), key: [key], after: answerOf(key) })),
        ],
        card: card(n, what[n]),
        director: 'One click',
      };
    },
    async apply(ctx, changes) {
      const { hold = [], fail = {} } = world();
      if (hold.includes(n)) await released(n);
      const made = [];
      for (const [i, c] of changes.entries()) {
        if (long && i > 0) await released(n);
        made.push(ctx.applyJsonKey({ file: c.target, key: c.key, value: c.after }));
      }
      if (typeof fail[n] === 'string') throw new Error(fail[n]);
      return made;
    },
  };
}

export const STEPS = Object.keys(SETUP_TITLES).map(Number).map((n) => step(n, { long: n === 2 }));
