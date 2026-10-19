// tests/scripts/state/events.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODE_ALPHABET } from '../../../scripts/state/card-lines.js';
import { makeEvent, eventPath, writeEvent, syncState, listEvents, PLAIN_KINDS, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { stateDir, computerId } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, push } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

// Each "computer" is a home folder (with a space and an accent, to prove paths cope).
async function withHome(fn) {
  const home = path.join(tempFolder('wh-ev-'), 'Zoë home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const at = (ms) => () => new Date(Date.UTC(2026, 9, 18, 1, 2, 3, ms));
const git = (dir, args) => run('git', args, { cwd: dir });

test('makeEvent signs protected kinds and leaves the others unsigned', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const note = makeEvent({ kind: 'note', data: { text: 'hi' }, now: at(5) });
    assert.equal(note.sig, undefined);
    assert.equal(note.v, 1);
    assert.equal(note.at, '2026-10-18T01:02:03.005Z');
    assert.equal(note.computer, computerId());
    const approval = makeEvent({ kind: 'approval', data: { card: 1 }, now: at(5) });
    assert.equal(verify(approval, readEnrolled()), true);
    assert.throws(() => makeEvent({ kind: 'bogus', data: {} }), /kind/);
  });
});

test('eventPath holds the time, computer and kind, and two events in one millisecond differ', async () => {
  await withHome(() => {
    const a = makeEvent({ kind: 'note', data: {}, now: at(7) });
    const b = makeEvent({ kind: 'note', data: {}, now: at(7) });
    const p = eventPath(a);
    assert.match(p.split(path.sep).join('/'), new RegExp(`^events/2026/10/2026-10-18T01-02-03\\.007Z_${a.computer}_note_[0-9a-f]{4}\\.json$`));
    assert.notEqual(eventPath(a), eventPath(b));
  });
});

test('writeEvent commits one new file and pushes it', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      assert.equal(dir, stateDir('o__p'));
      const event = makeEvent({ kind: 'note', data: { text: 'one' } });
      const r = await writeEvent({ project: 'o__p', event, push });
      assert.equal(r.pushed, true);
      assert.ok(fs.existsSync(r.path));
      const log = await git(dir, ['log', '--format=%s|%an|%ae', '-1']);
      assert.equal(log.stdout.trim(), `note ${event.id}|Wheelhouse|wheelhouse@invalid`);
      const files = await git(dir, ['show', '--name-only', '--format=', 'HEAD']);
      assert.equal(files.stdout.trim().split('\n').length, 1);
      const upstream = await run('git', ['--git-dir', remote.url, 'log', '--format=%s', 'wheelhouse-state', '-1']);
      assert.equal(upstream.stdout.trim(), `note ${event.id}`);
      assert.deepEqual(listEvents(dir).map((e) => e.id), [event.id]);
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses to overwrite an existing event file', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const event = makeEvent({ kind: 'note', data: { text: 'one' } });
      await writeEvent({ project: 'o__p', event, push });
      await assert.rejects(writeEvent({ project: 'o__p', event: { ...event, data: { text: 'two' } }, push }), /exists/);
      const kept = JSON.parse(fs.readFileSync(path.join(stateDir('o__p'), eventPath(event)), 'utf8'));
      assert.equal(kept.data.text, 'one');
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses an unsigned protected event', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const event = { v: 1, id: 'x', at: '2026-10-18T01:02:03.000Z', computer: computerId(), kind: 'review', data: {} };
      await assert.rejects(writeEvent({ project: 'o__p', event, push }), /signed/);
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses an event holding a secret, naming the pattern only', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const secret = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
      const event = makeEvent({ kind: 'note', data: { text: secret } });
      await assert.rejects(writeEvent({ project: 'o__p', event, push }), (e) => {
        assert.match(e.message, /github-token/);
        assert.ok(!e.message.includes(secret));
        return true;
      });
      assert.equal(fs.existsSync(path.join(dir, eventPath(event))), false);
      assert.equal((await git(dir, ['status', '--porcelain'])).stdout.trim(), '');
      assert.equal((await git(dir, ['log', '--format=%s'])).stdout.includes('note'), false);
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses a key that follows a newline, a tab or an underscore in an event', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const github = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
      const aws = ['AK', 'IA', 'Q7'.repeat(8)].join('');
      for (const [text, pattern] of [
        [`my token:\n${github}`, /github-token/],
        [`key\t${aws}`, /aws-access-key/],
        [`x\n${aws}`, /aws-access-key/],
        [`MY_${github}`, /github-token/],
      ]) {
        const event = makeEvent({ kind: 'note', data: { text } });
        await assert.rejects(writeEvent({ project: 'o__p', event, push }), (e) => {
          assert.match(e.message, pattern);
          assert.ok(!e.message.includes(github) && !e.message.includes(aws));
          return true;
        });
        assert.equal(fs.existsSync(path.join(dir, eventPath(event))), false);
      }
      assert.equal((await git(dir, ['status', '--porcelain'])).stdout.trim(), '');
    });
  } finally { remote.cleanup(); }
});

