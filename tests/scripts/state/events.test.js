// tests/scripts/state/events.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODE_ALPHABET, takeOverLine, TAKEOVER_LABEL } from '../../../scripts/state/card-lines.js';
import { PUT_OFF } from '../../../scripts/lib/front-desk.js';
import { makeEvent, eventPath, writeEvent, listEvents, PLAIN_KINDS, PROTECTED_KINDS, HELPER_ONLY_KINDS } from '../../../scripts/state/events.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { stateDir, computerId } from '../../../scripts/lib/paths.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote, push, LOCAL_PATHS } from '../../helpers/git-fixture.js';
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

test('a take-over action needs the computer that held the lock, its counter, its label and its own set line', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const good = { action: 'take-over', holder: '0a1b2c3d', counter: 4, question: takeOverLine('0a1b2c3d', 4), label: TAKEOVER_LABEL };
    assert.equal(verify(makeEvent({ kind: 'action', data: good, now: at(1) }), readEnrolled()), true);
    for (const [bad, pattern] of [
      [{ holder: 'other-mac' }, /id of the computer/],
      [{ counter: 0 }, /counter/],
      [{ counter: 5 }, /set line/],
      [{ label: 'Leave it there' }, /label/],
      [{ proof: 'x'.repeat(3), sha: 'abc' }, /field/],
    ]) assert.throws(() => makeEvent({ kind: 'action', data: { ...good, ...bad }, now: at(1) }), pattern, JSON.stringify(bad));
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

test('writeEvent commits one new file in the record and pushes nothing', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      assert.equal(dir, stateDir('o__p'));
      const event = makeEvent({ kind: 'note', data: { text: 'one' } });
      const r = await writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push });
      assert.equal(r.pushed, false);
      assert.ok(fs.existsSync(r.path));
      const log = await git(dir, ['log', '--format=%s|%an|%ae', '-1']);
      assert.equal(log.stdout.trim(), `note ${event.id}|Wheelhouse|wheelhouse@invalid`);
      const files = await git(dir, ['show', '--name-only', '--format=', 'HEAD']);
      assert.equal(files.stdout.trim().split('\n').length, 1);
      assert.equal((await git(dir, ['remote'])).stdout.trim(), '', 'the record has no remote');
      const upstream = await run('git', ['--git-dir', remote.url, 'branch', '--list']);
      assert.equal(upstream.stdout.trim(), '', 'nothing reached the host');
      assert.deepEqual(listEvents(dir).map((e) => e.id), [event.id]);
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses to overwrite an existing event file', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const event = makeEvent({ kind: 'note', data: { text: 'one' } });
      await writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push });
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event: { ...event, data: { text: 'two' } }, push }), /exists/);
      const kept = JSON.parse(fs.readFileSync(path.join(stateDir('o__p'), eventPath(event)), 'utf8'));
      assert.equal(kept.data.text, 'one');
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses an unsigned protected event', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const event = { v: 1, id: 'x', at: '2026-10-18T01:02:03.000Z', computer: computerId(), kind: 'review', data: {} };
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), /signed/);
    });
  } finally { remote.cleanup(); }
});

