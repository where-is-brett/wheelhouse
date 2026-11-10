// tests/scripts/agents/copilot/kits.test.js
// The pinned loops' skills kept for Copilot sessions (scripts/agents/copilot/kits.js): fetched once at the pinned
// commit, checked against the manifest's hashes, never followed through a link, and a mismatch holds the project's work with
// the lineage hold's record. Nothing is fetched from the network: `localKits` (tests/helpers/copilot-kits.js) copies a local folder in.
import '../../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KIT_SKILLS, localKits } from '../../../helpers/copilot-kits.js';
import { withHome } from '../../../helpers/homes.js';
import {
  KITS_HOLD, KITS_LIFTS, ensureKits, kitFolder, kitMismatches, kitSkills, kitsDir, kitsForSession,
} from '../../../../scripts/agents/copilot/kits.js';
import { agentHoldFile, isHeld, readAgentHold } from '../../../../scripts/lineage/check.js';

const PROJECT = 'o__p';
const NOW = () => new Date('2026-11-10T00:00:00Z');

test('a kit is fetched once, only its used folders are kept, and the skills come back by name', () => withHome(async () => {
  const { kits, fetched } = localKits();
  assert.deepEqual(await ensureKits({ ...kits, now: NOW }), ['kit-a']);
  const folder = kitFolder(kits.manifest.upstreams[0]);
  assert.ok(folder.startsWith(kitsDir()));
  assert.deepEqual(fs.readdirSync(folder), ['skills'], 'the README the manifest does not name is not kept');
  assert.deepEqual(await ensureKits({ ...kits, now: NOW }), [], 'a kept copy is not fetched again');
  assert.deepEqual(fetched, ['kit-a']);
  assert.deepEqual(kitMismatches(kits), []);
  const skills = kitSkills({ ...kits, now: NOW });
  assert.deepEqual(skills.map((s) => s.name), KIT_SKILLS);
  assert.deepEqual(skills.map((s) => s.dir), KIT_SKILLS.map((n) => path.join(folder, 'skills', n)));
  assert.ok(skills.every((s) => /^[0-9a-f]{64}$/.test(s.hash)));
}));

test('a folder that differs from the manifest is found, and refuses the session with the lineage hold\'s record', () => withHome(async () => {
  const { kits } = localKits();
  await ensureKits({ ...kits, now: NOW });
  fs.appendFileSync(path.join(kitFolder(kits.manifest.upstreams[0]), 'skills', 'alpha', 'SKILL.md'), 'edited\n');
  assert.deepEqual(kitMismatches(kits), [{ upstream: 'kit-a', path: 'skills/alpha' }]);
  assert.throws(() => kitSkills({ ...kits, now: NOW }), (error) => {
    assert.match(error.message, /don't match Wheelhouse's manifest \(kit-a\/skills\/alpha\)/);
    assert.deepEqual(error.records, [{ kind: 'lineage-hold', data: { at: NOW().toISOString(), mismatches: [{ upstream: 'kit-a', path: 'skills/alpha' }] } }]);
    return true;
  });
}));

test('a fetch whose folder differs from the manifest keeps nothing', () => withHome(async () => {
  const { kits } = localKits();
  const wrong = { ...kits, fetchTo: async (u, dir) => {
    await kits.fetchTo(u, dir);
    fs.writeFileSync(path.join(dir, 'skills', 'beta', 'SKILL.md'), 'Tampered.\n');
  } };
  await assert.rejects(ensureKits({ ...wrong, now: NOW }), (error) => {
    assert.deepEqual(error.records[0].data.mismatches, [{ upstream: 'kit-a', path: 'skills/beta' }]);
    return true;
  });
  assert.ok(!fs.existsSync(kitFolder(kits.manifest.upstreams[0])), 'no folder is kept');
  assert.deepEqual(fs.readdirSync(path.dirname(kitFolder(kits.manifest.upstreams[0]))), [], 'and no work folder is left');
}));

