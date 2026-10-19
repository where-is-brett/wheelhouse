// tests/eval/build-loop/33-models.js
// Scenario 33 (design sections 7 and 15): subagent-driven development
// dispatches an implementer for a mechanical task. Pass: the implementer's
// model is the one the brief's routing table names for its role.
// Run it with `npm run eval -- 33 --variant with` and `--variant without`,
// with WHEELHOUSE_EVAL_ROUTING set in the shell.
//
// No model is named in the repository. The routing table is filled at run
// time from the environment variable WHEELHOUSE_EVAL_ROUTING, a JSON object of
// role to model (for example {"builder":"<a model>","reviewer":"<another>"}),
// and the scenario refuses to run without it. Choose a builder model that is
// not the session's own, so the check cannot pass by default, and not the
// least powerful one, which Superpowers' own rule would pick for a mechanical
// task. The task is mechanical, so when the table names no `mechanical` model
// the builder's is used for it too, and the check does not hang on which of
// the two roles the session takes the task for.
//
// The session builds a one-task plan in the feature lane with
// subagent-driven development: a module of two constants. The `with` brief is
// the rendered Wheelhouse brief (the override first, the feature lane, the
// routing table under "Models by role"); the `without` brief is the feature
// section alone, which carries no routing, so its judgement says what model
// the session picked. Both variants load Wheelhouse's agents in a scratch
// plugin. Judged from each dispatch's `model` input, the session's model in
// the init event, and the result event's modelUsage.
import { locateSuperpowers } from '../../../scripts/eval/harness.js';
import { agentText, callsOf, setUpFeature } from '../../../scripts/eval/feature-project.js';

const WORK = 'upload-limits';
const PLAN = 'docs/superpowers/plans/2026-10-19-upload-limits.md';
const GOAL = 'A `limits.js` module holding the upload limits, so the upload form and the server read the same numbers.';
const DONE = [
  'limits.js exports MAX_UPLOAD_MB, which is 25.',
  'limits.js exports MAX_FILES, which is 10.',
];

const plan = `# Upload Limits Implementation Plan

**Goal:** ${GOAL}

**Architecture:** One plain Node.js ES module, no dependencies, tested with \`node --test\`.

### Task 1: The limits module

A mechanical task: two constants and their test.

**Files:**
- Create: \`limits.js\`, \`limits.test.js\`

- [ ] **Step 1:** Write the failing test in \`limits.test.js\`: \`MAX_UPLOAD_MB\` is 25 and \`MAX_FILES\` is 10.
- [ ] **Step 2:** Run \`node --test\` and see it fail.
- [ ] **Step 3:** Write \`limits.js\` exporting \`MAX_UPLOAD_MB = 25\` and \`MAX_FILES = 10\`.
- [ ] **Step 4:** Run \`node --test\` and see it pass.
- [ ] **Step 5:** Commit.
`;

const plainBrief = `# Brief: upload limits

${GOAL}

What done means:
${DONE.map((line) => `- ${line}`).join('\n')}

The plan is at \`${PLAN}\`. Build it with \`superpowers:subagent-driven-development\`.
`;

export const ROUTING_VARIABLE = 'WHEELHOUSE_EVAL_ROUTING';

// The routing table from the environment: { role: model }, with `mechanical`
// filled from `builder` when it is not named. Throws a plain message when the
// variable is missing or is not a table naming a builder model.
export function routingFrom(env = process.env) {
  const text = env[ROUTING_VARIABLE];
  const usage = `Scenario 33 needs ${ROUTING_VARIABLE}: a JSON object of role to model, naming at least a builder model, for example {"builder":"<model>","reviewer":"<model>"}. Set it in the shell for the run.`;
  if (typeof text !== 'string' || text.trim() === '') throw new Error(usage);
  let table;
  try {
    table = JSON.parse(text);
  } catch {
    throw new Error(`${ROUTING_VARIABLE} is not JSON. ${usage}`);
  }
  const ok = table && typeof table === 'object' && !Array.isArray(table)
    && Object.values(table).every((model) => typeof model === 'string' && model.trim() !== '')
    && typeof table.builder === 'string';
  if (!ok) throw new Error(`${ROUTING_VARIABLE} does not name a builder model. ${usage}`);
  return { mechanical: table.builder, ...table };
}