test('writeEvent refuses an event holding a secret, naming the pattern only', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const secret = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
      const event = makeEvent({ kind: 'note', data: { text: secret } });
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), (e) => {
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
      const dir = await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const github = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
      const aws = ['AK', 'IA', 'Q7'.repeat(8)].join('');
      for (const [text, pattern] of [
        [`my token:\n${github}`, /github-token/],
        [`key\t${aws}`, /aws-access-key/],
        [`x\n${aws}`, /aws-access-key/],
        [`MY_${github}`, /github-token/],
      ]) {
        const event = makeEvent({ kind: 'note', data: { text } });
        await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), (e) => {
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

test('an unreadable event file is refused, naming the file and leaving nothing committed', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const event = makeEvent({ kind: 'note', data: { text: 'plain' } });
      const name = path.basename(eventPath(event));
      const real = fs.readFileSync;
      fs.readFileSync = (f, ...rest) => {
        if (String(f).endsWith(name)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return real(f, ...rest);
      };
      try {
        await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), (e) => {
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

test('a review signed from the engine\'s record names the engine, the run, the step and the pack\'s digest', async () => {
  await withHome(async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const good = { pr: 3, commit: 'a'.repeat(40), verdict: 'CLEAN', findings: 0, engine: 'archon', runId: 'run-1', step: 'review-spec', digest: 'b'.repeat(64) };
    assert.ok(makeEvent({ kind: 'review', data: good }).sig);
    for (const bad of [{ ...good, engine: 'other' }, { ...good, runId: '' }, { ...good, step: 4 }, { ...good, digest: 'short' }, { ...good, engine: undefined }]) {
      assert.throws(() => makeEvent({ kind: 'review', data: bad }), /review event/);
    }
  });
});

test('a failed commit leaves no empty month folder', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      const dir = await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      // Hooks are switched off for the helper's own clones, so a held index lock is what fails the add.
      const hook = path.join(dir, '.git', 'index.lock');
      fs.writeFileSync(hook, '');
      const event = makeEvent({ kind: 'note', data: { text: 'plain' }, now: () => new Date('2031-03-04T05:06:07.000Z') });
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), /could not be committed/);
      assert.equal(fs.existsSync(path.join(dir, 'events', '2031')), false, 'the year and month folders are gone');
      // an earlier month's folder, with an event in it, stays
      fs.rmSync(hook);
      const earlier = makeEvent({ kind: 'note', data: { text: 'first' }, now: () => new Date('2031-02-04T05:06:07.000Z') });
      await writeEvent({ env: LOCAL_PATHS, project: 'o__p', event: earlier, push });
      fs.writeFileSync(hook, '');
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), /could not be committed/);
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
    // The refusal names the stray field and the fields the kind takes, so a session can put it right at once.
    assert.throws(
      () => makeEvent({ kind: 'work', data: { ...SHAPES.work, what: 'A change' } }),
      /A work event has a field it should not: what\. It takes id, title, lane, visible and dependsOn, and may take doc, place, parent, from and level/,
    );
    // A record missing fields names every one of them, and what the kind takes, in one refusal (the
    // rehearsal on a project under way: three refusals, one field each).
    assert.throws(
      () => makeEvent({ kind: 'work', data: { id: 'carry-on-3', lane: 'small', visible: true } }),
      /A work event needs its title and dependsOn\. It takes id, title, lane, visible and dependsOn, and may take doc, place, parent, from and level/,
    );
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

test('a column-ready record names the column, the pins it ran on and the evaluation\'s records', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('column-ready'), true);
    assert.equal(PROTECTED_KINDS.includes('column-ready'), false);
    // No session can mark a column ready: only the helper records one.
    assert.equal(HELPER_ONLY_KINDS.includes('column-ready'), true);
    const data = { column: 'lean', pins: { mostCapable: 'model-top', midSized: 'model-mid', premium: null }, records: ['eval-1'] };
    assert.deepEqual(makeEvent({ kind: 'column-ready', data }).data, data);
    for (const column of ['lightest', 'premium']) assert.equal(makeEvent({ kind: 'column-ready', data: { ...data, column } }).data.column, column);
    // The plugin's commit the counted run was made on, as the helper records it.
    assert.equal(makeEvent({ kind: 'column-ready', data: { ...data, commit: 'abc123def456' } }).data.commit, 'abc123def456');
    for (const bad of [
      { ...data, commit: '' }, { ...data, commit: 'ABC123DEF456' }, { ...data, commit: 'abc12' }, { ...data, commit: 7 },
      null, { column: 'lean', pins: data.pins }, { ...data, extra: 1 },
      { ...data, column: 'balanced' }, { ...data, column: 'thorough' }, { ...data, column: 'Lean' },
      { ...data, pins: null }, { ...data, pins: [] }, { ...data, pins: { other: 'model-top' } }, { ...data, pins: { mostCapable: '-flag' } }, { ...data, pins: { midSized: 7 } },
      { ...data, records: 'eval-1' }, { ...data, records: [''] }, { ...data, records: [7] }, { ...data, records: Array.from({ length: 51 }, (_, i) => `r${i}`) },
    ]) assert.throws(() => makeEvent({ kind: 'column-ready', data: bad }), /column-ready event/, JSON.stringify(bad));
  });
});