test('two clones writing at the same moment both land, and neither is lost', async () => {
  const remote = await makeBareRemote();
  try {
    const fixed = at(9);
    let idA; let idB; let homeB; let dirA; let dirB;
    await withHome(async () => {
      dirA = await cloneState({ project: 'o__p', remoteUrl: remote.url });
    });
    await withHome(async (home) => {
      homeB = home;
      dirB = await cloneState({ project: 'o__p', remoteUrl: remote.url });
    });
    const inHome = async (home, fn) => {
      const before = process.env.WHEELHOUSE_HOME;
      process.env.WHEELHOUSE_HOME = home;
      try { return await fn(); } finally { process.env.WHEELHOUSE_HOME = before; }
    };
    const homeA = path.dirname(path.dirname(path.dirname(dirA))); // .../home/projects/o__p/state -> home
    await inHome(homeA, async () => {
      const e = makeEvent({ kind: 'note', data: { text: 'A' }, now: fixed });
      idA = e.id;
      assert.equal((await writeEvent({ project: 'o__p', event: e, push })).pushed, true);
    });
    await inHome(homeB, async () => {
      const e = makeEvent({ kind: 'note', data: { text: 'B' }, now: fixed });
      idB = e.id;
      let pushes = 0;
      const counting = (d, b) => { pushes += 1; return push(d, b); };
      assert.equal((await writeEvent({ project: 'o__p', event: e, push: counting })).pushed, true);
      assert.equal(pushes, 2); // rejected once, pulled, pushed
    });
    await inHome(homeA, () => syncState({ project: 'o__p', push }));
    await inHome(homeB, () => syncState({ project: 'o__p', push }));
    for (const d of [dirA, dirB]) {
      assert.deepEqual(listEvents(d).map((e) => e.id).sort(), [idA, idB].sort());
    }
  } finally { remote.cleanup(); }
});

test('an event committed while the push failed is pushed by the next sync', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const event = makeEvent({ kind: 'note', data: { text: 'late' } });
      const refusing = async () => ({ ok: false, refused: 'protected branch' });
      const r = await writeEvent({ project: 'o__p', event, push: refusing });
      assert.equal(r.pushed, false);
      assert.equal(r.refused, 'protected branch');
      const before = await run('git', ['--git-dir', remote.url, 'log', '--format=%s', 'wheelhouse-state']);
      assert.ok(!before.stdout.includes(event.id));
      assert.deepEqual(await syncState({ project: 'o__p', push: refusing }), { pulled: true, unpushed: 1 }, 'the commit is still the remote\'s to receive');
      assert.deepEqual(await syncState({ project: 'o__p', push }), { pulled: true, unpushed: 0 });
      const after = await run('git', ['--git-dir', remote.url, 'log', '--format=%s', 'wheelhouse-state']);
      assert.ok(after.stdout.includes(event.id));
    });
  } finally { remote.cleanup(); }
});

