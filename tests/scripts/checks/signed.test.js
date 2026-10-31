// tests/scripts/checks/signed.test.js
// The check's record: only the helper writes one, and a result counts only for its head and its command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkCounts } from '../../../scripts/gate/conditions.js';
import { checkRecord, HELPER_ONLY_KINDS, makeEvent, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { enrol, makeSigningKey, readEnrolled } from '../../../scripts/state/signing.js';
import { scanContent } from '../../../scripts/state/secret-scan.js';
import { commandDigest, writeCheck } from '../../../scripts/checks/record.js';
import { checksConfig, checksSettings } from '../../../scripts/checks/settings.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
const OLD = '1111111222222233333334444444555555566666';
const DIGEST = commandDigest('npm test');

async function withHome(fn) {
  const home = path.join(tempFolder('wh-check-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-31T00:00:00.000Z' });
    return await fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
}

const result = (extra = {}) => ({ commit: HEAD, command: DIGEST, result: 'passed', minutes: 3, tail: 'all passed', ...extra });
const written = async (extra) => writeCheck('p', result(extra), { write: async () => {} });

test('a check is a signed kind only the helper writes', () => {
  assert.ok(PROTECTED_KINDS.includes('check'));
  assert.ok(HELPER_ONLY_KINDS.includes('check'));
});

test('a check event from a caller is refused', async () => {
  await withHome(async () => {
    const event = await written();
    assert.match(checkRecord(event, { enrolled: readEnrolled() }), /only the helper/);
  });
});

test('a check needs a whole commit, a known result and a short tail', async () => {
  await withHome(() => {
    for (const bad of [{ commit: 'abc' }, { result: 'green' }, { minutes: -1 }, { tail: 'x'.repeat(5000) }, { command: 7 }]) {
      assert.throws(() => makeEvent({ kind: 'check', data: result(bad) }), /A check event/, JSON.stringify(bad).slice(0, 40));
    }
    assert.throws(() => makeEvent({ kind: 'check', data: { ...result(), other: 1 } }), /A check event/);
  });
});

test('a main-line check says it ran clean, and nothing else does', async () => {
  await withHome(async () => {
    assert.equal((await written({ clean: true })).data.clean, true);
    assert.equal(Object.hasOwn((await written()).data, 'clean'), false);
    assert.throws(() => makeEvent({ kind: 'check', data: { ...result(), clean: false } }), /A check event/);
  });
});

test('a passed check of this head and command counts', async () => {
  await withHome(async () => {
    assert.equal(checkCounts(await written(), HEAD, DIGEST, readEnrolled()), true);
  });
});

test('a check signed by another key does not count', async () => {
  await withHome(async () => {
    const event = await written();
    const mine = readEnrolled();
    assert.equal(checkCounts(event, HEAD, DIGEST, mine.filter((e) => e.computer !== event.computer)), false);
    assert.equal(checkCounts({ ...event, sig: undefined }, HEAD, DIGEST, mine), false);
  });
});

test('a check of another head does not count', async () => {
  await withHome(async () => {
    assert.equal(checkCounts(await written({ commit: OLD }), HEAD, DIGEST, readEnrolled()), false);
  });
});

test('a check of another command does not count', async () => {
  await withHome(async () => {
    assert.equal(checkCounts(await written(), HEAD, commandDigest('exit 0'), readEnrolled()), false);
  });
});

test('only a pass counts', async () => {
  await withHome(async () => {
    for (const word of ['failed', 'timed-out', 'could-not-run']) {
      assert.equal(checkCounts(await written({ result: word }), HEAD, DIGEST, readEnrolled(), { notCounting: true }), false, word);
    }
  });
});

test('not-counted counts only with notCounting', async () => {
  await withHome(async () => {
    const event = await written({ result: 'not-counted', command: null });
    assert.equal(checkCounts(event, HEAD, null, readEnrolled()), false);
    assert.equal(checkCounts(event, HEAD, null, readEnrolled(), { notCounting: true }), true);
  });
});

test('the tail never holds a line the secret scan flags', async () => {
  await withHome(async () => {
    const key = `ghp_${'a1B2'.repeat(9)}`;
    const event = await written({ tail: `line one\ntoken ${key}\nlast line` });
    assert.doesNotMatch(event.data.tail, /ghp_/);
    assert.match(event.data.tail, /last line/);
    assert.deepEqual(scanContent(event.data.tail), []);
  });
});

test('the tail keeps the last 4 KB', async () => {
  await withHome(async () => {
    const event = await written({ tail: `${'early line\n'.repeat(2000)}the end` });
    assert.ok(event.data.tail.length <= 4096);
    assert.match(event.data.tail, /the end$/);
  });
});

test('the record is written before writeCheck answers', async () => {
  await withHome(async () => {
    const seen = [];
    const event = await writeCheck('p', result(), { write: async (w) => { seen.push(w); } });
    assert.equal(seen[0].project, 'p');
    assert.equal(seen[0].event, event);
  });
});

test('commandDigest has no answer for no command', () => {
  assert.equal(commandDigest(null), null);
  assert.equal(commandDigest(undefined), null);
  assert.match(commandDigest('npm test'), /^[0-9a-f]{64}$/);
});

test('checksSettings fills in the time limit and leaves the network off', () => {
  assert.deepEqual(checksSettings({}), { testCommand: null, prepare: null, minutes: 20, network: false, where: null });
  assert.deepEqual(
    checksSettings({ testCommand: 'npm test', checks: { prepare: 'npm ci', minutes: 5, network: true, where: 'here' } }),
    { testCommand: 'npm test', prepare: 'npm ci', minutes: 5, network: true, where: 'here' },
  );
});

test('checksConfig reads the default branch, not the folder', async () => {
  const asked = [];
  const git = async (args) => {
    asked.push(args);
    if (args[0] === 'ls-tree') return { code: 0, stdout: '.claude/wheelhouse.json\n', stderr: '' };
    return { code: 0, stdout: JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], testCommand: 'npm test' }), stderr: '' };
  };
  const config = await checksConfig({ git, ref: 'refs/heads/main' });
  assert.equal(config.testCommand, 'npm test');
  assert.deepEqual(asked.at(-1), ['show', 'refs/heads/main:.claude/wheelhouse.json']);
});

test('checksConfig gives the empty configuration when the default branch has no file', async () => {
  const git = async () => ({ code: 0, stdout: '', stderr: '' });
  assert.equal((await checksConfig({ git, ref: 'refs/heads/main' })).testCommand, undefined);
});

test('checksConfig says so when the default branch can not be read', async () => {
  const git = async () => ({ code: 128, stdout: '', stderr: 'bad ref' });
  await assert.rejects(checksConfig({ git, ref: 'refs/heads/main' }), /could not be read/);
});