test('a usage-card record says which card, when, the allowance week, the levels and the hash of the card shown, signed', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    // Signed by the session start, so no session can write an offer a click would count against.
    assert.equal(PLAIN_KINDS.includes('usage-card'), false);
    assert.equal(PROTECTED_KINDS.includes('usage-card'), true);
    assert.equal(HELPER_ONLY_KINDS.includes('usage-card'), false);
    const data = { card: 'nudge', at: '2026-10-26T01:00:00.000Z', reset: '2026-10-28T22:00:00.000Z', from: 'balanced', to: 'lean', hash: 'ab'.repeat(32) };
    const made = makeEvent({ kind: 'usage-card', data });
    assert.deepEqual(made.data, data);
    assert.ok(verify(made, readEnrolled()));
    for (const bad of [null, { ...data, card: 'other' }, { ...data, at: 'now' }, { ...data, reset: 3 }, { ...data, from: 'best' }, { ...data, to: undefined }, { ...data, extra: 1 }, { ...data, hash: undefined }, { ...data, hash: 'ab' }]) {
      assert.throws(() => makeEvent({ kind: 'usage-card', data: bad }), /usage-card event/, JSON.stringify(bad));
    }
    // Each card offers its own switch: the nudge Lean from Balanced or Thorough, the second card Lightest from Lean,
    // the upward card Thorough from below it, a return card another level than the one in force.
    const fits = [['nudge', 'balanced', 'lean'], ['nudge', 'thorough', 'lean'], ['lightest', 'lean', 'lightest'], ['up', 'lean', 'thorough'], ['up', 'lightest', 'thorough'], ['up', 'balanced', 'thorough'], ['return', 'lean', 'balanced'], ['return', 'thorough', 'balanced']];
    for (const [card, from, to] of fits) assert.doesNotThrow(() => makeEvent({ kind: 'usage-card', data: { ...data, card, from, to } }), `${card} ${from} ${to}`);
    const misfits = [['nudge', 'balanced', 'lightest'], ['nudge', 'lean', 'lean'], ['lightest', 'balanced', 'lightest'], ['lightest', 'lean', 'lean'], ['up', 'balanced', 'lightest'], ['up', 'thorough', 'thorough'], ['return', 'lean', 'lean']];
    for (const [card, from, to] of misfits) {
      assert.throws(() => makeEvent({ kind: 'usage-card', data: { ...data, card, from, to } }), /usage-card event/, `${card} ${from} ${to}`);
    }
  });
});

test('a premium-card record says when, from which setting, and the hash of the card shown, signed', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    // Signed by the helper, so no session can write an offer a click would count against.
    assert.equal(PLAIN_KINDS.includes('premium-card'), false);
    assert.equal(PROTECTED_KINDS.includes('premium-card'), true);
    const data = { at: '2026-10-26T01:00:00.000Z', from: 'off', hash: 'ab'.repeat(32) };
    const made = makeEvent({ kind: 'premium-card', data });
    assert.deepEqual(made.data, data);
    assert.ok(verify(made, readEnrolled()));
    assert.doesNotThrow(() => makeEvent({ kind: 'premium-card', data: { ...data, from: 'within-plan' } }));
    for (const bad of [null, { ...data, at: '26 October' }, { ...data, at: '2026-10-26T01:00:00Z' }, { ...data, from: 'paid-too' }, { ...data, from: undefined }, { ...data, hash: 'ab' }, { ...data, extra: 1 }]) {
      assert.throws(() => makeEvent({ kind: 'premium-card', data: bad }), /premium-card event/, JSON.stringify(bad));
    }
  });
});