test('listEvents skips a damaged file and reports it once', async () => {
  await withHome(async (home) => {
    const dir = path.join(home, 'plain');
    const folder = path.join(dir, 'events', '2026', '10');
    fs.mkdirSync(folder, { recursive: true });
    const ok = { v: 1, id: 'b', at: '2026-10-18T01:00:00.000Z', computer: 'aaaaaaaa', kind: 'note', data: {} };
    fs.writeFileSync(path.join(folder, 'good.json'), JSON.stringify(ok));
    fs.writeFileSync(path.join(folder, 'bad.json'), '{ not json SECRETTEXT');
    const reports = [];
    assert.deepEqual(listEvents(dir, { report: (m) => reports.push(m) }).map((e) => e.id), ['b']);
    listEvents(dir, { report: (m) => reports.push(m) });
    assert.equal(reports.length, 1);
    assert.match(reports[0], /bad\.json/);
    assert.ok(!reports[0].includes('SECRETTEXT'));
  });
});

test('writeEvent gives up after three retries and leaves the commit unpushed', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await cloneState({ project: 'o__p', remoteUrl: remote.url });
      let pushes = 0;
      const never = async () => { pushes += 1; return { ok: false, rejected: 'non-fast-forward' }; };
      const r = await writeEvent({ project: 'o__p', event: makeEvent({ kind: 'note', data: {} }), push: never });
      assert.equal(r.pushed, false);
      assert.equal(pushes, 4);
    });
  } finally { remote.cleanup(); }
});

test('an unreadable event file is refused, naming the file and leaving nothing committed', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const event = makeEvent({ kind: 'note', data: { text: 'plain' } });
      const name = path.basename(eventPath(event));
      const real = fs.readFileSync;
      fs.readFileSync = (f, ...rest) => {
        if (String(f).endsWith(name)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return real(f, ...rest);
      };
      try {
        await assert.rejects(writeEvent({ project: 'o__p', event, push }), (e) => {
          assert.ok(e.message.includes(name));
          assert.match(e.message, /unreadable/);
          return true;
        });
      } finally { fs.readFileSync = real; }
      assert.equal(fs.existsSync(path.join(dir, eventPath(event))), false);
      assert.equal((await git(dir, ['status', '--porcelain'])).stdout.trim(), '');
    });
  } finally { remote.cleanup(); }
});

test('a review needs the pull request and the commit, and typed optional fields', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const good = { pr: 3, commit: 'a'.repeat(40), verdict: 'FINDINGS', findings: 2, check: 'lint abc', claudeCode: '2.1.0', model: 'unknown' };
    assert.ok(makeEvent({ kind: 'review', data: good }).sig);
    for (const bad of [
      { ...good, commit: 7 }, { ...good, pr: 0 }, { ...good, verdict: 3 },
      { ...good, findings: -1 }, { ...good, model: 4 }, null,
    ]) {
      assert.throws(() => makeEvent({ kind: 'review', data: bad }), /review event/);
    }
  });
});

test('a failed commit leaves no empty month folder', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
      const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const event = makeEvent({ kind: 'note', data: { text: 'plain' }, now: () => new Date('2031-03-04T05:06:07.000Z') });
      await assert.rejects(writeEvent({ project: 'o__p', event, push }), /could not be committed/);
      assert.equal(fs.existsSync(path.join(dir, 'events', '2031')), false, 'the year and month folders are gone');
      // an earlier month's folder, with an event in it, stays
      fs.rmSync(hook);
      const earlier = makeEvent({ kind: 'note', data: { text: 'first' }, now: () => new Date('2031-02-04T05:06:07.000Z') });
      await writeEvent({ project: 'o__p', event: earlier, push });
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      await assert.rejects(writeEvent({ project: 'o__p', event, push }), /could not be committed/);
      assert.deepEqual(fs.readdirSync(path.join(dir, 'events', '2031')), ['02']);
    });
  } finally { remote.cleanup(); }
});

