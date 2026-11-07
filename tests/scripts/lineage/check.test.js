// tests/scripts/lineage/check.test.js
// The session start's lineage check (scripts/lineage/check.js, checkLineage) while a project's setup
// has not yet installed the pinned kits (ruling R136): kits not installed at all are setup's own
// expected state then, not drift, so they write no hold; any other difference still holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkLineage, holdEvent, holdFile, holdsToLift, inspectCopies, isHeld, liftEvent, liftsDue, main, ROOT } from '../../../scripts/lineage/check.js';
import { MANIFEST_PATH } from '../../../scripts/lineage/manifest.js';
import path from 'node:path';
import { addCopy, lineageFixture } from '../../helpers/lineage.js';
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

test('this copy\'s manifest fingerprints every skill copy it carries', () => {
  const got = inspectCopies({ root: ROOT });
  assert.deepEqual(got.mismatches, []);
  assert.equal(got.ok, true);
});

test('the copies are checked against the manifest, and a manifest with none can\'t pass', () => {
  withHome(() => {
    const fixture = lineageFixture();
    assert.equal(inspectCopies({ root: fixture.root }).ok, false);
    const copy = addCopy(fixture);
    assert.equal(inspectCopies({ root: fixture.root }).ok, true);
    fs.appendFileSync(path.join(copy, 'SKILL.md'), 'changed\n');
    assert.deepEqual(inspectCopies({ root: fixture.root }).mismatches.map((m) => m.path), ['skills/pr']);
  });
});

test('a Claude session start\'s check still goes by the kits, with the copies matching', () => {
  withHome((home) => {
    const fixture = lineageFixture();
    addCopy(fixture);
    const folder = tempFolder('wh-kits-');
    assert.equal(checkLineage({ project: P, projectDir: folder, root: fixture.root, claudeHome: fixture.claudeHome }).ok, false);
    assert.equal(isHeld(P), true);
  });
});

// The command run in a project's folder, with the fixture's kits not installed there.
function command(fixture, folder) {
  const said = [];
  const code = main([folder], { write: (line) => said.push(line), root: fixture.root, claudeHome: fixture.claudeHome });
  return { code, said: said.join('') };
}

test('a project\'s subfolder finds the kits its folder holds, and the command passes once they match', () => {
  withHome(() => {
    const folder = tempFolder('wh-kits-');
    const fixture = lineageFixture(folder);
    addCopy(fixture);
    const inside = path.join(folder, 'src');
    fs.mkdirSync(inside);
    assert.equal(command(fixture, folder).code, 0);
    const said = [];
    assert.equal(main([inside], { write: (line) => said.push(line), root: fixture.root, claudeHome: fixture.claudeHome }), 0);
    assert.match(said.join(''), /match/);
  });
});

test('a project whose kits differ gets the command\'s kits report', () => {
  withHome(() => {
    const fixture = lineageFixture();
    addCopy(fixture);
    const { code, said } = command(fixture, tempFolder('wh-kits-'));
    assert.equal(code, 1);
    assert.equal(said, "These installed files still differ from Wheelhouse's manifest, so edits and commands stay held. Once they match, the hold lifts at the next session start.\n- superpowers: not installed\n");
  });
});