test('a premium-check record names the Yes it checks for, the model the alias named and whether it is a premium model, signed', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    // Signed by the helper, from its own reading, so no session can name the premium pin.
    assert.equal(PLAIN_KINDS.includes('premium-check'), false);
    assert.equal(PROTECTED_KINDS.includes('premium-check'), true);
    const data = { setting: '11111111-2222-4333-8444-555555555555', model: 'model-premium', found: true };
    const made = makeEvent({ kind: 'premium-check', data });
    assert.deepEqual(made.data, data);
    assert.ok(verify(made, readEnrolled()));
    assert.doesNotThrow(() => makeEvent({ kind: 'premium-check', data: { ...data, model: null, found: false } }));
    assert.doesNotThrow(() => makeEvent({ kind: 'premium-check', data: { ...data, model: 'model-top', found: false } }));
    for (const bad of [null, { ...data, setting: 'p-1' }, { ...data, model: '--flag' }, { ...data, found: 'yes' }, { ...data, model: null }, { ...data, extra: 1 }, { setting: data.setting, model: null }]) {
      assert.throws(() => makeEvent({ kind: 'premium-check', data: bad }), /premium-check event/, JSON.stringify(bad));
    }
  });
});

test('a premium-failed record names the Yes, the model and the trials that failed, signed by the helper', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    assert.equal(PROTECTED_KINDS.includes('premium-failed'), true);
    const data = { setting: '11111111-2222-4333-8444-555555555555', model: 'model-premium', failed: ['scenario 22 trial 1 failed'] };
    const made = makeEvent({ kind: 'premium-failed', data });
    assert.deepEqual(made.data, data);
    assert.ok(verify(made, readEnrolled()));
    for (const bad of [null, { ...data, setting: 'x' }, { ...data, model: '--x' }, { ...data, failed: [] }, { ...data, failed: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { ...data, failed: [''] }, { ...data, extra: 1 }]) {
      assert.throws(() => makeEvent({ kind: 'premium-failed', data: bad }), /premium-failed event/, JSON.stringify(bad));
    }
  });
});

test('a premium-rest record says why, when, until when, and whose wake', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('premium-rest'), true);
    const data = { why: 'limit', at: '2026-10-26T01:00:00.000Z', until: '2026-10-27T01:00:00.000Z', work: 'login-page' };
    assert.deepEqual(makeEvent({ kind: 'premium-rest', data }).data, data);
    const { work, ...plain } = data;
    assert.doesNotThrow(() => makeEvent({ kind: 'premium-rest', data: { ...plain, why: 'billing' } }));
    for (const bad of [null, { ...data, why: 'other' }, { ...data, until: 'tomorrow' }, { ...data, at: undefined }, { ...data, work: 'Login Page' }, { ...data, extra: 1 }]) {
      assert.throws(() => makeEvent({ kind: 'premium-rest', data: bad }), /premium-rest event/, JSON.stringify(bad));
    }
  });
});

test('a lineage-lift record says when, and which holds it lifts', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('lineage-lift'), true);
    const data = { at: '2026-10-19T02:00:00.000Z', holds: ['h1', 'h2'] };
    assert.deepEqual(makeEvent({ kind: 'lineage-lift', data }).data, data);
    for (const bad of [null, { at: data.at }, { holds: ['h1'] }, { ...data, extra: 1 }, { ...data, at: 'yesterday' }, { ...data, holds: [] }, { ...data, holds: 'h1' }, { ...data, holds: [7] }]) {
      assert.throws(() => makeEvent({ kind: 'lineage-lift', data: bad }), /lineage-lift event/, JSON.stringify(bad));
    }
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