test('blocker, risk and decision events are accepted as plain kinds', async () => {
  await withHome(() => {
    const kinds = [
      ['blocker', { key: 'login', what: 'Sign-in is not built', resolved: false }],
      ['risk', { key: 'hard-coded-rates', what: 'Rates are typed in', costLater: 'A day to move them out' }],
      ['decision', { what: 'Use the existing form', why: 'It is already tested', level: 1 }],
    ];
    for (const [kind, data] of kinds) {
      const e = makeEvent({ kind, data, now: at(1) });
      assert.equal(e.kind, kind);
      assert.equal(e.sig, undefined);
    }
  });
});

// --- the build loop's records ---

const H = 'abcdef0123456789'.repeat(4);
const SHAPES = {
  work: { id: 'export-csv', title: 'Export as CSV', lane: 'feature', doc: { path: 'docs/specs/export.md', hash: H }, visible: true, dependsOn: ['login'], place: 2, parent: 'export' },
  feature: { work: 'export-csv', step: 'building', worktree: '/w/export', branch: 'feature/export-csv', session: 's1', plan: 'docs/plans/export.md', files: ['src/a.js'], brief: H, slice: { n: 1, m: 2 } },
  question: { id: 'q-export-csv-1', work: 'export-csv', what: 'Which separator?', why: 'It changes the file', options: [{ label: 'Comma', says: 'Commas' }, { label: 'Tab', says: 'Tabs' }], recommendation: 'Comma', level: 2, commands: ['npm test'] },
  report: { work: 'export-csv', outcome: 'merged', pr: 12, summary: 'Export now writes CSV.', rulings: ['Totals to the cent'], provenance: { wheelhouse: '1.0.0' } },
  incident: { id: 'bad-total', what: 'Totals are wrong in production' },
  amendment: { work: 'export-csv', change: 'Make it CSV, not Excel', hash: H },
  'gate-asks': { work: 'export-csv', pr: 12, ask: 'approval', sha: 'b'.repeat(40) },
};

