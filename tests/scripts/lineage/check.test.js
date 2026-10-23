// tests/scripts/lineage/check.test.js
// The session start's lineage check (scripts/lineage/check.js, checkLineage) while a project's setup
// has not yet installed the pinned kits (ruling R136): kits not installed at all are setup's own
// expected state then, not drift, so they write no hold; any other difference still holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkLineage, holdEvent, holdFile, holdsToLift, liftEvent, liftsDue } from '../../../scripts/lineage/check.js';
import { lineageFixture } from '../../helpers/lineage.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const P = 'owner__name';

test('kits not installed yet hold nothing while setup has still to install them, and hold once it has (ruling R136)', () => {
  withHome(() => {
    const folder = tempFolder('wh-check-project-');
    // The fixture's installs are for another folder: nothing is installed for this one.
    const fixture = lineageFixture(tempFolder('wh-check-elsewhere-'));
    const pending = checkLineage({ project: P, projectDir: folder, root: fixture.root, claudeHome: fixture.claudeHome, pinsPending: true });
    assert.equal(pending.ok, true);
    assert.deepEqual(pending.mismatches, []);
    assert.equal(fs.existsSync(holdFile(P)), false, 'no hold');
    // Otherwise, not installed is a mismatch and holds, as before.
    const after = checkLineage({ project: P, projectDir: folder, root: fixture.root, claudeHome: fixture.claudeHome });
    assert.equal(after.ok, false);
    assert.deepEqual(after.mismatches.map((m) => [m.upstream, m.path, m.got]), [['superpowers', '*', null]]);
    assert.equal(fs.existsSync(holdFile(P)), true);
    // A pending check that finds nothing else lifts that hold.
    assert.equal(checkLineage({ project: P, projectDir: folder, root: fixture.root, claudeHome: fixture.claudeHome, pinsPending: true }).ok, true);
    assert.equal(fs.existsSync(holdFile(P)), false);
  });
});

test('while setup has still to install the kits, a kit installed but differing, or a manifest that can\'t be read, still holds (ruling R136)', () => {
  withHome(() => {
    const folder = tempFolder('wh-check-project-');
    const fixture = lineageFixture(folder);
    fixture.put({ LICENSE: 'another licence\n' });
    const differs = checkLineage({ project: P, projectDir: folder, root: fixture.root, claudeHome: fixture.claudeHome, pinsPending: true });
    assert.equal(differs.ok, false);
    assert.deepEqual(differs.mismatches.map((m) => [m.upstream, m.path]), [['superpowers', 'LICENSE']]);
    assert.equal(fs.existsSync(holdFile(P)), true);
    fs.rmSync(holdFile(P));
    const unread = checkLineage({ project: P, projectDir: folder, root: tempFolder('wh-check-no-root-'), claudeHome: fixture.claudeHome, pinsPending: true });
    assert.equal(unread.ok, false);
    assert.equal(fs.existsSync(holdFile(P)), true);
  });
});

test('a lift is due only with no hold file and a hold event of this computer in the views', () => {
  const hold = (computer, id = 'h') => ({ id, at: 'x', computer, data: { at: 'x', mismatches: [] }, card: null });
  const due = (holds, held = false) => liftsDue({ lineageHolds: holds }, { computer: 'aaaaaaaa', held });
  assert.equal(due([hold('aaaaaaaa')]), true);
  assert.equal(due([hold('bbbbbbbb')]), false);
  assert.equal(due([hold(null)]), false, 'a hold with no computer is left standing');
  assert.equal(due([hold('aaaaaaaa')], true), false, 'the file stands');
  assert.equal(due([]), false);
  assert.equal(liftsDue(null, { computer: 'aaaaaaaa', held: false }), false);
  assert.deepEqual(holdsToLift({ lineageHolds: [hold('aaaaaaaa', 'h1'), hold('bbbbbbbb', 'h2')] }, { computer: 'aaaaaaaa', held: false }), ['h1']);
});

test('the lift event names the holds it lifts', () => {
  assert.deepEqual(holdEvent('t', [{ path: 'p' }]), { at: 't', mismatches: [{ upstream: null, path: 'p' }] });
  assert.deepEqual(liftEvent('t', ['h1']), { at: 't', holds: ['h1'] });
});