test('work may start from a ready-made change: its full commit, its own ref and the request it carries on', async () => {
  await withHome(() => {
    const w = SHAPES.work;
    const from = { sha: 'c'.repeat(40), ref: 'refs/wheelhouse/from/export-csv' };
    assert.deepEqual(makeEvent({ kind: 'work', data: { ...w, from } }).data.from, from);
    assert.deepEqual(makeEvent({ kind: 'work', data: { ...w, from: { ...from, request: 7 } } }).data.from, { ...from, request: 7 });
    for (const bad of [
      null, 'c'.repeat(40), { sha: 'c'.repeat(39), ref: from.ref }, { sha: 'C'.repeat(40), ref: from.ref }, { ref: from.ref }, { sha: from.sha },
      { ...from, ref: 'refs/wheelhouse/from/another' }, { ...from, ref: 'refs/heads/export-csv' }, { ...from, ref: 'refs/wheelhouse/from/export-csv/x' },
      { ...from, request: 0 }, { ...from, request: 1.5 }, { ...from, request: '7' }, { ...from, branch: 'x' },
    ]) assert.throws(() => makeEvent({ kind: 'work', data: { ...w, from: bad } }), /work event has a from/, JSON.stringify(bad));
    // Ready-made work is always shown to the director first, whatever its lane, so it waits for their approval.
    for (const lane of ['quick', 'bug', 'small', 'feature']) {
      assert.throws(() => makeEvent({ kind: 'work', data: { ...w, lane, visible: false, from } }), /ready-made change, so it must be shown to the director first/, lane);
      assert.equal(makeEvent({ kind: 'work', data: { ...w, lane, visible: true, from } }).data.visible, true);
    }
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
      { ...a.answer, label: 'Why?' }, { ...a.answer, label: 'Suggest a change…' }, { ...a.answer, label: 'Show me' },
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
    // The card's parts, and the id of the card a revised proposal replaces.
    const parts = { kind: 'approval', ask: 'Put it live?', what: 'A change.', why: 'It is yours.', meanwhile: 'Nothing is released.', options: [] };
    make({ ...CARD_DATA, parts, revises: 'e-old' });
    for (const bad of [{ ...parts, ask: '' }, { ...parts, options: 'x' }, 'text', [], null]) assert.throws(() => make({ ...CARD_DATA, parts: bad }), /card event.*parts/);
    assert.throws(() => make({ ...CARD_DATA, revises: 7 }), /card event.*revises/);
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

test('a confirm-all action carries the full hash of the list and the ids of the rulings it recorded, each once', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const good = { action: 'confirm-all', hash: 'ab'.repeat(32), ids: ['r1', 'r2'], question: 'Confirm all 2 rules as listed, abababababab', label: 'Confirm all' };
    const made = makeEvent({ kind: 'action', data: good, now: at(1) });
    assert.equal(verify(made, readEnrolled()), true);
    for (const [why, data] of [
      ['short hash', { ...good, hash: 'ab'.repeat(6) }],
      ['no ids', { ...good, ids: [] }],
      ['an id twice', { ...good, ids: ['r1', 'r1'] }],
      ['an id not text', { ...good, ids: ['r1', 2] }],
      ['another label', { ...good, label: 'Let me correct some' }],
      ['a field of another action', { ...good, step: 5 }],
    ]) assert.throws(() => makeEvent({ kind: 'action', data, now: at(1) }), /action event/, why);
  });
});

test('an uninstall action names the project and the full hash of the list, and carries only its set line (ruling R90)', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const hash = 'ab'.repeat(32);
    const good = { action: 'uninstall', project: 'wh cafe menu Zoë', hash, question: 'Remove Wheelhouse from wh cafe menu Zoë as listed, abababababab', label: 'Remove it' };
    const made = makeEvent({ kind: 'action', data: good, now: at(1) });
    assert.equal(verify(made, readEnrolled()), true);
    for (const [why, data] of [
      ['short hash', { ...good, hash: 'ab'.repeat(6) }],
      ['no project', { ...good, project: '' }],
      ['a project on two lines', { ...good, project: 'wh\ncafe', question: 'Remove Wheelhouse from wh\ncafe as listed, abababababab' }],
      ['another label', { ...good, label: 'Go ahead' }],
      ['the whole card as its question', { ...good, question: `What this is: Remove Wheelhouse.\n${good.question}` }],
      ['another project in its line', { ...good, question: 'Remove Wheelhouse from other as listed, abababababab' }],
      ['another hash in its line', { ...good, question: 'Remove Wheelhouse from wh cafe menu Zoë as listed, cdcdcdcdcdcd' }],
      ['a field of another action', { ...good, runId: 'run-0123456789' }],
    ]) assert.throws(() => makeEvent({ kind: 'action', data, now: at(1) }), /action event/, why);
  });
});

