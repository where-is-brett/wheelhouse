// tests/scripts/setup/panel.test.js
// Setup's one optional offer of the Wheelhouse panel for VS Code, asked in step 6 after the coding agent is set up: asked once,
// "Skip for now" is kept, a yes lists the install on step 6's card and runs it in apply, a company list that leaves the panel out
// is one plain line and no question, and nothing is offered where this release has no package or VS Code isn't here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computerStep } from '../../../scripts/setup/computer.js';
import { panelAsk, panelChosen, PANEL_ANSWER, PANEL_LABELS, realOffer } from '../../../scripts/setup/panel.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { NOT_ALLOWED_LINE } from '../../../scripts/addon/allowed.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';
import { tempFolder } from '../../helpers/homes.js';

const MANIFEST = { claudeCode: { floor: '2.1.100' } };
const INSTALL = { label: PANEL_LABELS.install, text: null, at: T0.toISOString() };
const SKIP = { label: PANEL_LABELS.skip, text: null, at: T0.toISOString() };
const NEW = { kind: 'install', to: '0.3.1' };
const OLDER = { kind: 'update', from: '0.3.0', to: '0.3.1' };

// Step 6 with a stand-in panel part, and an environment with no other agent installed.
function stepWith(config, panel) {
  return computerStep({ engine: null, run: async () => ({ code: 0, stdout: '', stderr: '' }), env: { CLAUDE_CONFIG_DIR: config, PATH: tempFolder('wh-bin-') }, manifest: MANIFEST, port: 14318, panel });
}
const ctxFor = (folder, user, answers = {}) => ({ folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers });
const offering = (found, installed = []) => ({ offer: async () => found, install: async () => { installed.push(1); return { ok: true, says: 'The Wheelhouse panel is installed in VS Code. Reload VS Code to start it.' }; } });

test('with no panel part, or nothing to offer, step 6 asks nothing about it', async () => {
  await withProject(async ({ folder, user, config }) => {
    assert.equal((await stepWith(config, null).plan(ctxFor(folder, user))).ask, undefined);
    const got = await stepWith(config, offering({})).plan(ctxFor(folder, user));
    assert.equal(got.ask, undefined);
    assert.equal(got.changes.some((c) => c.what === 'panel'), false);
  });
});

test('an offer is asked once, as optional, with the install first and recommended', async () => {
  await withProject(async ({ folder, user, config }) => {
    const planned = await stepWith(config, offering({ offer: NEW })).plan(ctxFor(folder, user));
    assert.equal(planned.ask.id, 'panel');
    assert.deepEqual(planned.ask.card.options.map((o) => o.label), ['Install the panel', 'Skip for now']);
    assert.equal(planned.ask.card.recommend, 'Install the panel');
    assert.match(planned.ask.card.what, /optional/);
    assert.equal(PANEL_ANSWER, '6.panel');
  });
});

test('an older panel is offered as Update the panel', async () => {
  await withProject(async ({ folder, user, config }) => {
    const planned = await stepWith(config, offering({ offer: OLDER })).plan(ctxFor(folder, user));
    assert.deepEqual(planned.ask.card.options.map((o) => o.label), ['Update the panel', 'Skip for now']);
    assert.match(planned.ask.card.what, /0\.3\.0.*0\.3\.1/);
    assert.equal(panelChosen({ '6.panel': { label: 'Update the panel' } }), 'update');
  });
});

test('Skip for now is kept: the offer is not asked again and nothing is added to the list', async () => {
  await withProject(async ({ folder, user, config }) => {
    const planned = await stepWith(config, offering({ offer: NEW })).plan(ctxFor(folder, user, { '6.panel': SKIP }));
    assert.equal(planned.ask, undefined);
    assert.equal(planned.changes.some((c) => c.what === 'panel'), false);
    assert.doesNotMatch(planned.card.what, /panel/);
  });
});

test('a yes lists the install on step 6\'s card, and apply runs it once and records the answer', async () => {
  await withProject(async ({ folder, user, config }) => {
    const installed = [];
    const step = stepWith(config, offering({ offer: NEW }, installed));
    const ctx = ctxFor(folder, user, { '6.panel': INSTALL });
    const planned = await step.plan(ctx);
    const change = planned.changes.find((c) => c.what === 'panel');
    assert.deepEqual(change.offer, NEW);
    assert.match(planned.card.what, /The Wheelhouse panel \(0\.3\.1\) is added to VS Code; VS Code then needs a reload\./);
    assert.deepEqual(planned.changes, (await step.plan(ctx)).changes, 'the same list each time, so its hash holds');

    const recorded = [];
    const said = [];
    await step.apply({ ...ctx, applyJsonKey: () => {}, record: (c) => recorded.push(c), say: (line) => said.push(line) }, planned.changes);
    assert.equal(installed.length, 1);
    const kept = recorded.find((c) => c.after?.panel);
    assert.equal(kept.kind, 'answer');
    assert.equal(kept.after.ok, true);
    assert.match(said.join('\n'), /panel is installed in VS Code/);
  });
});

