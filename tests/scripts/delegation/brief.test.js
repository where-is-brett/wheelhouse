// tests/scripts/delegation/brief.test.js
// The standing brief: what may be in it, that only the director's signed click puts one in force, and that a build step
// reads it through the helper and has no way to write it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addFact, briefLines, briefProblem, briefStands, briefWords, wholeBrief } from '../../../scripts/delegation/brief.js';
import { BRIEF_EXAMPLES_MOST, BRIEF_FACTS_MOST, BRIEF_LINE_MOST } from '../../../scripts/delegation/limits.js';
import { engineRoutes } from '../../../scripts/engine/routes.js';
import { orderStore } from '../../../scripts/engine/order.js';
import { TICKET_FILE } from '../../../scripts/engine/ticket.js';
import { buildViews } from '../../../scripts/state/views.js';
import { confirmationFor, CONFIRMABLE_KINDS, HELPER_ONLY_KINDS, makeEvent, PLAIN_KINDS, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const LINES = { for: 'Shop owners, who get their own order files.', now: 'Stop the calls to support.', noGos: 'Leave billing as it is.', examples: ['Like the invoices page. Not a wizard.'], facts: [{ words: 'The live site is on the Sydney server.', date: '2026-10-30' }] };
const at = (hour) => () => new Date(`2026-11-01T${String(hour).padStart(2, '0')}:00:00.000Z`);
const signing = () => {
  const { computer, publicKey } = makeSigningKey();
  enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
};
const built = (events) => buildViews(events, readEnrolled(), { now: at(23) });
const drafted = (data, hour = 1) => makeEvent({ kind: 'brief', data, now: at(hour) });
const signed = (event, hour = 2) => makeEvent({ ...confirmationFor(event), now: at(hour) });

test('a blank line is allowed', () => {
  assert.equal(briefProblem({ for: '', now: '', noGos: '', examples: [], facts: [] }), null);
  assert.equal(briefProblem(LINES), null);
});

test('a fact needs its date', () => {
  assert.match(briefProblem({ ...LINES, facts: [{ words: 'It runs in Sydney.' }] }), /date/);
  assert.match(briefProblem({ ...LINES, facts: [{ words: 'It runs in Sydney.', date: '2026-02-31' }] }), /date/);
  assert.match(briefProblem({ ...LINES, facts: [{ words: '', date: '2026-10-30' }] }), /words/);
});

test('a secret is refused', () => {
  const key = `ghp_${'a1B2'.repeat(9)}`;
  assert.match(briefProblem({ ...LINES, now: `Use ${key}` }), /secret/);
  assert.match(briefProblem({ ...LINES, facts: [{ words: `The key is ${key}`, date: '2026-10-30' }] }), /secret/);
});

test('each line stays short, on one line, and of the shape the design gives', () => {
  assert.ok(briefProblem(null));
  assert.ok(briefProblem({ ...LINES, for: 'x'.repeat(BRIEF_LINE_MOST + 1) }));
  assert.ok(briefProblem({ ...LINES, for: 'two\nlines' }));
  assert.ok(briefProblem({ ...LINES, now: undefined }));
  assert.ok(briefProblem({ ...LINES, examples: Array(BRIEF_EXAMPLES_MOST + 1).fill('Like this.') }));
  assert.ok(briefProblem({ ...LINES, examples: [''] }));
  assert.ok(briefProblem({ ...LINES, facts: Array(BRIEF_FACTS_MOST + 1).fill(LINES.facts[0]) }));
  assert.ok(briefProblem({ ...LINES, facts: [{ ...LINES.facts[0], source: 'me' }] }));
});

test('its words show every line and each fact\'s date, a blank line as blank', () => {
  const words = briefWords(LINES);
  for (const part of [LINES.for, LINES.now, LINES.noGos, LINES.examples[0], LINES.facts[0].words, '30 October 2026']) assert.ok(words.includes(part), part);
  assert.equal(wholeBrief({}).words, 'For: left blank. Now: left blank. No-gos: left blank. Examples: left blank. Facts: left blank.');
  assert.ok(!/\n/.test(words));
});

test('the brief is a confirmable kind no one signs but the director', () => {
  assert.ok(PLAIN_KINDS.includes('brief'));
  assert.ok(CONFIRMABLE_KINDS.includes('brief'));
  assert.ok(!PROTECTED_KINDS.includes('brief'));
  assert.ok(!HELPER_ONLY_KINDS.includes('brief'));
  assert.throws(() => drafted({ ...wholeBrief(LINES), words: 'Something gentler than what the record says.' }), /words/);
  assert.throws(() => drafted({ ...wholeBrief(LINES), facts: [{ words: 'No date.' }] }), /date/);
});

test('with no brief the view holds none, and nothing else changes', () => withHome(() => {
  signing();
  const ruling = makeEvent({ kind: 'ruling', data: { words: 'Keep it plain' }, now: at(1) });
  const before = built([ruling, signed(ruling)]);
  assert.equal(before.brief, null);
  const draft = drafted(wholeBrief(LINES), 3);
  const { brief: unsigned, ...after } = built([ruling, signed(ruling), draft]);
  assert.equal(unsigned, null, 'a draft is no brief');
  const { brief: none, ...rest } = before;
  assert.deepEqual(Object.keys(after).sort(), Object.keys(rest).sort());
  assert.deepEqual(after.rulebook, rest.rulebook);
}));

test('the latest signed brief stands, one to a project', () => withHome(() => {
  signing();
  const first = drafted(wholeBrief(LINES), 1);
  const second = drafted(wholeBrief({ ...LINES, now: 'Ship the order files.' }), 3);
  assert.deepEqual(built([first, signed(first)]).brief, { brief: first.data, signedAt: signed(first).at });
  assert.equal(built([first, signed(first), second, signed(second, 4)]).brief.brief.now, 'Ship the order files.');
  assert.equal(built([first, second, signed(second, 4), signed(first, 5)]).brief.brief.now, 'Ship the order files.', 'an older version signed late doesn\'t take its place');
}));

test('a record whose words aren\'t its lines stands for nothing, signed or not', () => withHome(() => {
  signing();
  const good = wholeBrief(LINES);
  assert.equal(briefStands(good), true);
  assert.equal(briefStands({ ...good, words: 'Other words.' }), false);
  const forged = { ...drafted(good), data: { ...good, words: 'Other words.' } };
  assert.equal(built([forged, signed(forged)]).brief, null);
}));

test('a confirmation with no good signature puts nothing in force', () => withHome(() => {
  signing();
  const draft = drafted(wholeBrief(LINES));
  const { sig, ...unsigned } = signed(draft);
  assert.equal(built([draft, unsigned]).brief, null);
}));

test('a fact given on a card may join the brief, with its date, by a confirm card', () => withHome(() => {
  signing();
  const first = drafted(wholeBrief(LINES));
  const { brief } = built([first, signed(first)]).brief;
  const next = addFact(brief, { words: 'The shop has one till.', date: '2026-11-01' });
  assert.deepEqual(next.facts.at(-1), { words: 'The shop has one till.', date: '2026-11-01' });
  assert.ok(next.words.includes('The shop has one till. (1 November 2026)'));
  assert.equal(brief.facts.length, 1, 'the brief in force stays as it was');
  const draft = drafted(next, 3);
  assert.equal(built([first, signed(first), draft]).brief.brief.facts.length, 1, 'nothing changes until the Confirm');
  assert.equal(built([first, signed(first), draft, signed(draft, 4)]).brief.brief.facts.length, 2);
  assert.match(briefProblem(addFact(brief, { words: 'No date here.' })), /date/);
}));

test('a fact given again takes its new date', () => {
  const next = addFact(wholeBrief(LINES), { words: LINES.facts[0].words, date: '2026-11-01' });
  assert.deepEqual(next.facts, [{ words: LINES.facts[0].words, date: '2026-11-01' }]);
});

test('a build step reads it through the helper and can\'t write it', async () => {
  const dir = tempFolder('wh-brief-route-');
  const orders = path.join(dir, 'orders');
  const written = [];
  const engine = { name: 'fake', artefactsOf: (runId) => path.join(dir, 'run', runId), start: async () => ({ ok: true, runId: 'reader-1' }) };
  const inForce = { current: { brief: wholeBrief(LINES), signedAt: '2026-11-01T02:00:00.000Z' } };
  const { routes, startReader } = engineRoutes({
    projects: () => [{ project: 'p', folder: path.join(dir, 'project') }], engineFor: () => engine, ordersDir: () => orders, filesDir: () => path.join(dir, 'engine'), held: () => false,
    write: async (project, kind) => { written.push(kind); }, briefOf: () => inForce.current,
  });
  await startReader({ project: 'p', card: 'q-w-1', folder: '/f', bindings: {} });
  assert.equal(orderStore(orders).load('reader-1').card, 'q-w-1');
  const ticket = fs.readFileSync(path.join(dir, 'run', 'reader-1', TICKET_FILE), 'utf8').trim();
  const read = routes['/engine/brief'];
  assert.deepEqual(await read({ runId: 'reader-1', ticket }), { ok: true, brief: LINES });
  assert.equal((await read({ runId: 'reader-1' })).ok, false, 'it asks for the run\'s ticket');
  assert.equal((await read({ runId: 'someone-else', ticket })).ok, false);
  assert.deepEqual(await read({ runId: 'reader-1', ticket, for: 'Someone else', words: 'Other words.' }), { ok: true, brief: LINES }, 'what a step sends changes nothing');
  inForce.current = null;
  assert.deepEqual(await read({ runId: 'reader-1', ticket }), { ok: true, brief: null });
  assert.deepEqual(written, []);
  assert.deepEqual(Object.keys(routes).filter((name) => name.includes('brief')), ['/engine/brief'], 'no route writes it');
});

test('the reader\'s lines leave the card\'s words out', () => {
  assert.deepEqual(briefLines(wholeBrief(LINES)), LINES);
  assert.equal(briefLines(null), null);
  assert.equal(briefLines(undefined), null);
});