test('a card answer labelled Why?, Suggest a change… or Show me is not an answer', async () => {
  await withHome(() => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    const setupAnswer = { action: 'setup-answer', runId: 'run-0123456789', step: 4, questionId: 'live-data', question: 'Live data?', label: 'No live data', text: null };
    for (const base of [ACTION_SHAPES.answer, setupAnswer]) {
      assert.doesNotThrow(() => makeEvent({ kind: 'action', data: base, now: at(1) }), `${base.action} with its own label`);
      for (const label of PUT_OFF) {
        assert.throws(() => makeEvent({ kind: 'action', data: { ...base, label }, now: at(1) }), /not an answer/, `${base.action} labelled ${label}`);
      }
    }
  });
});

// A survey of what a project already holds (design section 15, ruling A1; plan rulings P1 and P3),
// every part of it checked: what the survey gives, and nothing else.
const SURVEY = {
  v: 1,
  hostReached: true,
  requests: [{ number: 7, title: 'Add a request', draft: false }, { number: 9, title: '', draft: true }],
  pushed: [{ name: 'prices', head: 'a'.repeat(40), commits: 2, subject: 'Prices', at: '2026-10-20T01:00:00+11:00' }],
  local: [{ name: 'this folder', head: 'b'.repeat(64), commits: 1, subject: '', at: '' }],
  more: { pushed: false, local: true },
  instructions: { files: ['.cursorrules', 'AGENTS.md'], sections: [{ heading: 'Agents and delegation', line: 3 }] },
  scheduled: 3,
  secrets: 0,
  rules: [{ words: 'Use British English.', source: { file: 'CLAUDE.md', line: 4 } }],
};

test('a survey record carries every part of the survey, each in its own shape', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('survey'), true);
    assert.equal(PROTECTED_KINDS.includes('survey'), false);
    // Only the helper itself records a survey or a column's readiness: no caller writes one.
    assert.deepEqual(HELPER_ONLY_KINDS, ['survey', 'column-ready', 'run', 'ask', 'cost', 'preview', 'incident-closed']);
    assert.deepEqual(makeEvent({ kind: 'survey', data: SURVEY }).data, SURVEY);
    // Taken again (ruling P3), it says so.
    assert.deepEqual(makeEvent({ kind: 'survey', data: { ...SURVEY, again: true } }).data.again, true);
    const empty = {
      v: 1, hostReached: false, requests: [], pushed: [], local: [], more: { pushed: false, local: false },
      instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [],
    };
    assert.deepEqual(makeEvent({ kind: 'survey', data: empty }).data, empty);
    const [request] = SURVEY.requests;
    const [item] = SURVEY.pushed;
    const [rule] = SURVEY.rules;
    const long = 'x'.repeat(201);
    for (const bad of [
      null, { ...SURVEY, v: 2 }, { ...SURVEY, extra: 1 }, { ...SURVEY, again: false }, { ...SURVEY, hostReached: 'yes' },
      ...['v', 'hostReached', 'requests', 'pushed', 'local', 'more', 'instructions', 'scheduled', 'secrets', 'rules']
        .map((k) => Object.fromEntries(Object.entries(SURVEY).filter(([key]) => key !== k))),
      { ...SURVEY, requests: {} }, { ...SURVEY, requests: [{ ...request, number: 0 }] }, { ...SURVEY, requests: [{ ...request, number: '7' }] },
      { ...SURVEY, requests: [{ ...request, title: 7 }] }, { ...SURVEY, requests: [{ ...request, title: long }] },
      { ...SURVEY, requests: [{ ...request, draft: 'no' }] }, { ...SURVEY, requests: [{ ...request, body: 'more' }] },
      { ...SURVEY, requests: [{ number: 7, title: 'x' }] }, { ...SURVEY, requests: Array.from({ length: 101 }, (_, i) => ({ ...request, number: i + 1 })) },
      { ...SURVEY, pushed: [{ ...item, name: '' }] }, { ...SURVEY, pushed: [{ ...item, head: 'abc' }] }, { ...SURVEY, local: [{ ...item, head: 'A'.repeat(40) }] },
      { ...SURVEY, pushed: [{ ...item, commits: 0 }] }, { ...SURVEY, pushed: [{ ...item, commits: 1.5 }] }, { ...SURVEY, local: [{ ...item, subject: long }] },
      { ...SURVEY, pushed: [{ ...item, at: 'yesterday' }] }, { ...SURVEY, local: [{ ...item, extra: 1 }] }, { ...SURVEY, local: null },
      { ...SURVEY, pushed: Array.from({ length: 201 }, () => item) },
      { ...SURVEY, more: { pushed: false } }, { ...SURVEY, more: { pushed: false, local: 'no' } }, { ...SURVEY, more: { pushed: false, local: false, x: true } }, { ...SURVEY, more: [] },
      { ...SURVEY, instructions: { files: [] } }, { ...SURVEY, instructions: { files: [''], sections: [] } }, { ...SURVEY, instructions: { files: [7], sections: [] } },
      { ...SURVEY, instructions: { files: Array.from({ length: 201 }, (_, i) => `f${i}`), sections: [] } },
      { ...SURVEY, instructions: { files: [], sections: [{ heading: 'Agents', line: 0 }] } }, { ...SURVEY, instructions: { files: [], sections: [{ heading: long, line: 1 }] } },
      { ...SURVEY, instructions: { files: [], sections: [{ heading: 'Agents' }] } }, { ...SURVEY, instructions: { files: [], sections: [], extra: [] } },
      { ...SURVEY, scheduled: -1 }, { ...SURVEY, scheduled: 1.5 }, { ...SURVEY, secrets: '2' },
      { ...SURVEY, rules: [{ ...rule, words: '' }] }, { ...SURVEY, rules: [{ ...rule, source: { file: 'CLAUDE.md' } }] },
      { ...SURVEY, rules: [{ ...rule, source: { file: '', line: 1 } }] }, { ...SURVEY, rules: [{ ...rule, extra: 1 }] }, { ...SURVEY, rules: 'none' },
      // Every text is kept short: a rule's words, its file, an instruction file's name and a time.
      { ...SURVEY, rules: [{ ...rule, words: 'w'.repeat(1001) }] }, { ...SURVEY, rules: [{ ...rule, source: { file: `${'d/'.repeat(201)}x`, line: 1 } }] },
      { ...SURVEY, instructions: { files: [`${'d/'.repeat(201)}x`], sections: [] } }, { ...SURVEY, pushed: [{ ...item, at: `${item.at}${' '.repeat(200)}` }] },
    ]) assert.throws(() => makeEvent({ kind: 'survey', data: bad }), /survey event/, JSON.stringify(bad)?.slice(0, 200));
  });
});

