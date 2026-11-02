// tests/scripts/hooks/policy-click.test.js
// A chat click on Copilot is signed only by the policy hook's managed copy, and only once check 59 (C6) allows it.
// C6_PASSED is a constant, so each test gives it through deps; the default reads the real constant (false).
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { policyClick, runEntry } from '../../../scripts/agents/copilot/hook-entry.js';
import { keepEarned } from '../../../scripts/hooks/prompt-record.js';
import { C6_PASSED } from '../../../scripts/lib/copilot-numbers.js';
import copilot from '../../../adapters/copilot/index.js';
import { policyRegistration } from '../../../scripts/agents/copilot/company.js';
import { gateDecision } from '../../../scripts/gate/conditions.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { approvalLine } from '../../../scripts/state/card-lines.js';
import { tempFolder } from '../../helpers/homes.js';

const MANAGED = tempFolder('wh-policy-click-managed-');
const OWN = tempFolder('wh-policy-click-own-');
const CLEAN = tempFolder('wh-policy-click-clean-');
const P = 'owner__name';
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-10-18T05:00:00.000Z');
const inManaged = path.join(MANAGED, 'wheelhouse', 'scripts', 'agents', 'copilot', 'hook-entry.js');
const inOwn = path.join(OWN, 'scripts', 'agents', 'copilot', 'hook-entry.js');
const inClean = path.join(CLEAN, 'wheelhouse', 'scripts', 'agents', 'copilot', 'hook-entry.js');

const answered = { cwd: '/p', tool_name: 'ask_user', tool_input: { questions: [] }, tool_response: { answers: { 'Which one?': 'Yes' } } };

// A stand-in for the prompt record: remembers how it was called.
function spy() {
  const calls = [];
  return { calls, decide: async (given, deps) => { calls.push({ given, deps }); return undefined; } };
}

test('a policy hook signs only when C6_PASSED', async () => {
  const off = spy();
  await policyClick(answered, { c6: false, self: inManaged, dir: MANAGED, decide: off.decide });
  assert.equal(off.calls.length, 0);
  const on = spy();
  await policyClick(answered, { c6: true, self: inManaged, dir: MANAGED, decide: on.decide });
  assert.equal(on.calls.length, 1);
  assert.equal(on.calls[0].deps.proof, 'policy-hook');
  assert.equal(on.calls[0].deps.writeVia, 'self');
  assert.equal(on.calls[0].given.tool_name, 'AskUserQuestion');
  assert.equal(C6_PASSED, false, 'the real constant stays false until check 59 passes');
  const real = spy();
  await policyClick(answered, { self: inManaged, dir: MANAGED, decide: real.decide });
  assert.equal(real.calls.length, 0);
});

test('the person\'s own hook copy never signs', async () => {
  const s = spy();
  await policyClick(answered, { c6: true, self: inOwn, dir: MANAGED, decide: s.decide });
  assert.equal(s.calls.length, 0);
});

test('the clean home\'s copy never signs', async () => {
  const s = spy();
  await policyClick(answered, { c6: true, self: inClean, dir: MANAGED, decide: s.decide });
  assert.equal(s.calls.length, 0);
});

// The real prompt record, with a stand-in helper client.
async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-pc-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}
function client() {
  const calls = { write: [], record: [] };
  const ok = async () => ({ ok: true });
  return {
    calls,
    goalRecheck: async () => ({ ok: true, refused: [] }),
    prState: async () => ({ ok: true, result: { headSha: FULL, state: 'open' } }),
    state: { write: async (b) => { calls.write.push(b); return { ok: true }; }, record: async (b) => { calls.record.push(b); return { ok: true }; } },
    lock: { takeOver: ok },
    profile: { record: ok },
  };
}
const QUESTION = `${approvalLine(7, FULL)}? It changes the sign-in.`;
const OPTIONS = ['Approve', 'Not now'].map((label) => ({ label }));
const promptDeps = (c) => ({ promptDeps: { client: c, now: () => NOW, projectOf: () => ({ project: P }) } });
const copilotCall = (extra) => ({ cwd: '/x', tool_name: 'ask_user', tool_input: { questions: [{ question: QUESTION, options: OPTIONS, multiSelect: false }], answers: { [QUESTION]: 'Approve' } }, ...extra });
const live = { c6: true, self: inManaged, dir: MANAGED };

test('an answer only in tool_input.answers (the model\'s own input, no response) signs nothing', async () => {
  await withHome(async () => {
    for (const response of [{}, { tool_response: {} }, { tool_response: { answers: {} } }, { tool_response: { answers: 'Approve' } }]) {
      const c = client();
      await policyClick(copilotCall(response), { ...live, ...promptDeps(c) });
      assert.deepEqual(c.calls.record, []);
      assert.deepEqual(c.calls.write, []);
    }
  });
});

