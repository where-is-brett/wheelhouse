// tests/scripts/host/helper-premium.test.js
// The premium model's opt-in through the helper (design section 14.6, "The premium model"): its card, offered and
// signed by the helper; the director's click, which alone allows it; the helper's own check of the account, made only
// after a Yes that allows paid credits; and its pass, recorded only on the pin that check found. Stand-ins only: no
// session starts, and the premium alias is never asked of Claude Code.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { stateDir, stopFile, computerId } from '../../../scripts/lib/paths.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { run } from '../../../scripts/lib/run.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { listEvents, makeEvent, confirmationFor } from '../../../scripts/state/events.js';
import { buildViews } from '../../../scripts/state/views.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { readiness } from '../../../scripts/routing/column-ready.js';
import { earned } from '../../../scripts/hooks/prompt-record.js';
import { premiumInput, ALLOW_WITHIN, ALLOW_PAID, ALLOW_PAID_ON_TOP } from '../../../scripts/routing/premium.js';
import { PREMIUM_LINE } from '../../../scripts/state/card-lines.js';
import { cardHash } from '../../../scripts/lib/measures-clicks.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { as, shortHome, testAddress, tempFolder } from '../../helpers/homes.js';
import { barRun, PINS } from '../../helpers/ready-records.js';

const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const adapter = { defaultBranch: async () => 'main' };
const P = 'o__p';
const PREMIUM = 'model-premium';
const PREMIUM_PINS = Object.freeze({ ...PINS, premium: PREMIUM });

// A computer with the project set up, its state cloned, its configuration pinning the two classes (and, to show it
// counts for nothing, a premium pin an agent might write), and the premium alias as a stand-in that says what it names.
async function computer({ alias = async () => PREMIUM, top = async () => PINS.mostCapable } = {}) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = tempFolder('wh-project-');
  fs.mkdirSync(path.join(folder, '.claude'));
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], tiers: { pins: { ...PINS, premium: 'model-agent' } } }));
  const evals = tempFolder('wh-evals-');
  const asked = [];
  await as(home, async () => {
    writeProject(P, { folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const { computer: id, publicKey } = makeSigningKey();
    enrol({ computer: id, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    await cloneState({ env: LOCAL_PATHS, project: P, remoteUrl: remote.url });
  });
  const premiumAlias = async () => { asked.push('alias'); return alias(); };
  const mostCapableAlias = async () => { asked.push('top'); return top(); };
  const withHelper = (fn) => as(home, async () => {
    const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}), evalsFolder: evals, premiumAlias, mostCapableAlias });
    try { return await fn(helperClient({ address: helper.address })); } finally { await helper.close(); }
  });
  const events = (kind) => as(home, () => listEvents(stateDir(P), { report: () => {} }).filter((e) => kind === undefined || e.kind === kind));
  const views = () => as(home, () => buildViews(listEvents(stateDir(P), { report: () => {} }), readEnrolled()));
  return { home, evals, folder, asked, withHelper, events, views, cleanup: () => remote.cleanup() };
}

// A setting confirmed as the director's Confirm click would confirm it.
async function confirmed(c, client, data) {
  const written = await client.state.write({ project: P, kind: 'setting', data });
  assert.equal(written.ok, true, written.refused);
  const [target] = (await c.events('setting')).filter((e) => e.id === written.id);
  const event = await as(c.home, () => makeEvent({ ...confirmationFor(target) }));
  const taken = await client.state.record({ project: P, event });
  assert.equal(taken.ok, true, taken.refused);
}
const atThorough = (c, client) => confirmed(c, client, { key: 'efficiency', value: 'thorough', words: 'Thoroughness: Thorough' });

// The card the helper's line hands the front desk.
const cardOf = (line) => JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1));

// The director's click on `label`, as the prompt record signs it, sent as the hook sends it.
async function click(c, client, question, label, { now = () => new Date() } = {}) {
  const got = await as(c.home, () => earned({ project: P, question: question.question, label, card: question, now, premiumIn: () => c.current ?? 'off' }));
  if (got === null) return null;
  const event = await as(c.home, () => makeEvent({ ...got.made, now }));
  return client.state.record({ project: P, event, target: got.target });
}