test('each new plain kind is accepted with its shape and refused without it', async () => {
  await withHome(() => {
    for (const [kind, data] of Object.entries(SHAPES)) {
      const event = makeEvent({ kind, data });
      assert.equal(event.sig, undefined, `${kind} is plain`);
      assert.deepEqual(event.data, data);
      // The optional fields may all be left out.
      const required = {
        work: ['id', 'title', 'lane', 'visible', 'dependsOn'], feature: ['work', 'step'], question: ['id', 'work', 'what', 'why', 'options', 'recommendation', 'level'],
        report: ['work', 'outcome', 'summary', 'rulings'], incident: ['id', 'what'], amendment: ['work', 'change', 'hash'],
        'gate-asks': ['work', 'pr', 'ask', 'sha'],
      }[kind];
      const bare = Object.fromEntries(required.map((k) => [k, data[k]]));
      assert.ok(makeEvent({ kind, data: bare }), `${kind} with only what it must have`);
      for (const k of required) {
        const { [k]: _gone, ...without } = data;
        assert.throws(() => makeEvent({ kind, data: without }), new RegExp(`${kind} event`), `${kind} without ${k}`);
      }
      assert.throws(() => makeEvent({ kind, data: null }), new RegExp(`${kind} event`));
      assert.throws(() => makeEvent({ kind, data: { ...data, extra: 1 } }), /field it should not/);
    }
    const w = SHAPES.work;
    for (const bad of [
      { ...w, lane: 'huge' }, { ...w, visible: 'yes' }, { ...w, dependsOn: 'login' }, { ...w, dependsOn: ['Not A Slug'] },
      { ...w, doc: { path: 'x' } }, { ...w, doc: { path: 'x', hash: 'zz' } }, { ...w, place: 'first' }, { ...w, parent: 'No' }, { ...w, title: '' },
    ]) assert.throws(() => makeEvent({ kind: 'work', data: bad }), /work event/);
    const f = SHAPES.feature;
    for (const bad of [
      { ...f, step: 'done' }, { ...f, files: 'a' }, { ...f, slice: { n: 3, m: 2 } }, { ...f, slice: { n: 1 } }, { ...f, brief: 4 },
      { ...f, step: 'paused', pausedFor: 'lunch' }, { ...f, step: 'building', pausedFor: 'director' },
    ]) {
      assert.throws(() => makeEvent({ kind: 'feature', data: bad }), /feature event/);
    }
    // Why a feature is paused, on its paused event only.
    for (const pausedFor of ['director', 'five-hour']) assert.ok(makeEvent({ kind: 'feature', data: { ...f, step: 'paused', pausedFor } }));
    const q = SHAPES.question;
    for (const bad of [
      { ...q, id: 'q-other-1' }, { ...q, id: 'q-export-csv-x' }, { ...q, level: 5 }, { ...q, level: '2' }, { ...q, options: [] },
      { ...q, options: [{ label: 'Comma' }] }, { ...q, options: ['Comma'] },
      { ...q, commands: [] }, { ...q, commands: 'npm test' }, { ...q, commands: [3] }, { ...q, commands: [''] },
    ]) assert.throws(() => makeEvent({ kind: 'question', data: bad }), /question event/);
    const r = SHAPES.report;
    for (const bad of [{ ...r, outcome: 'won' }, { ...r, pr: 0 }, { ...r, rulings: 'x' }, { ...r, rulings: [3] }, { ...r, provenance: [] }]) {
      assert.throws(() => makeEvent({ kind: 'report', data: bad }), /report event/);
    }
    assert.throws(() => makeEvent({ kind: 'amendment', data: { ...SHAPES.amendment, hash: 'short' } }), /amendment event/);
    assert.throws(() => makeEvent({ kind: 'incident', data: { id: 'Has Spaces', what: 'x' } }), /incident event/);
  });
});

test('a gate-asks record names the click the gate waits for: an approval of a head, or a CI push of a branch (R117)', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('gate-asks'), true);
    assert.equal(PROTECTED_KINDS.includes('gate-asks'), false);
    const a = SHAPES['gate-asks'];
    const ci = { ...a, ask: 'ci-push', branch: 'feature/export-csv' };
    assert.deepEqual(makeEvent({ kind: 'gate-asks', data: ci }).data, ci);
    // A CI push may name the head its update was made from, so the front desk can tell whether it was pushed (ruling F78).
    const from = { ...ci, from: 'c'.repeat(40) };
    assert.deepEqual(makeEvent({ kind: 'gate-asks', data: from }).data, from);
    for (const bad of [
      { ...a, ask: 'review' }, { ...a, pr: 0 }, { ...a, pr: '12' }, { ...a, sha: 'b'.repeat(12) }, { ...a, sha: 'B'.repeat(40) }, { ...a, work: 'Not A Slug' },
      // A branch only with a CI push, and a CI push only with one.
      { ...a, branch: 'feature/export-csv' }, { ...a, ask: 'ci-push' }, { ...ci, branch: '' }, { ...ci, branch: 7 },
      // The head an update was made from only with a CI push, and in full.
      { ...a, from: 'c'.repeat(40) }, { ...ci, from: 'c'.repeat(12) }, { ...ci, from: 7 },
    ]) assert.throws(() => makeEvent({ kind: 'gate-asks', data: bad }), /gate-asks event/, JSON.stringify(bad));
  });
});