test('a survey holding a secret is refused by the state, as every event is', async () => {
  const remote = await makeBareRemote();
  try {
    await withHome(async () => {
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const secret = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
      const event = makeEvent({ kind: 'survey', data: { ...SURVEY, requests: [{ number: 7, title: `Key ${secret}`, draft: false }] } });
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push }), /refused because it matched: github-token/);
      assert.deepEqual(listEvents(stateDir('o__p')), []);
    });
  } finally { remote.cleanup(); }
});

const RUN = { work: 'login', lane: 'quick', engine: 'archon', runId: 'r-1', state: 'started' };
const ASK = { id: 'a-1', runId: 'r-1', work: 'login', kind: 'question', level: 3, options: [{ label: 'Yes', says: 'Go on' }] };
const COST = { runId: 'r-1', work: 'login', tokens: 1200, dollars: null, premiumRequests: null, minutes: 4, source: 'unknown', byRole: {} };

test('a run event with an unknown state is refused', async () => {
  await withHome(() => {
    for (const state of ['started', 'paused', 'ended']) assert.equal(makeEvent({ kind: 'run', data: { ...RUN, state } }).data.state, state);
    assert.deepEqual(makeEvent({ kind: 'run', data: { ...RUN, state: 'ended', branch: 'b', pr: 4, outcome: 'merged' } }).data.pr, 4);
    assert.throws(() => makeEvent({ kind: 'run', data: { ...RUN, state: 'running' } }), /run event/);
    assert.throws(() => makeEvent({ kind: 'run', data: { ...RUN, extra: 1 } }), /should not/);
    assert.throws(() => makeEvent({ kind: 'run', data: { work: 'login' } }), /needs its/);
    assert.throws(() => makeEvent({ kind: 'ask', data: { ...ASK, kind: 'chat' } }), /ask event/);
    assert.throws(() => makeEvent({ kind: 'ask', data: { ...ASK, level: 5 } }), /ask event/);
    assert.equal(makeEvent({ kind: 'ask', data: { ...ASK, kind: 'usage-limit', topic: 't', recommend: 'Yes', setLine: 'Keep it' } }).data.kind, 'usage-limit');
    assert.equal(makeEvent({ kind: 'preview', data: { work: 'login', head: 'a'.repeat(40), folder: '/x', pages: ['index.html'] } }).kind, 'preview');
    assert.equal(makeEvent({ kind: 'lesson', data: { work: 'login', text: 'Check the lock first' } }).kind, 'lesson');
    assert.throws(() => makeEvent({ kind: 'lesson', data: { work: 'login' } }), /needs its/);
  });
});