test('the card is offered at Thorough only, composed and signed by the helper, and the line hands it over as it is', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      const below = await client.premium.card({ project: P });
      assert.deepEqual([below.ok, below.offered], [true, false]);
      assert.match(below.why, /Thorough only/);
      assert.deepEqual(await c.events('premium-card'), []);
      await atThorough(c, client);
      const got = await client.premium.card({ project: P });
      assert.equal(got.offered, true, got.why);
      assert.match(got.line, /^The premium model's card for the director: ask it with AskUserQuestion, exactly as given/);
      assert.match(got.line, /After such a click, run `premium-check`/);
      const question = cardOf(got.line);
      const [offer] = await c.events('premium-card');
      assert.ok(await as(c.home, () => verify(offer, readEnrolled())), 'signed by this computer');
      assert.equal(offer.data.from, 'off');
      assert.equal(offer.data.hash, cardHash(question));
      assert.equal(PREMIUM_LINE.exec(question.question.split('\n').at(-1))[1], offer.data.at);
      assert.deepEqual(question, composeCard(premiumInput({ from: 'off', at: offer.data.at })).question);
      // Nothing touches the model before the director's Yes.
      assert.deepEqual(c.asked, []);
    });
  } finally { c.cleanup(); }
});

test('no caller can offer the card, allow the model or name its pin around the director\'s click', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      for (const data of [{ key: 'premium', value: 'within-plan' }, { key: 'premium', value: 'paid-too' }, { key: 'premium', value: 'off', premiumCard: '2026-10-26T01:00:00.000Z' }]) {
        const answer = await client.state.write({ project: P, kind: 'setting', data });
        assert.equal(answer.ok, false, JSON.stringify(data));
        assert.match(answer.refused, /only by a click on its own card/);
      }
      assert.equal((await client.state.write({ project: P, kind: 'setting', data: { key: 'premium', value: 'off' } })).ok, true, 'setting it back to off is anyone\'s to ask');
      const check = await client.state.write({ project: P, kind: 'premium-check', data: { setting: '11111111-2222-4333-8444-555555555555', model: PREMIUM, found: true } });
      assert.match(check.refused, /signed kind/);
      // A signed offer sent in is refused: only the helper offers it.
      const offer = await as(c.home, () => makeEvent({ kind: 'premium-card', data: { at: '2026-10-26T01:00:00.000Z', from: 'off', hash: 'ab'.repeat(32) } }));
      assert.match((await client.state.record({ project: P, event: offer })).refused, /only the helper offers/);
      // A signed setting allowing it, carried by a signed confirmation but naming no offer the state holds, is refused.
      const target = await as(c.home, () => makeEvent({ kind: 'setting', data: { key: 'premium', value: 'paid-too', premiumCard: '2026-10-26T01:00:00.000Z', words: 'Premium model: on, paid credits too' } }));
      const event = await as(c.home, () => makeEvent({ ...confirmationFor(target) }));
      assert.match((await client.state.record({ project: P, event, target })).refused, /only by a click on its own card/);
      assert.equal((await c.views()).premium.value, 'off');
    });
  } finally { c.cleanup(); }
});

test('within the plan alone the Yes is kept, but nothing is checked or used, since a run might be paid from credits', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      await atThorough(c, client);
      const question = cardOf((await client.premium.card({ project: P })).line);
      assert.equal((await click(c, client, question, ALLOW_WITHIN)).ok, true);
      assert.equal((await c.views()).premium.value, 'within-plan');
      const checked = await client.premium.check({ project: P });
      assert.deepEqual([checked.ok, checked.checked], [true, false]);
      assert.match(checked.why, /can't yet tell/);
      assert.deepEqual(c.asked, [], 'the alias is never asked');
      assert.deepEqual(await c.events('premium-check'), []);
      // Paid credits on top are offered on a card of their own, and its Yes is its own.
      c.current = 'within-plan';
      const top = await client.premium.card({ project: P });
      const second = cardOf(top.line);
      assert.equal((await c.events('premium-card')).at(-1).data.from, 'within-plan');
      assert.equal(await click(c, client, second, ALLOW_PAID), null, 'the first card\'s option is not on the second');
      assert.equal((await click(c, client, second, ALLOW_PAID_ON_TOP)).ok, true);
      assert.equal((await c.views()).premium.value, 'paid-too');
      assert.match((await client.premium.card({ project: P })).why, /already allowed/);
    });
  } finally { c.cleanup(); }
});

test('with paid credits allowed, the helper checks the account once, and the model it found is the pin for that Yes alone', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      await atThorough(c, client);
      assert.match((await client.premium.check({ project: P })).why, /not allowed/);
      assert.deepEqual(c.asked, []);
      const question = cardOf((await client.premium.card({ project: P })).line);
      assert.equal((await click(c, client, question, ALLOW_PAID)).ok, true);
      const checked = await client.premium.check({ project: P });
      assert.deepEqual([checked.ok, checked.checked, checked.found, checked.model], [true, true, true, PREMIUM]);
      assert.deepEqual(c.asked, ['alias', 'top']);
      const views = await c.views();
      const [record] = await c.events('premium-check');
      assert.deepEqual(record.data, { setting: views.premium.setting, model: PREMIUM, found: true });
      assert.equal(views.premium.check.model, PREMIUM);
      // Once per Yes.
      assert.match((await client.premium.check({ project: P })).why, /already/);
      assert.deepEqual(c.asked, ['alias', 'top']);
      // Signed by this computer, and refused when sent in by anyone else.
      assert.ok(await as(c.home, () => verify(record, readEnrolled())));
      assert.match((await client.state.record({ project: P, event: record })).refused, /only the helper checks/);
      // Off again: the pin is gone with it.
      await confirmed(c, client, { key: 'premium', value: 'off', words: 'Premium model: off' });
      assert.equal((await c.views()).premium.check, null);
    });
  } finally { c.cleanup(); }
});