test('a lineage-hold record says when a session start held the project, and which upstreams and paths differ (R146)', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('lineage-hold'), true);
    assert.equal(PROTECTED_KINDS.includes('lineage-hold'), false);
    const data = { at: '2026-10-19T02:00:00.000Z', mismatches: [{ upstream: 'superpowers', path: 'skills/brainstorming' }, { upstream: null, path: 'lineage/manifest.json' }] };
    const event = makeEvent({ kind: 'lineage-hold', data });
    assert.equal(event.sig, undefined);
    assert.deepEqual(event.data, data);
    const [m] = data.mismatches;
    for (const bad of [
      null, { mismatches: data.mismatches }, { at: data.at }, { ...data, extra: 1 }, { ...data, at: 'yesterday' }, { ...data, at: 7 },
      { ...data, mismatches: [] }, { ...data, mismatches: 'skills/brainstorming' }, { ...data, mismatches: [{ ...m, want: 'a' }] },
      { ...data, mismatches: [{ upstream: 'superpowers' }] }, { ...data, mismatches: [{ ...m, path: '' }] }, { ...data, mismatches: [{ ...m, upstream: 'Not One' }] },
    ]) assert.throws(() => makeEvent({ kind: 'lineage-hold', data: bad }), /lineage-hold event/, JSON.stringify(bad));
  });
});

test('a work id that is not a short slug is refused', async () => {
  await withHome(() => {
    const ok = (id) => makeEvent({ kind: 'work', data: { ...SHAPES.work, id } });
    assert.ok(ok('a'));
    assert.ok(ok('a-1-b'));
    assert.ok(ok('x'.repeat(40)));
    for (const id of ['', 'x'.repeat(41), 'Upper', 'has space', 'under_score', 'slash/ed', 'dot.ted', 'é', 7, null, undefined]) {
      assert.throws(() => ok(id), /work event/, JSON.stringify(id));
    }
    for (const kind of ['feature', 'report', 'amendment']) {
      assert.throws(() => makeEvent({ kind, data: { ...SHAPES[kind], work: 'Bad Id' } }), new RegExp(`${kind} event`));
    }
  });
});

test('a shown event must be signed, with a code, a question and two to six options', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    assert.equal(CODE_ALPHABET, 'ABCDEFGHJKMNPQRSTVWXYZ23456789');
    const good = { code: 'K7M2', question: 'Ship it?', options: ['Yes', 'No'] };
    const e = makeEvent({ kind: 'shown', data: good, now: at(1) });
    assert.ok(e.sig);
    assert.equal(verify(e, readEnrolled()), true);
    const bad = (data) => assert.throws(() => makeEvent({ kind: 'shown', data, now: at(1) }), /shown/i);
    bad(undefined);
    bad({ ...good, code: 'K7M' });
    bad({ ...good, code: 'K7M22' });
    bad({ ...good, code: 'k7m2' });
    bad({ ...good, code: 'K7M0' });
    bad({ ...good, code: 'K7MI' });
    bad({ ...good, code: 'K7MO' });
    bad({ ...good, code: 'K7M1' });
    bad({ ...good, question: '' });
    bad({ ...good, question: 7 });
    bad({ ...good, options: ['Only'] });
    bad({ ...good, options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    bad({ ...good, options: ['a', 3] });
    bad({ ...good, options: 'Yes' });
    makeEvent({ kind: 'shown', data: { ...good, options: ['a', 'b', 'c', 'd', 'e', 'f'] }, now: at(1) });
  });
});

const CLICK = { question: 'the card as shown', label: 'Approve' };
const ACTION_SHAPES = {
  'approve-work': { action: 'approve-work', work: 'export-csv', lane: 'feature', hash: H, shownFirst: true, ...CLICK },
  answer: { action: 'answer', questionId: 'q-export-csv-1', questionHash: H, question: 'the card as shown', label: 'Comma' },
  amend: { action: 'amend', work: 'export-csv', hash: H, question: 'the card as shown', label: 'Change it' },
  'lift-incident': { action: 'lift-incident', incident: 'bad-total', question: 'the card as shown', label: 'End it' },
  'incident-fix': { action: 'incident-fix', incident: 'bad-total', pr: 31, question: 'the card as shown', label: 'Merge the fix' },
};

