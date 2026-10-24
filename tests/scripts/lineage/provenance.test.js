// tests/scripts/lineage/provenance.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BEGIN, END, WHY, bodyProvenance, claudeCodeOf, modelsOf, parseProvenance, provenanceBlock, provenanceMatches, removeProvenance, sessionProvenance, stampProvenance,
} from '../../../scripts/lineage/provenance.js';
import { readManifest } from '../../../scripts/lineage/manifest.js';
import { lineageFixture } from '../../helpers/lineage.js';
import { tempFolder, as } from '../../helpers/homes.js';
import { matchingProvenance, writeSessionProvenance } from '../../helpers/provenance.js';

const P = 'o__p';
const PROVENANCE = {
  wheelhouse: '1.2.3',
  upstreams: { superpowers: 'a'.repeat(40), 'mattpocock-skills': 'b'.repeat(40) },
  register: '0.4.0',
  claudeCode: '2.1.300',
  models: ['model-a', 'model-b'],
  fingerprints: 'match',
};

test('the block round-trips, and a second stamp replaces the first', () => {
  const once = stampProvenance('Shipped the sign-in page.', PROVENANCE);
  assert.ok(once.startsWith('Shipped the sign-in page.\n\n'));
  assert.deepEqual(parseProvenance(once), PROVENANCE);
  // One line each, between the two markers.
  const block = provenanceBlock(PROVENANCE);
  assert.deepEqual(block.split('\n'), [
    BEGIN,
    '**Built with**',
    '- Wheelhouse: 1.2.3',
    `- Upstream superpowers: ${'a'.repeat(40)}`,
    `- Upstream mattpocock-skills: ${'b'.repeat(40)}`,
    '- Register: 0.4.0',
    '- Claude Code: 2.1.300',
    '- Models: model-a, model-b',
    '- Fingerprints: match',
    END,
  ]);

  const later = { ...PROVENANCE, claudeCode: '2.1.301', models: ['model-c'], fingerprints: 'mismatch' };
  const twice = stampProvenance(once, later);
  assert.equal(twice.split(BEGIN).length, 2, 'one block');
  assert.deepEqual(parseProvenance(twice), later);
  assert.equal(removeProvenance(twice), 'Shipped the sign-in page.');

  // Unknown values and no models survive the trip as null and [].
  const sparse = { ...PROVENANCE, wheelhouse: null, register: null, claudeCode: null, models: [], upstreams: { superpowers: null } };
  assert.deepEqual(parseProvenance(stampProvenance('', sparse)), sparse);
  // A value with spaces or markup is not carried as it is.
  assert.equal(parseProvenance(stampProvenance('', { ...PROVENANCE, wheelhouse: `1.0 ${END}` })).wheelhouse, null);
});

test('a block that has been tampered with, doubled or cut off is not read', () => {
  const good = stampProvenance('Body.', PROVENANCE);
  assert.equal(parseProvenance('Body with no block.'), null);
  assert.equal(parseProvenance(`${good}\n${provenanceBlock(PROVENANCE)}`), null, 'two blocks');
  assert.equal(parseProvenance(good.replace('- Fingerprints: match', '- Fingerprints: perhaps')), null);
  assert.equal(parseProvenance(good.replace('- Fingerprints: match\n', '')), null, 'a field missing');
  assert.equal(parseProvenance(good.replace('- Register: 0.4.0', '- Register: 0.4.0\n- Register: 0.5.0')), null, 'a field twice');
  assert.equal(parseProvenance(good.replace('- Register: 0.4.0', '- Colour: red')), null, 'a field not known');
  assert.equal(parseProvenance(good.replace(END, '')), null, 'no end');
  // A stray marker is taken out when the block is stamped again.
  assert.equal(parseProvenance(stampProvenance(`${BEGIN} left open`, PROVENANCE)).wheelhouse, '1.2.3');
});

test('provenance matches the manifest only with the same versions, commits and fingerprints, and a new enough Claude Code', () => {
  const root = lineageFixture(tempFolder('wh-project-')).root;
  const manifest = readManifest(root);
  const match = matchingProvenance(root);
  assert.deepEqual(provenanceMatches(match, manifest), { ok: true });
  assert.deepEqual(provenanceMatches({ ...match, claudeCode: '10.0.0' }, manifest), { ok: true });
  const cases = [
    [{ wheelhouse: '9.9.9' }, WHY.wheelhouse],
    [{ wheelhouse: null }, WHY.wheelhouse],
    [{ upstreams: { superpowers: 'c'.repeat(40) } }, WHY.upstream],
    [{ upstreams: { superpowers: null } }, WHY.upstream],
    [{ upstreams: {} }, WHY.upstream],
    [{ upstreams: { ...match.upstreams, other: 'd'.repeat(40) } }, WHY.upstream],
    [{ fingerprints: 'mismatch' }, WHY.fingerprints],
    [{ claudeCode: '2.1.294' }, WHY.claudeCode],
    [{ claudeCode: '2.0.999' }, WHY.claudeCode],
    [{ claudeCode: null }, WHY.claudeCode],
  ];
  for (const [over, why] of cases) assert.deepEqual(provenanceMatches({ ...match, ...over }, manifest), { ok: false, why }, JSON.stringify(over));
  assert.deepEqual(provenanceMatches(null, manifest), { ok: false, why: WHY.none });

  // The gate's view of a body: no block, an unreadable one, an unreadable manifest.
  assert.deepEqual(bodyProvenance(stampProvenance('x', match), root), { ok: true });
  assert.deepEqual(bodyProvenance('x', root), { ok: false, why: WHY.none });
  assert.deepEqual(bodyProvenance(undefined, root), { ok: false, why: WHY.none });
  assert.deepEqual(bodyProvenance(`${BEGIN}\nnonsense\n${END}`, root), { ok: false, why: WHY.unreadable });
  assert.deepEqual(bodyProvenance(stampProvenance('x', match), tempFolder('wh-empty-')), { ok: false, why: WHY.manifest });
  // Every reason is a set phrase.
  assert.deepEqual(Object.values(WHY).sort(), [
    'Claude Code is older than the floor', 'an upstream commit differs', 'no provenance block', 'the Wheelhouse version differs',
    'the agent is older than its pin', 'the fingerprints did not match', 'the installed manifest can\'t be read', 'the provenance block can\'t be read',
  ]);
});

