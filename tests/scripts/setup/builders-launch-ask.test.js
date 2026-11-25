// tests/scripts/setup/builders-launch-ask.test.js
// Step 3 asks for the launch command's text once the director has chosen "In the background with a launch command"
// (builders and settings design, sections 8.2, 12.3 and 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDER_CHOICES, BUILDERS_ID, LAUNCH_ID, builderChoice, builderLaunchSetting, saveBuilderLaunch, saveBuilderRoute } from '../../../scripts/setup/builders-ask.js';

const C = '0a1b2c3d';
const none = { settings: {}, unconfirmed: [] };
// An answer reader over a map of id -> { label, text }.
const answers = (m) => (id) => m[id] ?? null;
const choose = (label) => ({ [BUILDERS_ID]: { label } });
const check = (ok = true) => () => ({ ok, ...(ok ? {} : { why: "The launch command's program, `nope`, isn't on this computer's PATH" }) });

test('the launch command is asked, in its own typed card, only after the launch choice', () => {
  assert.equal(builderChoice({ answer: answers(choose(BUILDER_CHOICES.background)), where: 'terminal', views: none, computer: C, check: check() }), null);
  assert.equal(builderChoice({ answer: answers(choose(BUILDER_CHOICES.desktop)), where: 'desktop', views: none, computer: C, check: check() }), null);
  const asked = builderChoice({ answer: answers(choose(BUILDER_CHOICES.launch)), where: 'terminal', views: none, computer: C, check: check() });
  assert.equal(asked.ask.id, LAUNCH_ID);
  assert.equal(asked.ask.typed, true);
  assert.match(asked.ask.card.what, /command/i);
  assert.ok(asked.ask.card.options.length >= 2, 'a card holds a choice besides Other');
  assert.match(asked.ask.card.why, /one line/i);
});

test('a typed command that is split and checked ends the question; a refused one is asked again, saying why, under a new id', () => {
  const base = choose(BUILDER_CHOICES.launch);
  const done = builderChoice({ answer: answers({ ...base, [LAUNCH_ID]: { label: 'Other', text: 'wrap claude' } }), where: 'terminal', views: none, computer: C, check: check() });
  assert.equal(done, null);
  const smuggled = builderChoice({ answer: answers({ ...base, [LAUNCH_ID]: { label: 'Other', text: 'wrap; rm -rf x' } }), where: 'terminal', views: none, computer: C, check: check() });
  assert.notEqual(smuggled.ask.id, LAUNCH_ID);
  assert.ok(smuggled.ask.id.startsWith(`${LAUNCH_ID}-`));
  assert.match(smuggled.ask.card.what, /can't run a command with `;`/);
  const missing = builderChoice({ answer: answers({ ...base, [LAUNCH_ID]: { label: 'Other', text: 'nope claude' } }), where: 'terminal', views: none, computer: C, check: check(false) });
  assert.match(missing.ask.card.what, /isn't on this computer's PATH/);
  const empty = builderChoice({ answer: answers({ ...base, [LAUNCH_ID]: { label: 'Other' } }), where: 'terminal', views: none, computer: C, check: check() });
  assert.match(empty.ask.card.what, /Choose Other and type/);
});

test('the words the director typed are shown back, and a confirmed set of words is the answer', () => {
  const asked = builderChoice({ answer: answers(choose(BUILDER_CHOICES.launch)), where: 'terminal', views: none, computer: C, check: check() });
  assert.ok(asked.ask.card.options.some((o) => /ask/i.test(o.says) || /type/i.test(o.says)));
  assert.deepEqual(builderLaunchSetting(['wrap', 'claude'], C), { key: `builderLaunch:${C}`, value: ['wrap', 'claude'] });
});

test('saving writes the words as this computer\'s launch setting through the signed profile route, and nothing without them', async () => {
  const writes = [];
  const profile = { views: async () => none, write: async (e) => { writes.push(e); return { ok: true }; } };
  const a = { [`3.${BUILDERS_ID}`]: { label: BUILDER_CHOICES.launch }, [`3.${LAUNCH_ID}`]: { label: 'Other', text: 'wrap "my claude"' } };
  const got = await saveBuilderLaunch({ answers: a, profile, computer: C, check: check() });
  assert.deepEqual(got, { key: `builderLaunch:${C}`, value: ['wrap', 'my claude'] });
  assert.equal(writes[0].kind, 'setting');
  assert.deepEqual(writes[0].data.value, ['wrap', 'my claude']);
  assert.equal(await saveBuilderLaunch({ answers: { [`3.${BUILDERS_ID}`]: { label: BUILDER_CHOICES.background } }, profile, computer: C, check: check() }), null);
  assert.equal(writes.length, 1);
  // A route saved by the same step is the background route.
  const route = await saveBuilderRoute({ answers: a, profile: { views: async () => none, write: async (e) => { writes.push(e); return { ok: true }; } }, computer: C });
  assert.deepEqual(route, { key: `builders:${C}`, value: 'background' });
});

test('a failed or refused write is thrown, in words', async () => {
  const profile = { views: async () => none, write: async () => ({ ok: false, why: 'STOP is on' }) };
  const a = { [`3.${BUILDERS_ID}`]: { label: BUILDER_CHOICES.launch }, [`3.${LAUNCH_ID}`]: { label: 'Other', text: 'wrap claude' } };
  await assert.rejects(saveBuilderLaunch({ answers: a, profile, computer: C, check: check() }), /launch command could not be saved.*STOP is on/);
});