test('each new action needs its own fields and refuses others', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const own = {
      'approve-work': ['work', 'lane', 'hash', 'shownFirst'], answer: ['questionId', 'questionHash'], amend: ['work', 'hash'],
      'lift-incident': ['incident'], 'incident-fix': ['incident', 'pr'],
    };
    for (const [name, data] of Object.entries(ACTION_SHAPES)) {
      const event = makeEvent({ kind: 'action', data });
      assert.equal(verify(event, readEnrolled()), true, `${name} is signed`);
      for (const k of [...own[name], 'question', 'label']) {
        const { [k]: _gone, ...without } = data;
        assert.throws(() => makeEvent({ kind: 'action', data: without }), /action event/, `${name} without ${k}`);
      }
      // A field that belongs to another action, or to none, is refused.
      for (const [other, fields] of Object.entries(own)) {
        if (other === name) continue;
        for (const k of fields) {
          if (own[name].includes(k)) continue;
          assert.throws(() => makeEvent({ kind: 'action', data: { ...data, [k]: ACTION_SHAPES[other][k] } }), /action event/, `${name} with ${k}`);
        }
      }
      for (const k of ['step', 'branch', 'sha']) assert.throws(() => makeEvent({ kind: 'action', data: { ...data, [k]: 1 } }), /action event/);
    }
    // The older actions refuse the new fields.
    for (const old of [{ action: 'lift-stop' }, { action: 'runbook', step: 1 }, { action: 'ci-push', branch: 'b', sha: 'a'.repeat(40) }]) {
      for (const k of ['work', 'lane', 'hash', 'shownFirst', 'questionId', 'incident', 'pr']) {
        assert.throws(() => makeEvent({ kind: 'action', data: { ...old, ...CLICK, [k]: 'x' } }), /action event/, `${old.action} with ${k}`);
      }
    }
    const a = ACTION_SHAPES;
    for (const bad of [
      { ...a['approve-work'], lane: 'huge' }, { ...a['approve-work'], shownFirst: 'yes' }, { ...a['approve-work'], hash: 'zz' }, { ...a['approve-work'], work: 'Bad Id' },
      { ...a.answer, questionId: 'nope' }, { ...a.answer, questionHash: 'zz' }, { ...a.answer, label: 'Explain more' }, { ...a.answer, label: 'Not now' },
      { ...a.amend, hash: H.slice(0, 11) }, { ...a['lift-incident'], incident: '' }, { ...a['incident-fix'], pr: 0 }, { ...a['incident-fix'], pr: '3' },
    ]) assert.throws(() => makeEvent({ kind: 'action', data: bad }), /action event/, JSON.stringify(bad));
  });
});

// --- cards and reversals ---

const CARD_DATA = {
  question: 'What this is: a pull request.', header: 'Approve', options: ['Approve', 'Not now', 'Explain more', 'Show me'],
  kind: 'approval', line: 'Approve pull request #7 at commit abcdef123456', code: 'K7M2', level: 3, importance: 5,
};

