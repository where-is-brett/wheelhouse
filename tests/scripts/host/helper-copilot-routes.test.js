// tests/scripts/host/helper-copilot-routes.test.js
// The helper's routes for hooks that only read (Part 5 Task 3, rulings P5-17 to P5-19): STOP set by the director's
// word, a session's marks, and a click in the chat recorded unsigned with its proof; the board's line for a tool
// Wheelhouse doesn't know; and the gate, which takes a chat click only where the project has no real users.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { runEntry } from '../../../scripts/agents/copilot/hook-entry.js';
import { CONTEXT as STOP_CONTEXT } from '../../../scripts/hooks/stop-word.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { stopState } from '../../../scripts/lib/stop.js';
import { listEvents, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { gateDecision, leanMergeDecision } from '../../../scripts/gate/conditions.js';
import { boardModel } from '../../../scripts/board/model.js';
import { SAFETY_LINES } from '../../../scripts/agents/safety-lines.js';
import { CHAT_PROOFS } from '../../../scripts/agents/chat-clicks.js';
import { PROOFS } from '../../../scripts/lib/copilot-numbers.js';

// No real gh, glab, copilot or curl runs (P5-44): the PATH finds the stand-ins first, and the helper's own runs
// go through a guard whose log stays empty.
const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const PROJECT = 'shop';
const T0 = new Date('2026-10-23T01:00:00.000Z');
const HEAD = 'a'.repeat(40);
const HASH = crypto.createHash('sha256').update('Merge the login page?').digest('hex');

// A computer with a home of its own, an enrolled key, and a Lean project; its helper runs in this process, so the
// home stays set until it is closed.
async function computer() {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  registerLean({ project: PROJECT, folder, now: () => T0 });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  let tick = 0;
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  });
  return {
    home,
    folder: fs.realpathSync.native(folder),
    client: helperClient({ address: helper.address }),
    events: () => listEvents(stateDir(PROJECT), { report: () => {} }),
    close: async () => {
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test('the STOP word on Copilot sets STOP through the helper', async () => {
  const c = await computer();
  try {
    const raw = { sessionId: 's1', timestamp: 0, cwd: c.folder, prompt: 'stop' };
    const out = await runEntry('userPromptSubmitted', {
      stdin: Readable.from([JSON.stringify(raw)]), env: { COPILOT_CLI_BINARY_VERSION: '1.0.101' }, deps: { dir: path.join(c.home, 'none'), client: c.client },
    });
    assert.equal(JSON.parse(out.text).additionalContext.split('\n\n')[0], STOP_CONTEXT);
    assert.deepEqual([stopState().on, stopState().by], [true, 'prompt']);
    // Any other setter, or none, is still the helper.
    for (const by of [undefined, 'helper', 'mod', 'someone']) {
      fs.rmSync(path.join(c.home, 'STOP'), { recursive: true, force: true });
      assert.equal((await c.client.stop(by === undefined ? {} : { by })).ok, true);
      assert.equal(stopState().by, 'helper', String(by));
    }
  } finally {
    await c.close();
  }
});

test('a chat click is recorded unsigned with its proof', async () => {
  const c = await computer();
  try {
    assert.deepEqual(CHAT_PROOFS, ['chat-click']);
    assert.ok(CHAT_PROOFS.every((p) => PROOFS.includes(p)));
    const click = { project: PROJECT, card: 'merge-login', hash: HASH, label: 'Approve', proof: 'chat-click', commit: HEAD };
    const got = await c.client.cards.chatClick(click);
    assert.equal(got.ok, true, got.refused);
    const answer = c.events().find((e) => e.id === got.id);
    assert.equal(answer.kind, 'card-answer');
    assert.deepEqual(answer.data, { question: 'merge-login', label: 'Approve', hash: HASH, commit: HEAD, proof: 'chat-click' });
    assert.equal(answer.sig, undefined, 'never signed');
    // Placed from the folder, as the chat's command sends it; a plain label on any card; a guardrail card at Lean.
    assert.equal((await c.client.cards.chatClick({ cwd: c.folder, card: 'pick-colour', hash: HASH, label: 'Blue', proof: 'chat-click' })).ok, true);
    assert.equal((await c.client.cards.chatClick({ ...click, card: 'guardrail-tool-guard', commit: undefined, label: 'Change it' })).ok, true);

    // Refused, and nothing written: a proof the chat can't give, a hook-click before check 59, a confirmed step,
    // a signed label on a card a chat click can't decide, and malformed fields.
    const count = c.events().length;
    const refusals = [
      [{ ...click, proof: 'hook-click' }, /recorded as chat-click/],
      [{ ...click, proof: 'window' }, /recorded as chat-click/],
      [{ ...click, proof: 'signed-hook' }, /recorded as chat-click/],
      [{ ...click, proof: undefined }, /recorded as chat-click/],
      [{ ...click, card: 'lift-stop', label: 'Lift STOP', commit: undefined }, /confirmed outside the chat/],
      [{ ...click, card: 'ci-push', label: 'Push it', commit: undefined }, /confirmed outside the chat/],
      [{ ...click, card: 'guardrail-change-tool-guard', label: 'Change it', commit: undefined }, /confirmed outside the chat/],
      [{ ...click, card: 'lift-stop-now', label: 'Lift STOP', commit: undefined }, /confirmed outside the chat/],
      [{ ...click, card: 'release-notes', label: 'Approve' }, /can't decide that card/],
      [{ ...click, hash: 'abc' }, /sha256/],
      [{ ...click, commit: 'abc123' }, /in full/],
      [{ ...click, label: '' }, /option chosen/],
      [{ ...click, card: '' }, /card must be named/],
    ];
    for (const [body, why] of refusals) {
      const refused = await c.client.cards.chatClick(body);
      assert.equal(refused.ok, false, JSON.stringify(body));
      assert.match(refused.refused, why, JSON.stringify(body));
    }
    // /state/write, which anyone who reaches the helper may call, can't name a click's proof, commit or hash
    // (ruling P5-48), so it can't make what the gate reads as a click; a plain answer still goes through it.
    for (const data of [{ question: 'merge-login', label: 'Approve', commit: HEAD, proof: 'window' }, { question: 'merge-login', label: 'Approve', proof: 'chat-click' }, { question: 'x', label: 'Approve', hash: HASH }, { question: 'x', label: 'Approve', commit: HEAD }]) {
      const forged = await c.client.state.write({ project: PROJECT, kind: 'card-answer', data });
      assert.equal(forged.ok, false, JSON.stringify(data));
      assert.match(forged.refused, /only by the helper's own routes/);
    }
    assert.equal(c.events().length, count);
    assert.equal((await c.client.state.write({ project: PROJECT, kind: 'card-answer', data: { question: 'Pick a colour?', label: 'Blue' } })).ok, true);
    // The event shape takes a click's fields and no others.
    assert.throws(() => makeEvent({ kind: 'card-answer', data: { label: 'Approve', signedBy: 'me' } }), /a field it should not/);
    assert.throws(() => makeEvent({ kind: 'card-answer', data: { question: 'x' } }), /needs its label/);
  } finally {
    await c.close();
  }
});

test('a session\'s marks are plain notes, and the board says a tool is waiting on Wheelhouse', async () => {
  const c = await computer();
  try {
    for (const [mark, data] of [['unknown-tool', { name: 'apply_patch_v2' }], ['compaction', { trigger: 'auto' }], ['compaction', {}], ['deadline', { event: 'preToolUse' }]]) {
      const got = await c.client.session.mark({ project: PROJECT, mark, data });
      assert.equal(got.ok, true, `${mark}: ${got.refused}`);
      const note = c.events().find((e) => e.id === got.id);
      assert.equal(note.kind, 'note');
      assert.deepEqual(note.data, { mark, ...data });
      assert.equal(note.sig, undefined);
    }
    for (const body of [{ mark: 'managed', data: {} }, { mark: 'unknown-tool', data: {} }, { mark: 'unknown-tool', data: { name: 'x', extra: 1 } }, { mark: 'deadline', data: { event: 'a\nb' } }, { mark: 'compaction', data: [] }]) {
      const refused = await c.client.session.mark({ project: PROJECT, ...body });
      assert.equal(refused.ok, false, JSON.stringify(body));
    }

    // The board's line, in the agent's words, for a mark in the last seven days, once per tool.
    const now = new Date(T0.getTime() + 60_000);
    const health = (events, agent, at = now) => boardModel({ project: PROJECT, views: {}, events, usage: {}, health: [], settings: {}, agent, now: at }).director.health.map((l) => l.text);
    const marked = c.events();
    const line = 'Copilot has a tool Wheelhouse doesn\'t know yet, `apply_patch_v2`: it is refused until Wheelhouse is updated';
    assert.equal(SAFETY_LINES.copilot.updateWaiting('apply_patch_v2'), line);
    assert.deepEqual(health([...marked, ...marked], 'copilot').filter((t) => t.includes('doesn\'t know yet')), [line]);
    assert.deepEqual(health(marked, 'copilot', new Date(T0.getTime() + 8 * 86_400_000)).filter((t) => t.includes('doesn\'t know yet')), []);
    assert.deepEqual(health(marked, 'claude-code').filter((t) => t.includes('doesn\'t know yet')), ['Claude Code has a tool Wheelhouse doesn\'t know yet, `apply_patch_v2`: it is refused until Wheelhouse is updated']);
    assert.deepEqual(health(marked, undefined).filter((t) => t.includes('doesn\'t know yet')), []);
  } finally {
    await c.close();
  }
});

test('the gate refuses a real-user merge on a chat click and names what it needs', async () => {
  const c = await computer();
  try {
    const click = (data) => makeEvent({ kind: 'card-answer', data: { question: 'merge-login', label: 'Approve', hash: HASH, commit: HEAD, ...data } });
    const chat = click({ proof: 'chat-click' });
    const enrolled = readEnrolled();
    const base = {
      stop: false, bypass: false, holdsLock: true, headSha: HEAD, ci: { sha: HEAD, state: 'success' }, approvalRequired: true,
      upToDate: true, provenance: { ok: true }, incident: { open: false }, enrolled,
    };
    // No real users: a chat click on the head is the approval.
    assert.deepEqual(gateDecision({ ...base, approval: chat, approvalProofs: ['chat-click'], realUsers: false }), { allow: true, reasons: [] });
    // Real users: it is not, and the refusal names what it needs.
    const refused = gateDecision({ ...base, approval: chat, approvalProofs: ['chat-click', 'window'], realUsers: true });
    assert.equal(refused.allow, false);
    assert.equal(refused.needs, 'window');
    assert.equal(refused.approvalMissing, true);
    assert.deepEqual(refused.reasons, ['no approval of aaaaaaa that counts: the project has real users, so a click in the chat isn\'t enough and it needs the director\'s click in Wheelhouse\'s window']);
    assert.equal(gateDecision({ ...base, approval: chat, approvalProofs: ['chat-click', 'window', 'add-on'], realUsers: true }).needs, 'add-on');
    assert.equal(gateDecision({ ...base, approval: chat, approvalProofs: ['chat-click', 'host'], realUsers: true }).needs, 'host');
    assert.equal(gateDecision({ ...base, approval: chat, approvalProofs: ['chat-click'], realUsers: true }).needs, 'window');
    // A window's or the add-on's proof counts with real users only when it is signed (ruling P5-48): an unsigned
    // record naming one counts for nothing, real users or not. A click on another commit, or a Not now, never does.
    const signedBy = (proof) => makeEvent({ kind: 'approval', data: { pr: 7, commit: HEAD, proof } });
    assert.equal(gateDecision({ ...base, approval: signedBy('window'), approvalProofs: ['chat-click', 'window'], realUsers: true }).allow, true);
    assert.equal(gateDecision({ ...base, approval: signedBy('add-on'), approvalProofs: ['add-on'], realUsers: true }).allow, true);
    assert.equal(gateDecision({ ...base, approval: signedBy('chat-click'), approvalProofs: ['chat-click', 'window'], realUsers: true }).needs, 'window');
    for (const proof of ['window', 'add-on', 'host']) {
      for (const realUsers of [true, false]) {
        const forged = gateDecision({ ...base, approval: click({ proof }), approvalProofs: ['chat-click', 'window', 'add-on', 'host'], realUsers });
        assert.equal(forged.allow, false, `${proof}, real users ${realUsers}`);
      }
    }
    assert.equal(gateDecision({ ...base, approval: click({ proof: 'chat-click', commit: 'b'.repeat(40) }), approvalProofs: ['chat-click'] }).allow, false);
    assert.equal(gateDecision({ ...base, approval: click({ proof: 'chat-click', label: 'Not now' }), approvalProofs: ['chat-click'] }).allow, false);
    assert.equal(gateDecision({ ...base, approval: click({ proof: 'hook-click' }), approvalProofs: ['chat-click'] }).allow, false, 'a proof not taken');
    assert.equal(gateDecision({ ...base, approval: click({}), approvalProofs: ['chat-click'] }).allow, false, 'a click that names no proof');

    // Claude Code's gate is as it was: with neither field, only a signed approval of the head counts.
    const signed = makeEvent({ kind: 'approval', data: { pr: 7, commit: HEAD } });
    for (const extra of [{}, { approvalProofs: ['signed-hook'] }, { approvalProofs: ['signed-hook'], realUsers: true }]) {
      assert.deepEqual(gateDecision({ ...base, approval: signed, ...extra }), { allow: true, reasons: [] });
      assert.deepEqual(gateDecision({ ...base, approval: chat, ...extra }), { allow: false, reasons: ['no approval of aaaaaaa'], approvalMissing: true });
      assert.deepEqual(gateDecision({ ...base, approval: null, ...extra }), { allow: false, reasons: ['no approval of aaaaaaa'], approvalMissing: true });
    }
    assert.deepEqual(gateDecision({ ...base, approvalRequired: false, approval: null }), { allow: true, reasons: [] });

    // A Lean merge: STOP, the approval, the tests at the head and a main branch that hasn't moved; no host condition.
    const lean = { stop: false, approval: chat, approvalProofs: ['chat-click', 'window'], realUsers: false, headSha: HEAD, tests: true, mainMoved: false };
    assert.deepEqual(leanMergeDecision(lean), { allow: true, reasons: [] });
    assert.deepEqual(leanMergeDecision({ ...lean, stop: true, tests: false, mainMoved: true, realUsers: true }), {
      allow: false,
      reasons: [
        'STOP is on',
        'no approval of aaaaaaa that counts: the project has real users, so a click in the chat isn\'t enough and it needs the director\'s click in Wheelhouse\'s window',
        'the tests have not passed on aaaaaaa',
        'the main branch has moved since the tests ran, so they must run again',
      ],
      approvalMissing: true,
      needs: 'window',
    });
    assert.equal(leanMergeDecision({}).allow, false);
    assert.equal(leanMergeDecision(null).allow, false);
  } finally {
    await c.close();
  }
});