test('a session\'s provenance comes from its file on this computer, with the models of its transcript', async () => {
  await as(tempFolder('wh-home-'), async () => {
    const file = writeSessionProvenance(P, 'sess-1', { models: ['model-a', 'model-b', 'model-a'] });
    const found = sessionProvenance({ project: P, sessionId: 'sess-1' });
    assert.deepEqual(found, { ...matchingProvenance(), models: ['model-a', 'model-b'] });
    assert.equal('transcript' in found, false, 'the block never carries the path');

    assert.equal(sessionProvenance({ project: P, sessionId: 'sess-2' }), null, 'no file');
    assert.equal(sessionProvenance({ project: P, sessionId: '../x' }), null);
    assert.equal(sessionProvenance({ project: P, sessionId: undefined }), null);
    fs.writeFileSync(file, '{ not json');
    assert.equal(sessionProvenance({ project: P, sessionId: 'sess-1' }), null);
    fs.writeFileSync(file, JSON.stringify({ wheelhouse: '1', upstreams: {}, fingerprints: 'maybe' }));
    assert.equal(sessionProvenance({ project: P, sessionId: 'sess-1' }), null);

    // A transcript that is gone gives no models; the rest still reads.
    writeSessionProvenance(P, 'sess-3', { transcript: path.join(tempFolder('wh-gone-'), 'none.jsonl') });
    assert.deepEqual(sessionProvenance({ project: P, sessionId: 'sess-3' }).models, []);
  });
  assert.deepEqual(modelsOf([
    { type: 'assistant', message: { model: 'model-a' } }, { type: 'user', message: { model: 'model-x' } },
    { type: 'assistant', message: { model: '<synthetic>' } }, { type: 'assistant', message: { model: 'bad model' } }, null,
  ]), ['model-a']);
});

test('a session\'s Claude Code version is the transcript\'s newest when it has one, else the file\'s (R144)', async () => {
  await as(tempFolder('wh-home-'), async () => {
    // At a first session start the transcript had no entry, so the file says unknown.
    const file = writeSessionProvenance(P, 'sess-1', { claudeCode: null });
    const transcript = JSON.parse(fs.readFileSync(file, 'utf8')).transcript;
    assert.equal(sessionProvenance({ project: P, sessionId: 'sess-1' }).claudeCode, null);
    fs.appendFileSync(transcript, `\n${JSON.stringify({ type: 'user', version: '2.1.299' })}\n${JSON.stringify({ type: 'assistant', version: '2.1.300', message: { model: 'model-b' } })}\n${JSON.stringify({ type: 'summary' })}\n`);
    const found = sessionProvenance({ project: P, sessionId: 'sess-1' });
    assert.equal(found.claudeCode, '2.1.300');
    assert.deepEqual(found.models, ['model-a', 'model-b']);
    // The transcript's version wins over the file's; a transcript with none leaves the file's.
    writeSessionProvenance(P, 'sess-2', { claudeCode: '2.1.295' });
    assert.equal(sessionProvenance({ project: P, sessionId: 'sess-2' }).claudeCode, '2.1.295');
  });
  assert.equal(claudeCodeOf([{ version: '2.1.1' }, { version: '2.1.300-beta' }, {}]), '2.1.300');
  assert.equal(claudeCodeOf([{ version: '2.1.1' }, { version: 'odd' }]), null, 'the newest one that carries a version is the one read');
  assert.equal(claudeCodeOf([]), null);
  assert.equal(claudeCodeOf(null), null);
});

test('a marker split around another is taken out as well', () => {
  const split = `Text.\n<!-- wheel${END}house-provenance -->\n- Claude Code: 99.0.0\n<!-- /wheel${BEGIN}house-provenance -->`;
  assert.equal(removeProvenance(split), 'Text.\n\n- Claude Code: 99.0.0');
  const stamped = stampProvenance(split, PROVENANCE);
  assert.equal(stamped.split(BEGIN).length, 2, 'one block');
  assert.deepEqual(parseProvenance(stamped), PROVENANCE);
});