test('an account without the model is told so, and the card isn\'t offered again until setup runs', async () => {
  // The premium alias names the most capable model there, whatever the project's configuration pins.
  for (const [alias, top] of [[async () => PINS.mostCapable, async () => PINS.mostCapable], [async () => 'model-elsewhere', async () => 'model-elsewhere']]) {
    const c = await computer({ alias, top });
    try {
      await c.withHelper(async (client) => {
        await atThorough(c, client);
        const question = cardOf((await client.premium.card({ project: P })).line);
        await click(c, client, question, ALLOW_PAID);
        const checked = await client.premium.check({ project: P });
        assert.deepEqual([checked.checked, checked.found, checked.model], [true, false, null]);
        const views = await c.views();
        assert.equal(views.premium.absent, true);
        assert.equal(views.premium.check.found, false);
        assert.match((await client.premium.card({ project: P })).why, /doesn't have/);
      });
    } finally { c.cleanup(); }
  }
});

test('a check Claude Code can\'t answer records nothing, and the Yes stands to be checked again', async () => {
  const answers = [async () => null, async () => '--flag', async () => { throw new Error('signed out'); }];
  for (const [alias, top] of [...answers.map((a) => [a, async () => PINS.mostCapable]), ...answers.map((t) => [async () => PREMIUM, t])]) {
    let failing = true;
    const c = await computer({ alias: () => (failing ? alias() : PREMIUM), top: () => (failing ? top() : PINS.mostCapable) });
    try {
      await c.withHelper(async (client) => {
        await atThorough(c, client);
        await click(c, client, cardOf((await client.premium.card({ project: P })).line), ALLOW_PAID);
        const checked = await client.premium.check({ project: P });
        assert.deepEqual([checked.ok, checked.checked], [true, false]);
        assert.match(checked.why, /try again/);
        assert.deepEqual(await c.events('premium-check'), []);
        assert.equal((await c.views()).premium.absent, false);
        failing = false;
        assert.equal((await client.premium.check({ project: P })).found, true);
      });
    } finally { c.cleanup(); }
  }
});

test('the premium model\'s pass is recorded only on the pin the helper\'s check found, and the configuration\'s counts for nothing', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      const early = await client.state.columnReady({ project: P, column: 'premium', pins: PREMIUM_PINS, records: ['2026-10-25/20-with-1.json'] });
      assert.match(early.refused, /no pin/);
      await atThorough(c, client);
      const question = cardOf((await client.premium.card({ project: P })).line);
      await click(c, client, question, ALLOW_PAID);
      await client.premium.check({ project: P });
      // A full pass made under another Yes counts for nothing under this one.
      barRun(c.evals, { level: 'premium', pins: PREMIUM_PINS, yes: '99999999-2222-4333-8444-555555555555', at: '2026-10-25T07:00:00.000Z' });
      const yes = (await c.views()).premium.setting;
      assert.equal(readiness({ evals: c.evals, level: 'premium', pins: PREMIUM_PINS, yes }).ok, false);
      barRun(c.evals, { level: 'premium', pins: PREMIUM_PINS, yes });
      const { records } = readiness({ evals: c.evals, level: 'premium', pins: PREMIUM_PINS, yes });
      const agents = await client.state.columnReady({ project: P, column: 'premium', pins: { ...PINS, premium: 'model-agent' }, records });
      assert.match(agents.refused, /pins are not/);
      const answer = await client.state.columnReady({ project: P, column: 'premium', pins: PREMIUM_PINS, records });
      assert.equal(answer.ok, true, answer.refused);
      const [ready] = await c.events('column-ready');
      assert.deepEqual(ready.data, { column: 'premium', pins: PREMIUM_PINS, records, commit: 'abc123def456' });
      assert.equal((await client.premium.state({ project: P })).pin, PREMIUM);
      assert.equal((await client.premium.state({ project: P })).value, 'paid-too');
    });
  } finally { c.cleanup(); }
});

test('on Copilot, where no hook signs a click, the card isn\'t offered', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      await atThorough(c, client);
      const file = path.join(c.folder, '.claude', 'wheelhouse.json');
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      const id = await as(c.home, () => computerId());
      fs.writeFileSync(file, JSON.stringify({ ...config, agents: { [id]: 'copilot' } }));
      const got = await client.premium.card({ project: P });
      assert.equal(got.offered, false);
      assert.match(got.why, /only from Claude Code/);
      assert.deepEqual(await c.events('premium-card'), []);
    });
  } finally { c.cleanup(); }
});