test('a card event needs its kind, options and level', async () => {
  await withHome(() => {
    const make = (data) => makeEvent({ kind: 'card', data, now: at(1) });
    assert.equal(make(CARD_DATA).kind, 'card');
    // A card with no line or code (a product question), and the optional topic and concepts.
    make({ ...CARD_DATA, kind: 'question', line: null, code: null, topic: 'colours', concepts: ['pull request'] });
    // The option the card recommended, for the delegation review.
    make({ ...CARD_DATA, recommend: 'Approve' });
    // The words on each button, one for each option, so the card can be asked again as composed.
    make({ ...CARD_DATA, descriptions: ['Approve it.', 'Wait.', 'Say it plainer.', 'Show it.'] });
    for (const kind of ['approval', 'confirm', 'lift-stop', 'ci-push', 'runbook', 'approve-work', 'answer', 'amend', 'lift-incident', 'incident-fix', 'question']) {
      make({ ...CARD_DATA, kind });
    }
    for (const k of ['question', 'header', 'options', 'kind', 'level']) {
      const { [k]: _gone, ...without } = CARD_DATA;
      assert.throws(() => make(without), /card event.*needs/, `without ${k}`);
    }
    const bad = (data) => assert.throws(() => make({ ...CARD_DATA, ...data }), /card event/, JSON.stringify(data));
    bad({ kind: 'bogus' });
    bad({ options: [] });
    bad({ options: ['Only'] });
    bad({ options: ['a', 'b', 'c', 'd', 'e'] });
    bad({ options: ['a', 3] });
    bad({ options: 'Approve' });
    bad({ level: 0 });
    bad({ level: 5 });
    bad({ level: '3' });
    bad({ question: '' });
    bad({ header: 7 });
    bad({ line: 7 });
    bad({ code: 7 });
    bad({ importance: 'high' });
    bad({ descriptions: ['Approve it.'] });
    bad({ descriptions: ['a', 'b', 'c', ''] });
    bad({ descriptions: 'Approve it.' });
    bad({ topic: '' });
    bad({ recommend: '' });
    bad({ recommend: 3 });
    bad({ concepts: 'pull request' });
    bad({ concepts: [3] });
    bad({ title: 'extra' });
    assert.throws(() => make(undefined), /card event/);
    assert.throws(() => make([]), /card event/);
  });
});

test('a reversal is accepted as a plain kind', async () => {
  await withHome(() => {
    assert.ok(PLAIN_KINDS.includes('reversal'));
    const made = makeEvent({ kind: 'reversal', data: { topic: 'colours', what: 'The director undid the colour change' }, now: at(1) });
    assert.equal(made.sig, undefined);
    makeEvent({ kind: 'reversal', data: { topic: 'colours', what: 'Undid it', of: 'r001' }, now: at(1) });
    const bad = (data) => assert.throws(() => makeEvent({ kind: 'reversal', data }), /reversal event/, JSON.stringify(data));
    bad(undefined);
    bad({ what: 'x' });
    bad({ topic: 'x' });
    bad({ topic: '', what: 'x' });
    bad({ topic: 'x', what: 'x', of: '' });
    bad({ topic: 'x', what: 'x', of: 3 });
    bad({ topic: 'x', what: 'x', extra: 1 });
  });
});

test('an asked record names the cards a visit handed out, one to four of them', async () => {
  await withHome(() => {
    assert.ok(PLAIN_KINDS.includes('asked'));
    const made = makeEvent({ kind: 'asked', data: { cards: ['c1', 'c2'] }, now: at(1) });
    assert.equal(made.sig, undefined);
    const bad = (data) => assert.throws(() => makeEvent({ kind: 'asked', data }), /asked event/, JSON.stringify(data));
    bad(undefined);
    bad({});
    bad({ cards: [] });
    bad({ cards: 'c1' });
    bad({ cards: ['c1', ''] });
    bad({ cards: ['c1', 2] });
    bad({ cards: ['a', 'b', 'c', 'd', 'e'] });
    bad({ cards: ['c1'], label: 'Approve' });
  });
});

test('a question may say what answering it does to the checks, on one line', async () => {
  await withHome(() => {
    const question = {
      id: 'q-export-csv-1', work: 'export-csv', what: 'Which check?', why: 'It changes a guardrail.',
      options: [{ label: 'Keep it', says: 'The check stays.' }, { label: 'Drop it', says: 'The check goes.' }], recommendation: 'Keep it', level: 4,
    };
    makeEvent({ kind: 'question', data: question, now: at(1) });
    assert.equal(makeEvent({ kind: 'question', data: { ...question, checks: 'One check stops running.' }, now: at(1) }).data.checks, 'One check stops running.');
    for (const checks of ['', 'Two\nlines', 'Two\u2028lines', 3, null]) {
      assert.throws(() => makeEvent({ kind: 'question', data: { ...question, checks }, now: at(1) }), /question event/, JSON.stringify(checks));
    }
  });
});