test('a run of the fix-main lane is recorded', async () => {
  await withHome(() => {
    assert.equal(makeEvent({ kind: 'run', data: { ...RUN, lane: 'fix-main' } }).data.lane, 'fix-main');
    assert.throws(() => makeEvent({ kind: 'run', data: { ...RUN, lane: 'merge' } }), /run event/);
  });
});

test('an incident may carry its kind, suspect and work', async () => {
  await withHome(() => {
    const data = { id: 'red-main-0123456789', what: 'The main line is red', kind: 'red-main', suspect: 12, work: 'fix-main-red-main-0123456789' };
    assert.deepEqual(makeEvent({ kind: 'incident', data }).data, data);
    assert.equal(makeEvent({ kind: 'incident', data: { ...data, suspect: null } }).data.suspect, null);
    assert.throws(() => makeEvent({ kind: 'incident', data: { ...data, kind: 'outage' } }), /incident event/);
    assert.throws(() => makeEvent({ kind: 'incident', data: { ...data, suspect: '12' } }), /incident event/);
    assert.throws(() => makeEvent({ kind: 'incident', data: { ...data, work: 'Has Spaces' } }), /incident event/);
  });
});

test('incident-closed is the helper\'s own record', async () => {
  await withHome(() => {
    assert.equal(PLAIN_KINDS.includes('incident-closed'), true);
    assert.equal(HELPER_ONLY_KINDS.includes('incident-closed'), true);
    assert.deepEqual(makeEvent({ kind: 'incident-closed', data: { incident: 'red-main-0123456789', why: 'green' } }).data.why, 'green');
    assert.throws(() => makeEvent({ kind: 'incident-closed', data: { incident: 'Has Spaces', why: 'green' } }), /incident-closed event/);
    assert.throws(() => makeEvent({ kind: 'incident-closed', data: { incident: 'red-main-1' } }), /needs its/);
  });
});

test('a cost event with source unknown keeps null dollars', async () => {
  await withHome(() => {
    assert.deepEqual(makeEvent({ kind: 'cost', data: COST }).data, COST);
    assert.equal(makeEvent({ kind: 'cost', data: { ...COST, dollars: 0.5, premiumRequests: 2, source: 'reported' } }).data.dollars, 0.5);
    assert.equal(makeEvent({ kind: 'cost', data: { ...COST, source: 'estimated' } }).data.source, 'estimated');
    // Unknown is never zero: a figure that is not known cannot be written as 0.
    assert.throws(() => makeEvent({ kind: 'cost', data: { ...COST, dollars: 0 } }), /cost event/);
    assert.throws(() => makeEvent({ kind: 'cost', data: { ...COST, premiumRequests: 0 } }), /cost event/);
    assert.throws(() => makeEvent({ kind: 'cost', data: { ...COST, source: 'guessed' } }), /cost event/);
  });
});

test('a run event can\'t be written through /state/write', () => {
  // The helper refuses any HELPER_ONLY_KINDS kind from a caller (scripts/host/helper.js, /state/write).
  for (const kind of ['run', 'ask', 'cost', 'preview']) {
    assert.equal(PLAIN_KINDS.includes(kind), true, kind);
    assert.equal(HELPER_ONLY_KINDS.includes(kind), true, kind);
  }
  for (const kind of ['lesson']) assert.equal(HELPER_ONLY_KINDS.includes(kind), false, kind);
});
