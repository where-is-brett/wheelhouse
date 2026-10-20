// tests/scripts/setup/install-step.test.js
// Step 1, the install (ruling R76): no Go-ahead card; its plan settles at once with when the
// session's first message came, the earliest transcript entry whose `cwd` is the folder, from no
// earlier than 24 hours before the run started, and when the run started. Transcripts are in a
// scratch Claude Code folder (CLAUDE_CONFIG_DIR); nothing reads the real ~/.claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installStep, firstMessageAt, FIRST_MESSAGE_WINDOW_MS } from '../../../scripts/setup/install-step.js';
import { STEPS } from '../../../scripts/setup/steps.js';
import { findRun, startRun } from '../../../scripts/setup/journal.js';
import { withProject, transcript, typed, T0 } from '../../helpers/setup-answers.js';

const HOUR = 60 * 60 * 1000;
const at = (ms) => new Date(T0.getTime() + ms).toISOString();

test('step 1 is filled by install-step.js, keeping its number and title, with nothing to wait for', () => {
  const step = STEPS.find((s) => s.n === 1);
  assert.equal(step.title, 'Install');
  assert.equal(step.title, installStep().title);
  assert.equal(step.long, undefined);
  assert.equal(step.after, undefined);
  assert.equal(FIRST_MESSAGE_WINDOW_MS, 24 * HOUR);
});

test('step 1 settles on the earliest entry in the folder from 24 hours before the run started, the same each time', async () => {
  await withProject(async ({ folder, config, user }) => {
    const elsewhere = path.join(user, 'Projects', 'Other');
    transcript(config, 'a', 'old', [typed(folder, 'An old session.', at(-25 * HOUR))]);
    transcript(config, 'a', 'today', [
      { type: 'summary', summary: 'no folder, no time' },
      { type: 'system', cwd: folder, content: 'no time of its own' },
      // A command's output, which the rules don't read, still marks the session's start.
      { type: 'user', cwd: folder, timestamp: at(-2 * HOUR), message: { role: 'user', content: '<command-name>/plugin</command-name>' } },
      typed(folder, 'Set up Wheelhouse.', at(-HOUR)),
      typed(path.join(folder, 'docs'), 'A folder inside.', at(-90 * 60 * 1000)),
    ]);
    transcript(config, 'b', 'other', [typed(elsewhere, 'Another folder.', at(-3 * HOUR))]);
    const step = installStep();
    const ctx = { folder, step: 1, startedAt: T0.toISOString(), now: () => new Date(T0.getTime() + HOUR), userHome: user, answers: {} };
    const got = await step.plan(ctx);
    assert.deepEqual(got, { settled: { record: { firstMessageAt: at(-2 * HOUR), startedAt: T0.toISOString() } } });
    assert.deepEqual(await step.plan(ctx), got, 'the same world gives the same record');
    // A run started more than a day after them finds none.
    const later = await step.plan({ ...ctx, startedAt: at(27 * HOUR) });
    assert.deepEqual(later, { settled: { record: { firstMessageAt: null, startedAt: at(27 * HOUR) } } });
    // An entry exactly 24 hours before counts; one a moment older doesn't.
    assert.equal(firstMessageAt(folder, { since: at(-25 * HOUR), userHome: user }), at(-25 * HOUR));
    assert.equal(firstMessageAt(folder, { since: at(-25 * HOUR + 1), userHome: user }), at(-2 * HOUR));
    assert.deepEqual(await step.apply(ctx, []), []);
  });
});

test('with no session in the folder, step 1 settles with no first message', async () => {
  await withProject(async ({ folder, config, user }) => {
    transcript(config, 'b', 'other', [typed(path.join(user, 'Projects', 'Other'), 'Another folder.', at(-HOUR))]);
    const got = await installStep().plan({ folder, step: 1, startedAt: T0.toISOString(), now: () => T0, userHome: user, answers: {} });
    assert.deepEqual(got, { settled: { record: { firstMessageAt: null, startedAt: T0.toISOString() } } });
  });
  await withProject(async ({ folder, user }) => {
    // No transcripts at all.
    const got = await installStep().plan({ folder, step: 1, startedAt: T0.toISOString(), now: () => T0, userHome: user, answers: {} });
    assert.equal(got.settled.record.firstMessageAt, null);
  });
});

test('through the helper, step 1 starts the run and settles with no Go-ahead card, its record in the journal', async () => {
  await withProject(async ({ folder, config, home, plan }) => {
    transcript(config, 'a', 'today', [typed(folder, 'Set up Wheelhouse.', at(-10 * 60 * 1000))]);
    assert.equal(findRun(folder), null);
    assert.deepEqual(await plan(1), { ok: true, done: true });
    const run = findRun(folder);
    // The run starts when the plan does: the time the record names.
    assert.equal(run.startedAt, T0.toISOString());
    assert.equal(typeof run.steps[1].doneAt, 'string');
    assert.equal(run.steps[1].shownAt, undefined);
    assert.deepEqual(run.changes.filter((c) => c.step === 1).map((c) => [c.kind, c.target, c.before, c.after]),
      [['answer', 'step 1', null, { firstMessageAt: at(-10 * 60 * 1000), startedAt: T0.toISOString() }]]);
    assert.equal(fs.existsSync(path.join(home, 'setup', 'shown')), false, 'no Go-ahead card');
    await assert.rejects(plan(1), /already done/);
  });
  // A run already started: its own start time is the one read from.
  await withProject(async ({ folder, config, plan }) => {
    const started = new Date(T0.getTime() - 26 * HOUR);
    startRun({ folder, now: () => started });
    transcript(config, 'a', 'today', [typed(folder, 'Set up Wheelhouse.', at(-51 * HOUR)), typed(folder, 'Again.', at(-30 * HOUR))]);
    assert.deepEqual(await plan(1), { ok: true, done: true });
    const record = findRun(folder).changes.find((c) => c.step === 1).after;
    assert.deepEqual(record, { firstMessageAt: at(-30 * HOUR), startedAt: started.toISOString() });
  });
});