test('a link in a kit folder is never copied or followed', { skip: process.platform === 'win32' && 'links need rights on Windows' }, () => withHome(async () => {
  const { kits } = localKits();
  const linked = { ...kits, fetchTo: async (u, dir) => {
    await kits.fetchTo(u, dir);
    fs.symlinkSync('/etc/hosts', path.join(dir, 'skills', 'alpha', 'link'));
  } };
  await assert.rejects(ensureKits({ ...linked, now: NOW }), /don't match Wheelhouse's manifest/);
  assert.ok(!fs.existsSync(kitFolder(kits.manifest.upstreams[0])));
  // And one put into a kept copy is found as a mismatch.
  await ensureKits({ ...kits, now: NOW });
  fs.symlinkSync('/etc/hosts', path.join(kitFolder(kits.manifest.upstreams[0]), 'skills', 'alpha', 'link'));
  assert.deepEqual(kitMismatches(kits), [{ upstream: 'kit-a', path: 'skills/alpha' }]);
}));

test('two upstreams\' skills of one name are refused', () => withHome(async () => {
  const { kits } = localKits();
  const [one] = kits.manifest.upstreams;
  const two = { ...one, name: 'kit-b', plugin: 'kit-b', sha: 'b'.repeat(40) };
  const both = { ...kits, manifest: { upstreams: [one, two] } };
  await ensureKits({ ...both, now: NOW });
  assert.throws(() => kitSkills({ ...both, now: NOW }), /Two upstream kits have a skill named alpha/);
}));

test('a name or commit that isn\'t plain is refused before a folder is made', () => {
  assert.throws(() => kitFolder({ name: '../x', sha: 'a'.repeat(40) }), /plain name and a pinned commit/);
  assert.throws(() => kitFolder({ name: 'kit-a', sha: 'main' }), /plain name and a pinned commit/);
  assert.throws(() => kitSkills({ manifest: { upstreams: [{ name: 'kit-a', sha: 'a'.repeat(40), folders: [{ path: 'skills/../x', hash: 'h' }] }] } }), /isn't a kit folder's path|don't match/);
});

test('a start whose kits differ writes the kit hold and raises its record once; one whose kits match lifts it', () => withHome(async () => {
  const { kits } = localKits();
  assert.deepEqual((await kitsForSession({ project: PROJECT, ...kits, now: NOW })).lifted, false, 'a match with no hold standing lifts nothing');
  assert.equal(isHeld(PROJECT), false);

  const alpha = path.join(kitFolder(kits.manifest.upstreams[0]), 'skills', 'alpha', 'SKILL.md');
  const good = fs.readFileSync(alpha, 'utf8');
  fs.writeFileSync(alpha, 'Tampered.\n');
  let error;
  try { await kitsForSession({ project: PROJECT, ...kits, now: NOW }); } catch (e) { error = e; }
  assert.ok(error, 'the start is refused');
  assert.equal(isHeld(PROJECT), true);
  assert.equal(fs.existsSync(agentHoldFile(PROJECT, KITS_HOLD)), true);
  const held = readAgentHold(PROJECT, KITS_HOLD);
  assert.equal(held.agent, 'copilot');
  assert.equal(held.lifts, KITS_LIFTS);
  assert.deepEqual(error.records.map((r) => [r.kind, r.data.lifts]), [['lineage-hold', KITS_LIFTS]], 'the record for the card, until it is in the state');
  // Once the record is in the state, the same hold raises nothing more.
  assert.equal(error.raised(), true);
  let again;
  try { await kitsForSession({ project: PROJECT, ...kits, now: NOW }); } catch (e) { again = e; }
  assert.deepEqual(again.records, [], 'the hold\'s set is already recorded');

  // The kits put back: the next start lifts the hold.
  fs.writeFileSync(alpha, good);
  const result = await kitsForSession({ project: PROJECT, ...kits, now: NOW });
  assert.equal(result.lifted, true);
  assert.deepEqual(result.skills.map((s) => s.name), KIT_SKILLS);
  assert.equal(isHeld(PROJECT), false);
}));

test('a fetch that fails refuses the start as it is and writes no hold', () => withHome(async () => {
  const { kits } = localKits();
  const failing = { ...kits, fetchTo: async () => { throw new Error('no network here'); } };
  await assert.rejects(kitsForSession({ project: PROJECT, ...failing, now: NOW }), /no network here/);
  assert.equal(isHeld(PROJECT), false);
}));
