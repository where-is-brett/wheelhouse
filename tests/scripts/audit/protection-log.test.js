// tests/scripts/audit/protection-log.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { keepingProtection, protectionLogFile, protectionLogPlace, readProtectionLog, writeProtectionLog } from '../../../scripts/audit/protection-log.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { withHome } from '../../helpers/homes.js';

const SINCE = '2026-10-01T00:00:00.000Z';
const snap = (at, merge = [40]) => ({ at, branches: { main: { push: [0], merge, force: false } }, pipelinesMustSucceed: true, skippedPipelineCounts: false });

// An adapter that reads the protection it is told to, and notes what it was asked.
function reading(...answers) {
  const asked = [];
  return {
    asked,
    async protectionEvents(args) {
      asked.push(args);
      const snapshot = answers.shift();
      if (snapshot === 'audit') return { source: 'audit-events', events: [{ at: '2026-10-12T00:00:00.000Z', by: 'x', what: 'Changed a protected branch' }] };
      const changes = args.last === null ? [] : (args.last.branches.main.merge[0] !== snapshot.branches.main.merge[0] ? [{ at: null, by: null, what: 'main: who may merge changed', between: [args.last.at, snapshot.at] }] : []);
      return { source: 'compared', first: args.last === null, snapshot, events: changes };
    },
  };
}
const clock = (iso) => () => new Date(iso);

test('the reading is kept in the Wheelhouse folder, in the project\'s own folder there, and the report says where', () => withHome(() => {
  const file = protectionLogFile('shop');
  assert.equal(file, path.join(wheelhouseHome(), 'projects', 'shop', 'audit', 'protection.json'));
  assert.equal(protectionLogPlace('shop'), 'projects/shop/audit/protection.json');
  assert.ok(!path.relative(wheelhouseHome(), file).startsWith('..'));
  assert.throws(() => protectionLogFile('../elsewhere'), /folder name/);
}));

test('a log written is the log read, and a missing log is no earlier report', () => withHome(() => {
  assert.deepEqual(readProtectionLog('shop'), { snapshot: null, changes: [], damaged: false });
  writeProtectionLog('shop', { snapshot: snap('2026-10-05T00:00:00.000Z'), changes: [{ what: 'a change', between: null, observedAt: '2026-10-06T00:00:00.000Z' }] });
  const back = readProtectionLog('shop');
  assert.equal(back.snapshot.at, '2026-10-05T00:00:00.000Z');
  assert.equal(back.changes.length, 1);
  assert.equal(back.damaged, false);
  assert.deepEqual(fs.readdirSync(path.dirname(protectionLogFile('shop'))), ['protection.json'], 'no temporary file is left');
}));

test('a log that cannot be read starts afresh and says so', () => withHome(() => {
  const file = protectionLogFile('shop');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const bad of ['not json', '{"snapshot":{"at":1},"changes":[]}', '{"snapshot":null,"changes":"x"}']) {
    fs.writeFileSync(file, bad);
    assert.deepEqual(readProtectionLog('shop'), { snapshot: null, changes: [], damaged: true });
  }
}));

test('the first look keeps the reading; the next compares with it and keeps the change', () => withHome(async () => {
  const adapter = reading(snap('2026-10-05T00:00:00.000Z'), snap('2026-10-10T00:00:00.000Z', [30]));
  const first = await keepingProtection({ project: 'shop', adapter, now: clock('2026-10-05T00:00:00.000Z') })({ since: SINCE });
  assert.equal(first.first, true);
  assert.deepEqual(first.events, []);
  assert.equal(adapter.asked[0].last, null);

  const second = await keepingProtection({ project: 'shop', adapter, now: clock('2026-10-10T00:00:00.000Z') })({ since: SINCE });
  assert.equal(second.first, false);
  assert.equal(adapter.asked[1].last.at, '2026-10-05T00:00:00.000Z', 'it was given the reading the last report kept');
  assert.deepEqual(second.events.map((e) => e.what), ['main: who may merge changed']);
  assert.equal(readProtectionLog('shop').snapshot.at, '2026-10-10T00:00:00.000Z');
}));

test('running the report again shows the same change again, and a later period leaves it out', () => withHome(async () => {
  const adapter = reading(snap('2026-10-05T00:00:00.000Z'), snap('2026-10-10T00:00:00.000Z', [30]), snap('2026-10-11T00:00:00.000Z', [30]), snap('2026-10-20T00:00:00.000Z', [30]));
  await keepingProtection({ project: 'shop', adapter, now: clock('2026-10-05T00:00:00.000Z') })({ since: SINCE });
  await keepingProtection({ project: 'shop', adapter, now: clock('2026-10-10T00:00:00.000Z') })({ since: SINCE });
  const again = await keepingProtection({ project: 'shop', adapter, now: clock('2026-10-11T00:00:00.000Z') })({ since: SINCE });
  assert.deepEqual(again.events.map((e) => e.what), ['main: who may merge changed'], 'a change is not lost because a report was run twice');
  const later = await keepingProtection({ project: 'shop', adapter, now: clock('2026-10-20T00:00:00.000Z') })({ since: '2026-10-15T00:00:00.000Z' });
  assert.deepEqual(later.events, [], 'seen before the period began');
}));

test('with audit events nothing is kept', () => withHome(async () => {
  const got = await keepingProtection({ project: 'shop', adapter: reading('audit'), now: clock('2026-10-05T00:00:00.000Z') })({ since: SINCE });
  assert.equal(got.source, 'audit-events');
  assert.equal(fs.existsSync(protectionLogFile('shop')), false);
}));

test('a reading that cannot be kept is said, and the report still has its changes', () => withHome(async () => {
  const folder = path.dirname(protectionLogFile('shop'));
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  fs.writeFileSync(folder, 'a file where the folder should be');
  const got = await keepingProtection({ project: 'shop', adapter: reading(snap('2026-10-05T00:00:00.000Z')), now: clock('2026-10-05T00:00:00.000Z') })({ since: SINCE });
  assert.equal(got.kept, false);
}));