test('a panel VS Code will not take is a line, and setup carries on', async () => {
  await withProject(async ({ folder, user, config }) => {
    const part = { offer: async () => ({ offer: OLDER }), install: async () => ({ ok: false, says: 'VS Code didn\'t take the panel, so it wasn\'t installed.' }) };
    const step = stepWith(config, part);
    const ctx = ctxFor(folder, user, { '6.panel': { ...INSTALL, label: PANEL_LABELS.update } });
    const planned = await step.plan(ctx);
    assert.match(planned.card.what, /brought from 0\.3\.0 to 0\.3\.1/i);
    const said = [];
    await step.apply({ ...ctx, applyJsonKey: () => {}, record: () => {}, say: (l) => said.push(l) }, planned.changes);
    assert.match(said.join('\n'), /didn't take the panel/);
  });
});

test('a company list that leaves the panel out: no question, no change, one plain line', async () => {
  await withProject(async ({ folder, user, config }) => {
    const said = [];
    const planned = await stepWith(config, offering({ blocked: NOT_ALLOWED_LINE })).plan({ ...ctxFor(folder, user), say: (l) => said.push(l) });
    assert.equal(planned.ask, undefined);
    assert.equal(planned.changes.some((c) => c.what === 'panel'), false);
    assert.deepEqual(said, [NOT_ALLOWED_LINE]);
  });
});

test('the question says why it is the director\'s choice and how to get the panel later', () => {
  const card = panelAsk(NEW).card;
  assert.match(card.why, /It adds software to VS Code on this computer, so it's your choice\./);
  assert.match(card.options.find((o) => o.label === 'Skip for now').says, /Run setup again to add it/);
});

test('a company list that leaves the panel out is said once where step 6 has a card (in apply), and not in its plan', async () => {
  await withProject(async ({ folder, user, config }) => {
    const said = [];
    const step = stepWith(config, offering({ blocked: NOT_ALLOWED_LINE }));
    const ctx = { ...ctxFor(folder, user), say: (l) => said.push(l) };
    const planned = await step.plan(ctx);
    assert.ok(planned.changes.length > 0, 'a card, so the plan\'s line would not be kept');
    // The engine keeps a plan's line only when the step settles, so the plan's say is dropped here and apply says it.
    said.length = 0;
    await step.apply({ ...ctx, applyJsonKey: () => {}, record: () => {} }, planned.changes);
    assert.deepEqual(said.filter((l) => l === NOT_ALLOWED_LINE), [NOT_ALLOWED_LINE]);
  });
});

test('the real offer needs this release to carry the panel\'s package, and says nothing without it', async () => {
  const root = tempFolder('wh-root-');
  const none = async () => { throw new Error('never asked'); };
  assert.deepEqual(await realOffer({ platform: 'darwin', env: {}, run: none, root }), {}, 'no vscode/vsix.sha256 here');
  fs.mkdirSync(path.join(root, 'vscode'));
  fs.writeFileSync(path.join(root, 'vscode', 'vsix.sha256'), `${'a'.repeat(64)}  wheelhouse-panel-0.3.1.vsix\n`);
  const here = (present, listAllowed) => realOffer({ platform: 'darwin', env: {}, run: none, root, home: root, present: () => present, listAllowed });
  assert.deepEqual(await here(false), {}, 'the package is here, but there is no VS Code to offer to');
  assert.deepEqual((await here(true, async () => ({ allowed: null }))).offer?.kind, 'install', 'a list that can\'t be read still offers it');
  assert.deepEqual(await here(true, async () => ({ allowed: false })), { blocked: NOT_ALLOWED_LINE });
});

test('the question card composes on the path it is shown, and reads plainly', () => {
  for (const offer of [NEW, OLDER]) {
    const ask = panelAsk(offer);
    const rendered = composeCard({ kind: 'question', ...ask.card, target: undefined }).question;
    assert.ok(rendered.question.length > 0);
    assert.doesNotMatch(rendered.question, /enhanced|improved|fixed/i);
  }
});