// Two names for one model: equal, or one the alias inside the other's full name.
export function sameModel(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

const dispatches = (calls) => calls.filter((call) => (call.name === 'Agent' || call.name === 'Task') && !call.subagent);
const typeOf = (call) => call.input.subagent_type ?? 'general-purpose';
const said = (call) => `${call.input.description ?? ''} ${typeOf(call)}`;

// The dispatches that build: `wheelhouse:builder`, or any other subagent sent
// to implement or build a task that is not a review or the tester.
export function implementers(calls) {
  return dispatches(calls).filter((call) => typeOf(call) === 'wheelhouse:builder'
    || (!/review|tester|verif/i.test(said(call)) && /implement|build|task\s*\d/i.test(said(call))));
}

// The dispatches that review.
export const reviewers = (calls) => dispatches(calls).filter((call) => /review/i.test(said(call)));

// The session's own model, from the init event.
export const sessionModel = (events) => events.find((event) => event.type === 'system' && event.subtype === 'init')?.model ?? null;

// The models the result event says worked.
export const modelsWorked = (events) => Object.keys(events.findLast((event) => event.type === 'result')?.modelUsage ?? {});

const named = (call) => (typeof call.input.model === 'string' && call.input.model !== '' ? call.input.model : null);

// The pass: every implementer dispatched with the brief's model for the
// builder role (or the mechanical role), a model that is not the session's
// own, and that model among those that worked. Without, the brief carries no
// routing; the judgement says what the session picked.
export function judge({ calls, routing, session, worked = [], variant = 'with' }) {
  const wanted = [routing.builder, routing.mechanical].filter(Boolean);
  if (wanted.some((model) => sameModel(model, session))) {
    return { pass: false, why: 'inconclusive: the routing table gives the builder the session\'s own model, so the check would pass by default' };
  }
  const built = implementers(calls);
  if (built.length === 0) return { pass: false, why: 'inconclusive: no implementer was dispatched' };
  const picks = built.map((call) => named(call) ?? 'none set (the session\'s own)');
  const reviewNote = (() => {
    const list = reviewers(calls);
    if (list.length === 0 || !routing.reviewer) return '';
    const right = list.filter((call) => sameModel(named(call), routing.reviewer)).length;
    return `; ${right} of ${list.length} review dispatch(es) had the reviewer role's model`;
  })();
  const wrong = built.filter((call) => !wanted.some((model) => sameModel(named(call), model)));
  if (wrong.length > 0) {
    const what = `the implementer was dispatched with ${picks.join(', ')}, not the builder role's model`;
    return { pass: false, why: variant === 'without' ? `no routing in its brief; ${what}${reviewNote}` : `${what}${reviewNote}` };
  }
  if (worked.length > 0 && !worked.some((model) => wanted.some((w) => sameModel(model, w)))) {
    return { pass: false, why: `the implementer was dispatched with the builder role's model, but the result's modelUsage shows no work by it${reviewNote}` };
  }
  return { pass: true, why: `${built.length} implementer dispatch(es), each with the builder role's model, not the session's own, and that model did work${reviewNote}` };
}

export default {
  id: 33,
  title: "The implementer's model is the one the routing table names for its role",

  setup: (dir, variant) => {
    const routing = routingFrom();
    return setUpFeature(dir, {
      work: WORK,
      lane: 'feature',
      goal: GOAL,
      done: DONE,
      plan: { path: PLAN, text: plan },
      brief: variant === 'with' ? 'wheelhouse' : plainBrief,
      agents: { builder: agentText('builder'), reviewer: agentText('reviewer'), tester: agentText('tester') },
      routing: variant === 'with' ? routing : {},
    });
  },

  prompt: 'Read `.wheelhouse/feature/brief.md` and follow it. The plan is written and you may build it now. Run each shell command on its own, written out in full: no shell variables and no command substitution.',

  variants: {
    with: { get pluginDirs() { return [locateSuperpowers()]; } },
    without: { get pluginDirs() { return [locateSuperpowers()]; } },
  },

  permissionMode: 'acceptEdits',
  maxTurns: 80,

  pass: ({ events, variant }) => judge({
    calls: callsOf(events), routing: routingFrom(), session: sessionModel(events), worked: modelsWorked(events), variant,
  }),
};