test('an answer the tool\'s response carries is signed, with the proof policy-hook', async () => {
  await withHome(async () => {
    const c = client();
    // The model's own input claims one answer; the response carries another. Only the response's is read.
    const forged = copilotCall({ tool_response: { answers: { [QUESTION]: 'Approve' } } });
    forged.tool_input.answers = { [QUESTION]: 'Not now' };
    await policyClick(forged, { ...live, ...promptDeps(c) });
    const [rec] = c.calls.record;
    assert.equal(rec.event.kind, 'approval');
    assert.equal(rec.event.data.proof, 'policy-hook');
    assert.equal(rec.event.data.commit, FULL);
    assert.ok(rec.event.sig);
  });
});

test('with no proof given, keepEarned writes the record as it did before', async () => {
  await withHome(async () => {
    const made = { kind: 'approval', data: { pr: 7, commit: FULL, words: 'Approve', question: 'q' } };
    const a = keepEarned(P, { made }, { now: () => NOW, liftStop: () => {} });
    assert.equal(a.body.event.data.proof, undefined);
    assert.ok(!Object.hasOwn(a.body.event.data, 'proof'));
    const b = keepEarned(P, { made }, { now: () => NOW, liftStop: () => {}, proof: 'policy-hook' });
    assert.equal(b.body.event.data.proof, 'policy-hook');
    for (const k of [a, b]) fs.rmSync(k.file, { force: true });
  });
});

// The entry as the policy hook starts it.
const hookRaw = (cwd = '/p') => ({ sessionId: 's', cwd, toolName: 'ask_user', toolArgs: { questions: [] }, toolResult: { answers: { 'Which one?': 'Yes' } } });
const start = (raw, deps, env = { COPILOT_CLI_BINARY_VERSION: '1.0.101' }) => {
  let read = false;
  const stdin = Readable.from((function* () { read = true; yield JSON.stringify(raw); })());
  return runEntry('postToolUse', { stdin, env, deps: { policy: true, dir: MANAGED, lockedByPath: () => true, ...deps } }).then((r) => ({ ...r, read: () => read }));
};

test('the policy hook from a non-managed copy never signs', async () => {
  const s = spy();
  const r = await start(hookRaw(), { c6: true, self: inOwn, decide: s.decide });
  assert.deepEqual([r.text, r.code, s.calls.length], ['', 0, 0]);
});

test('the policy hook signs from the managed copy once C6 allows it, in the Copilot harness only', async () => {
  const s = spy();
  await start(hookRaw(), { c6: true, self: inManaged, decide: s.decide });
  assert.equal(s.calls.length, 1);
  const unknown = spy();
  await start(hookRaw(), { c6: true, self: inManaged, decide: unknown.decide }, {});
  assert.equal(unknown.calls.length, 0, 'an unknown harness signs nothing');
  const outside = spy();
  await start(hookRaw(), { c6: true, self: inManaged, decide: outside.decide, lockedByPath: () => false });
  assert.equal(outside.calls.length, 0);
});

test('--policy with C6 false does nothing and reads nothing', async () => {
  const s = spy();
  const r = await start(hookRaw(), { c6: false, self: inManaged, decide: s.decide });
  assert.deepEqual([r.text, r.code, s.calls.length, r.read()], ['', 0, 0, false]);
});

test('a prompt record that never answers is cut off at the deadline', async () => {
  const r = await start(hookRaw(), { c6: true, self: inManaged, deadlineMs: 50, decide: () => new Promise(() => {}) });
  assert.deepEqual([r.text, r.code], ['', 0]);
});

test('the gate refuses a signed policy-hook approval on a project with real users', async () => {
  await withHome(async () => {
    const approval = makeEvent({ kind: 'approval', data: { pr: 7, commit: FULL, proof: 'policy-hook' } });
    const base = {
      stop: false, bypass: false, holdsLock: true, headSha: FULL, ci: { sha: FULL, state: 'success' }, reviewRequired: false, review: null,
      approvalRequired: true, approval, touchesGuardrails: false, enrolled: readEnrolled(), upToDate: true, provenance: { ok: true }, incident: { open: false }, realUsers: true,
    };
    assert.equal(gateDecision({ ...base, approvalProofs: ['chat-click'] }).allow, false);
    // A caller that names policy-hook in approvalProofs would allow it: the lists callers build must not.
    assert.equal(gateDecision({ ...base, approvalProofs: ['chat-click', 'policy-hook'] }).allow, true);
  });
});

test('no caller that builds approvalProofs for real users names policy-hook', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
  for (const file of ['scripts/host/helper.js', 'scripts/lean/store.js', 'scripts/gate/conditions.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/approvalProofs[^\n]*policy-hook/.test(text), `${file} names policy-hook in approvalProofs`);
  }
  assert.ok(copilot.cards.binding.includes('policy-hook'));
});

test('C6_PASSED is true only once the policy hook file registers postToolUse', () => {
  if (!C6_PASSED) return;
  const hooks = policyRegistration({ node: '/n', root: '/r' }).hooks;
  assert.ok(Array.isArray(hooks.postToolUse) && hooks.postToolUse.length > 0, 'register postToolUse in the policy hook file before C6_PASSED turns true');
});