test('under STOP the helper offers no card and checks nothing', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      await atThorough(c, client);
      fs.writeFileSync(stopFile(), '');
      assert.match((await client.premium.card({ project: P })).refused, /STOP/);
      assert.match((await client.premium.check({ project: P })).refused, /STOP/);
      assert.deepEqual(c.asked, []);
    });
  } finally { c.cleanup(); }
});

// --- When its evaluation fails (design section 14.6, "What the Yes starts") ---

test('a failed evaluation is recorded once per Yes from the helper\'s own read, keeps it off, and a new Yes starts afresh', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      await atThorough(c, client);
      assert.equal((await client.premium.failed({ project: P })).recorded, false, 'no pin, no evaluation');
      await click(c, client, cardOf((await client.premium.card({ project: P })).line), ALLOW_PAID);
      await client.premium.check({ project: P });
      // No run yet, or only passes, or a failure under another Yes: nothing to record.
      assert.match((await client.premium.failed({ project: P })).why, /no trial/);
      const yes = (await c.views()).premium.setting;
      barRun(c.evals, { level: 'premium', pins: PREMIUM_PINS, yes: '99999999-2222-4333-8444-555555555555', fail: () => true, at: '2026-10-25T07:00:00.000Z' });
      assert.match((await client.premium.failed({ project: P })).why, /no trial/);
      // Failed under this Yes, on other pins for the other two classes: still recorded.
      barRun(c.evals, { level: 'premium', pins: { ...PREMIUM_PINS, midSized: 'model-mid-other' }, yes, fail: (s, t) => s === '22' && t === 2 });
      const got = await client.premium.failed({ project: P });
      assert.deepEqual([got.ok, got.recorded, got.failed], [true, true, ['scenario 22 trial 2 failed']]);
      const [record] = await c.events('premium-failed');
      assert.ok(await as(c.home, () => verify(record, readEnrolled())), 'signed by this computer');
      const views = await c.views();
      assert.deepEqual(record.data, { setting: views.premium.setting, model: PREMIUM, failed: ['scenario 22 trial 2 failed'] });
      assert.equal(views.premium.failed.id, record.id);
      assert.deepEqual(views.premiumFailures.map((f) => [f.id, f.card]), [[record.id, null]]);
      // Once per Yes; the eval is told it failed, and no pass can be recorded under this Yes.
      assert.match((await client.premium.failed({ project: P })).why, /recorded already/);
      assert.equal((await client.premium.state({ project: P })).failed, true);
      barRun(c.evals, { level: 'premium', pins: PREMIUM_PINS, yes, at: '2026-10-25T09:00:00.000Z' });
      const { records } = readiness({ evals: c.evals, level: 'premium', pins: PREMIUM_PINS, yes });
      assert.match((await client.state.columnReady({ project: P, column: 'premium', pins: PREMIUM_PINS, records })).refused, /stays off/);
      // Sent in by anyone else, it is refused.
      assert.match((await client.state.record({ project: P, event: record })).refused, /only the helper records/);
      // The card offers a new Yes, from off, and that Yes starts afresh: no failure, a check of its own.
      c.current = 'off';
      const fresh = await client.premium.card({ project: P });
      assert.equal(fresh.offered, true, fresh.why);
      assert.equal((await c.events('premium-card')).at(-1).data.from, 'off');
      assert.equal((await click(c, client, cardOf(fresh.line), ALLOW_PAID)).ok, true);
      const after = await c.views();
      assert.equal(after.premium.failed, null);
      assert.equal(after.premium.check, null);
    });
  } finally { c.cleanup(); }
});

test('a failure record a run\'s word alone claims, its trial record not showing a failure, is not recorded', async () => {
  const c = await computer();
  try {
    await c.withHelper(async (client) => {
      await atThorough(c, client);
      await click(c, client, cardOf((await client.premium.card({ project: P })).line), ALLOW_PAID);
      await client.premium.check({ project: P });
      const run = barRun(c.evals, { level: 'premium', pins: PREMIUM_PINS, yes: (await c.views()).premium.setting });
      // The run record says a trial failed, but the trial's own record says it passed.
      const kept = JSON.parse(fs.readFileSync(run, 'utf8'));
      kept.runs[0] = { ...kept.runs[0], pass: false };
      fs.writeFileSync(run, JSON.stringify(kept));
      assert.equal((await client.premium.failed({ project: P })).recorded, false);
      assert.deepEqual(await c.events('premium-failed'), []);
    });
  } finally { c.cleanup(); }
});
