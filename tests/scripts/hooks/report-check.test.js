// tests/scripts/hooks/report-check.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, parseReport } from '../../../scripts/hooks/report-check.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { stateDir } from '../../../scripts/lib/paths.js';

const P = 'owner__name';
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const NOW = new Date('2026-10-18T05:00:00.000Z');

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-rc-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function fake({ pr = { ok: true, result: { headSha: FULL, state: 'open' } }, refuse = false } = {}) {
  const calls = { write: [], record: [], prState: [] };
  const no = { ok: false, refused: 'no' };
  return {
    calls,
    prState: async (b) => { calls.prState.push(b); return pr; },
    state: {
      write: async (b) => { calls.write.push(b); return refuse ? no : { ok: true }; },
      record: async (b) => { calls.record.push(b); return refuse ? no : { ok: true }; },
    },
  };
}

const reviewer = (extra = {}) => ['WHEELHOUSE REPORT', 'role: reviewer', 'pr: 7', `commit: ${FULL}`, 'verdict: CLEAN', ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`)].join('\n');
const builder = ['WHEELHOUSE REPORT', 'role: builder', 'pr: 7', `commit: ${FULL}`, 'status: done', 'tests: all pass', 'assumptions: none', 'concerns: none'].join('\n');
const stop = (type, text, extra = {}) => ({ cwd: '/x', hook_event_name: 'SubagentStop', agent_type: type, agent_id: 'ag1', session_id: 's1', last_assistant_message: text, ...extra });
const deps = (client) => ({ client, now: () => NOW, projectOf: () => ({ project: P }) });
const countFile = (id = 'ag1') => path.join(stateDir(P), '..', 'report-check', `${id}.json`);

test('a complete reviewer report of the current head writes a signed review', async () => {
  await withHome(async () => {
    const c = fake();
    const out = await decide(stop('wheelhouse:reviewer', `Done.\n${reviewer({ check: 'lint abc123' })}`, { claudeCode: '2.1.5', model: 'm1' }), deps(c));
    assert.equal(out, undefined);
    assert.deepEqual(c.calls.prState, [{ project: P, number: 7 }]);
    const [rec] = c.calls.record;
    assert.equal(rec.event.kind, 'review');
    assert.deepEqual(rec.event.data, { pr: 7, commit: FULL, verdict: 'CLEAN', findings: 0, check: 'lint abc123', claudeCode: '2.1.5', model: 'm1' });
    assert.ok(rec.event.sig);
    const pending = path.join(stateDir(P), '..', 'pending');
    assert.deepEqual(fs.existsSync(pending) ? fs.readdirSync(pending) : [], []);
  });
});

test('the version and model come from the agent\'s own transcript, never the parent\'s', async () => {
  await withHome(async (home) => {
    const entry = (type, version, model) => JSON.stringify({ type, version, message: { model } });
    const t = path.join(home, 'agent.jsonl');
    fs.writeFileSync(t, ['not json', entry('assistant', '2.0.9', 'older'), JSON.stringify({ type: 'user', message: {} }),
      entry('assistant', '2.1.0', 'newer'), entry('assistant', '2.1.1', '<synthetic>'), JSON.stringify({ type: 'assistant', version: '2.1.2', message: {} }), '{bad'].join('\n'));
    const parent = path.join(home, 'parent.jsonl');
    fs.writeFileSync(parent, `${entry('assistant', '9.9.9', 'parent-model')}\n`);
    const c = fake();
    await decide(stop('wheelhouse:reviewer', reviewer(), { agent_transcript_path: t, transcript_path: parent }), deps(c));
    assert.equal(c.calls.record[0].event.data.claudeCode, '2.1.0');
    assert.equal(c.calls.record[0].event.data.model, 'newer');
    const d = fake();
    await decide(stop('wheelhouse:reviewer', reviewer(), { transcript_path: parent, agent_transcript_path: path.join(home, 'none') }), deps(d));
    assert.equal(d.calls.record[0].event.data.claudeCode, 'unknown');
    assert.equal(d.calls.record[0].event.data.model, 'unknown');
  });
});

test('only the last 256 KB of a large transcript is read', async () => {
  await withHome(async (home) => {
    const t = path.join(home, 'big.jsonl');
    const last = JSON.stringify({ type: 'assistant', version: '2.1.0', message: { model: 'tail' } });
    fs.writeFileSync(t, `${'x'.repeat(600 * 1024)}\n${last}\n`);
    const c = fake();
    await decide(stop('wheelhouse:reviewer', reviewer(), { agent_transcript_path: t }), deps(c));
    assert.equal(c.calls.record[0].event.data.model, 'tail');
  });
});

test('a report from an agent typed reviewer without the plugin\'s name writes nothing', async () => {
  await withHome(async () => {
    const c = fake();
    assert.equal(await decide(stop('reviewer', reviewer()), deps(c)), undefined);
    assert.equal(await decide(stop('general-purpose', 'nothing'), deps(c)), undefined);
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.prState.length, 0);
    assert.equal(fs.existsSync(countFile()), false);
  });
});

test('a report naming an older commit, a closed pull request or another number writes nothing', async () => {
  await withHome(async () => {
    const old = fake({ pr: { ok: true, result: { headSha: '1'.repeat(40), state: 'open' } } });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(old));
    const closed = fake({ pr: { ok: true, result: { headSha: FULL, state: 'closed' } } });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(closed));
    const down = fake({ pr: null });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(down));
    for (const c of [old, closed, down]) assert.equal(c.calls.record.length, 0);
  });
});

test('a report with missing fields is sent back twice, then noted', async () => {
  await withHome(async () => {
    const c = fake();
    const text = 'WHEELHOUSE REPORT\nrole: reviewer\npr: 7\nverdict: CLEAN';
    for (let i = 0; i < 2; i += 1) {
      const out = await decide(stop('wheelhouse:reviewer', text), deps(c));
      assert.equal(out.decision, 'block');
      assert.match(out.reason, /commit/);
    }
    assert.equal(JSON.parse(fs.readFileSync(countFile(), 'utf8')).count, 2);
    assert.equal(await decide(stop('wheelhouse:reviewer', text), deps(c)), undefined);
    assert.deepEqual(c.calls.write.map((w) => w.kind), ['note']);
    assert.equal(c.calls.record.length, 0);
  });
});

test('the count is kept per agent, falling back to the session', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(stop('wheelhouse:builder', 'no report', { agent_id: undefined }), deps(c));
    assert.ok(fs.existsSync(countFile('s1')));
    await decide(stop('wheelhouse:builder', 'no report', { agent_id: 'other' }), deps(c));
    assert.ok(fs.existsSync(countFile('other')));
  });
});

test('only the last report counts, and a role that does not match the agent is a missing field', async () => {
  await withHome(async () => {
    const c = fake();
    const out1 = await decide(stop('wheelhouse:reviewer', `${reviewer()}\n\nlater\n${builder}`), deps(c));
    assert.equal(out1.decision, 'block');
    assert.equal(c.calls.record.length, 0);
    const out = await decide(stop('wheelhouse:reviewer', builder, { agent_id: 'x3' }), deps(c));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /role/);
  });
});

test('field values are checked', () => {
  const ok = parseReport(`WHEELHOUSE REPORT\nrole: reviewer\npr: 7\ncommit: ${FULL}\nverdict: FINDINGS\nfindings: 3`);
  assert.deepEqual(ok.missing, []);
  assert.equal(ok.fields.findings, '3');
  const bad = parseReport(`WHEELHOUSE REPORT\nrole: reviewer\npr: 0\ncommit: ${FULL.toUpperCase()}\nverdict: MAYBE`);
  assert.deepEqual(bad.missing.sort(), ['commit', 'pr', 'verdict']);
  assert.ok(parseReport(`WHEELHOUSE REPORT\nrole: reviewer\npr: 7\ncommit: ${FULL}\nverdict: FINDINGS`).missing.includes('findings'));
  assert.ok(parseReport('WHEELHOUSE REPORT\nrole: builder\npr: 7\ncommit: x\nstatus: finished').missing.includes('status'));
  assert.ok(parseReport('nothing here').missing.includes('role'));
  const stopped = parseReport(`WHEELHOUSE REPORT\nrole: reviewer\npr: 7\n\ncommit: ${FULL}\nverdict: CLEAN`);
  assert.ok(stopped.missing.includes('commit'));
});

test('a builder report never writes a review', async () => {
  await withHome(async () => {
    const c = fake();
    assert.equal(await decide(stop('wheelhouse:builder', builder), deps(c)), undefined);
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.prState.length, 0);
  });
});

test('a builder report needs tests, assumptions and concerns as non-empty lines', async () => {
  await withHome(async () => {
    const without = builder.split('\n').filter((l) => !l.startsWith('concerns')).join('\n');
    const out = await decide(stop('wheelhouse:builder', without), deps(fake()));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /concerns/);
    const empty = await decide(stop('wheelhouse:builder', `${without}\nconcerns:`, { agent_id: 'b2' }), deps(fake()));
    assert.match(empty.reason, /concerns/);
    assert.deepEqual(parseReport(builder, 'builder').missing, []);
  });
});

test('the scan stops at the first line that is not key: value', () => {
  const r = parseReport(`WHEELHOUSE REPORT\nrole: reviewer\npr: 7\nsome prose\ncommit: ${FULL}\nverdict: CLEAN`, 'reviewer');
  assert.deepEqual(r.missing.sort(), ['commit', 'verdict']);
});

test('CRLF line endings are read', async () => {
  await withHome(async () => {
    const c = fake();
    await decide(stop('wheelhouse:reviewer', reviewer().replaceAll('\n', '\r\n')), deps(c));
    assert.equal(c.calls.record.length, 1);
  });
});

test('the check field must be a name and a fingerprint', () => {
  const base = `WHEELHOUSE REPORT\nrole: reviewer\npr: 7\ncommit: ${FULL}\nverdict: CLEAN`;
  assert.deepEqual(parseReport(`${base}\ncheck: lint ab:12+/=._-`, 'reviewer').missing, []);
  for (const v of ['lint', 'lint a b', 'li nt abc', `${'n'.repeat(65)} abc`, 'lint a$b']) {
    assert.deepEqual(parseReport(`${base}\ncheck: ${v}`, 'reviewer').missing, ['check'], v);
  }
});

test('an agent_id with path parts stays inside the report-check folder', async () => {
  await withHome(async () => {
    await decide(stop('wheelhouse:builder', 'none', { agent_id: '../../evil' }), deps(fake()));
    const folder = path.join(stateDir(P), '..', 'report-check');
    const names = fs.readdirSync(folder);
    assert.equal(names.length, 1);
    assert.ok(!names[0].includes('..') && !names[0].includes('/'));
    assert.equal(fs.existsSync(path.join(stateDir(P), '..', '..', 'evil.json')), false);
  });
});

test('after the note the count file is removed', async () => {
  await withHome(async () => {
    const c = fake();
    for (let i = 0; i < 3; i += 1) await decide(stop('wheelhouse:builder', 'none'), deps(c));
    assert.equal(fs.existsSync(countFile()), false);
    assert.equal(c.calls.write.length, 1);
  });
});

const noteTexts = (c) => c.calls.write.filter((w) => w.kind === 'note').map((w) => w.data.text);
const pendingFiles = (route) => {
  const folder = path.join(stateDir(P), '..', 'pending');
  const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter((n) => n.endsWith('.json')) : [];
  return route ? names.filter((n) => JSON.parse(fs.readFileSync(path.join(folder, n), 'utf8')).route === route) : names;
};

test('a complete report that cannot be recorded writes a note naming why', async () => {
  await withHome(async () => {
    const moved = fake({ pr: { ok: true, result: { headSha: '1'.repeat(40), state: 'open' } } });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(moved));
    assert.match(noteTexts(moved)[0], /head has moved/);
    const closed = fake({ pr: { ok: true, result: { headSha: FULL, state: 'closed' } } });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(closed));
    assert.match(noteTexts(closed)[0], /not open/);
    const down = fake({ pr: null });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(down));
    assert.match(noteTexts(down)[0], /helper/);
    assert.equal(pendingFiles().length, 0);
  });
});

test('a review the helper refuses or never answers stays in pending', async () => {
  await withHome(async () => {
    const refusing = fake({ refuse: true });
    await decide(stop('wheelhouse:reviewer', reviewer()), deps(refusing));
    assert.equal(pendingFiles('record').length, 1);
    assert.match(noteTexts(refusing)[0] ?? '', /helper/);
  });
  await withHome(async () => {
    const hang = fake();
    hang.state.record = () => new Promise(() => {});
    const started = Date.now();
    await decide(stop('wheelhouse:reviewer', reviewer()), { ...deps(hang), budget: 150 });
    assert.ok(Date.now() - started < 2000);
    assert.equal(pendingFiles('record').length, 1);
  });
});

const none = (text) => text.replace('pr: 7', 'pr: none');

test('pr: none is a complete value, alongside a positive integer', () => {
  assert.deepEqual(parseReport(none(builder), 'builder').missing, []);
  assert.deepEqual(parseReport(none(reviewer()), 'reviewer').missing, []);
  for (const v of ['None', 'NONE', 'n/a', '', '-1', '0', '1.5']) {
    assert.deepEqual(parseReport(`WHEELHOUSE REPORT\nrole: reviewer\npr: ${v}\ncommit: ${FULL}\nverdict: CLEAN`, 'reviewer').missing, ['pr'], v);
  }
  assert.ok(parseReport(none(reviewer()).replace(`commit: ${FULL}`, 'commit: x'), 'reviewer').missing.includes('commit'));
});

test('a builder report with pr: none is not sent back', async () => {
  await withHome(async () => {
    const c = fake();
    assert.equal(await decide(stop('wheelhouse:builder', none(builder)), deps(c)), undefined);
    assert.equal(fs.existsSync(countFile()), false);
    assert.equal(c.calls.write.length, 0);
    assert.equal(c.calls.record.length, 0);
  });
});

test('a reviewer report with pr: none is not sent back, and records nothing or asks the helper nothing', async () => {
  await withHome(async () => {
    const c = fake();
    for (const text of [none(reviewer()), none(reviewer({ check: 'lint abc123' }))]) {
      assert.equal(await decide(stop('wheelhouse:reviewer', text), deps(c)), undefined);
    }
    assert.equal(fs.existsSync(countFile()), false);
    assert.equal(c.calls.prState.length, 0);
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.write.length, 0);
    assert.deepEqual(pendingFiles(), []);
  });
});

test('a reviewer report with pr: none and findings is also complete and signs nothing', async () => {
  await withHome(async () => {
    const c = fake();
    const text = `WHEELHOUSE REPORT\nrole: reviewer\npr: none\ncommit: ${FULL}\nverdict: FINDINGS\nfindings: 2`;
    assert.equal(await decide(stop('wheelhouse:reviewer', text), deps(c)), undefined);
    assert.equal(c.calls.record.length, 0);
    assert.equal(c.calls.prState.length, 0);
  });
});
