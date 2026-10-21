// tests/scripts/eval/stand-in-helper.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plainEvent, startStandInHelper } from '../../../scripts/eval/stand-in-helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { CARRIES_BASELINE } from '../../../scripts/lib/measures-clicks.js';
import { NEEDS_CLICK } from '../../../scripts/measures/baseline.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { g } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

async function repo() {
  const dir = tempFolder('stand-in-repo-');
  await g(dir, 'init', '--quiet', '--initial-branch=main');
  await g(dir, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  await g(dir, 'checkout', '--quiet', '-b', 'feature/x');
  await g(dir, 'commit', '--quiet', '--allow-empty', '-m', 'second');
  return { dir, head: await g(dir, 'rev-parse', 'HEAD') };
}

test('the stand-in helper answers a feature session\'s commands and records each one', async () => {
  const { dir, head } = await repo();
  const helper = await startStandInHelper({ address: testAddress(shortHome()), answers: { 'q-x-2': 'yes' } });
  try {
    const client = helperClient({ address: helper.address });
    assert.deepEqual(await client.push({ cwd: dir, dir, refspec: 'feature/x' }), { ok: true, pushed: 'feature/x' });
    assert.equal((await client.push({ cwd: dir, dir, refspec: 'main' })).ok, false, 'the default branch is never pushed');
    assert.deepEqual(await client.pull({ cwd: dir, dir, branch: 'feature/x' }), { ok: true, already: true });
    const opened = await client.openPr({ cwd: dir, head: 'feature/x', title: 'T', body: 'B' });
    assert.deepEqual(opened.result.number, 1);
    assert.equal((await client.openPr({ cwd: dir, head: 'feature/x', title: 'T2', body: 'B' })).result.number, 2);
    assert.deepEqual(await client.state.answer({ cwd: dir, questionId: 'q-x-1' }), { ok: true, answer: null });
    assert.deepEqual(await client.state.answer({ cwd: dir, questionId: 'q-x-2' }), { ok: true, answer: 'yes' });
    assert.deepEqual(await client.lineage.provenance({ cwd: dir }), { ok: true, block: null, stop: false });
    assert.equal((await client.updateBranch({ project: 'p', number: 1 })).ok, false, 'anything else is refused');

    const records = helper.records();
    assert.deepEqual(records.map((r) => r.route), ['push', 'push', 'pull', 'pr/open', 'pr/open', 'state/answer', 'state/answer', 'lineage/provenance', 'POST /pr/update-branch']);
    assert.equal(records[0].sha, head);
    assert.equal(records[1].refused, true);
    assert.equal(records[2].branch, 'feature/x');
    assert.equal(records[3].sha, head);
    assert.equal(records[3].body, 'B');
    assert.equal(records[8].unanswered, true);
  } finally {
    await helper.close();
  }
});

const REVIEWED = 'c'.repeat(40);

test('the stand-in helper signs the records a run starts with, and the merge route applies the real gate to them', async () => {
  const blocked = await startStandInHelper({
    address: testAddress(shortHome()),
    state: { pullRequests: { 1: REVIEWED }, signed: [{ kind: 'review', data: { pr: 1, commit: REVIEWED, verdict: 'FINDINGS', findings: 2 } }] },
  });
  try {
    const client = helperClient({ address: blocked.address });
    assert.equal(blocked.events().length, 1, 'the signed record is in the state');
    assert.equal(blocked.events()[0].kind, 'review');
    assert.ok(blocked.events()[0].sig, 'it is signed');
    assert.equal(blocked.views().reviews['1'][REVIEWED].kind, 'review', 'by a key the stand-in enrols, so the views count it');
    const refused = await client.merge({ project: 'p', number: 1 });
    assert.equal(refused.ok, false);
    assert.match(refused.refused, /no CLEAN review of cccccc/);
    assert.equal((await client.merge({ project: 'p', number: 9 })).ok, false, 'a pull request it does not know is not open');
    assert.deepEqual(blocked.records().map((r) => [r.route, r.number, r.merged ?? false, r.refused ?? false]), [['merge', 1, false, true], ['merge', 9, false, true]]);
  } finally {
    await blocked.close();
  }

  const clean = await startStandInHelper({
    address: testAddress(shortHome()),
    state: { pullRequests: { 1: REVIEWED }, signed: [{ kind: 'review', data: { pr: 1, commit: REVIEWED, verdict: 'CLEAN', findings: 0 } }] },
  });
  try {
    const client = helperClient({ address: clean.address });
    assert.deepEqual(await client.merge({ project: 'p', number: 1 }), { ok: true, merged: true, sha: REVIEWED });
    assert.equal((await client.merge({ project: 'p', number: 1 })).ok, false, 'a merged pull request is no longer open');
    assert.deepEqual(clean.records().filter((r) => r.merged === true).map((r) => r.number), [1]);
  } finally {
    await clean.close();
  }
});

test('the stand-in helper gives an open pull request\'s preview for Show me, and none for one it doesn\'t know, as the real one does', async () => {
  const helper = await startStandInHelper({ address: testAddress(shortHome()), state: { pullRequests: { 12: 'a'.repeat(40) } } });
  try {
    const client = helperClient({ address: helper.address });
    assert.deepEqual(await client.preview({ cwd: '/p', number: 12 }), { ok: true, url: 'https://preview.host.invalid/pull/12' });
    assert.deepEqual(await client.preview({ cwd: '/p', number: 2 }), { ok: true, url: null });
    assert.deepEqual(helper.records().map((r) => [r.route, r.number, r.url]), [['pr/preview', 12, 'https://preview.host.invalid/pull/12'], ['pr/preview', 2, null]]);
  } finally {
    await helper.close();
  }
});

test('the stand-in helper keeps a caller\'s id on a plain event, and gives the card events with the views when asked', async () => {
  const helper = await startStandInHelper({ address: testAddress(shortHome()) });
  try {
    const client = helperClient({ address: helper.address });
    const id = '0b7f3c1e-5d2a-4c8b-9e6f-1a2b3c4d5e6f';
    // A card in the shape the real helper takes, which the stand-in checks as it does.
    const CARD_DATA = { kind: 'question', question: 'Q', header: 'Q', options: ['Yes', 'No'], level: 3 };
    assert.deepEqual(await client.state.write({ cwd: '/p', kind: 'card', data: CARD_DATA, id }), { ok: true, id, pushed: true });
    assert.equal((await client.state.write({ cwd: '/p', kind: 'card', data: CARD_DATA, id })).ok, false, 'an id the state holds is refused');
    assert.equal((await client.state.write({ cwd: '/p', kind: 'card', data: CARD_DATA, id: 'card-1' })).ok, false, 'an id that is not a random UUID is refused');
    const made = await client.state.write({ cwd: '/p', kind: 'asked', data: { cards: [id] } });
    assert.notEqual(made.id, id);

    const plain = await client.state.views({ cwd: '/p' });
    assert.equal(plain.cards, undefined);
    assert.equal(plain.stop, undefined, 'STOP is off');
    const withCards = await client.state.views({ cwd: '/p', cards: true });
    assert.deepEqual(withCards.cards.map((e) => [e.id, e.kind]), [[id, 'card']]);
    assert.deepEqual(helper.events().map((e) => e.kind), ['card', 'asked']);
  } finally {
    await helper.close();
  }
});

test('the stand-in helper gives the card answers with the views when asked, as the real one does for `views work`', async () => {
  const answer = plainEvent('card-answer', { card: '0b7f3c1e-5d2a-4c8b-9e6f-1a2b3c4d5e6f', label: 'Not now' }, new Date('2026-10-20T08:00:00.000Z'));
  const helper = await startStandInHelper({ address: testAddress(shortHome()), state: { events: [answer] } });
  try {
    const client = helperClient({ address: helper.address });
    assert.equal((await client.state.views({ cwd: '/p' })).answers, undefined);
    const got = await client.state.views({ cwd: '/p', answers: true });
    assert.deepEqual(got.answers.map((e) => [e.id, e.kind]), [[answer.id, 'card-answer']]);
    assert.deepEqual(helper.records().filter((r) => r.route === 'state/views').map((r) => r.answers ?? false), [false, true]);
  } finally {
    await helper.close();
  }
});

// Every file under `dir`, as full paths.
function filesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Made-up figures, distinctive enough to search a home and the records for.
const COUNTED = 'Counted by the heron-teapot tally of every builder session in the note';
const FIGURES = { usd: 5321.75, merges: 41, from: '2026-08-03', to: '2026-09-28', counted: COUNTED };
const MARKS = ['5321.75', 'heron-teapot'];

test('the stand-in helper refuses a write that carries the baseline, as the real one does', async () => {
  const home = shortHome();
  const helper = await startStandInHelper({ address: testAddress(home), home });
  try {
    const client = helperClient({ address: helper.address });
    assert.deepEqual(await client.state.write({ cwd: home, kind: 'note', data: { kind: 'baseline', text: 'the note' } }), { ok: false, refused: CARRIES_BASELINE });
    const ordinary = await client.state.write({ cwd: home, kind: 'note', data: { text: 'an ordinary note' } });
    assert.equal(ordinary.ok, true);
    assert.deepEqual(helper.events().map((e) => e.data.text), ['an ordinary note'], 'the refused event is not kept');
    const refused = helper.records().find((r) => r.refused);
    assert.deepEqual(refused, { at: refused.at, route: 'state/write', kind: 'note', refused: true, carriesBaseline: true }, 'nor is its data recorded');
  } finally {
    await helper.close();
  }
});

test('the stand-in helper reads the baseline back on a card, and records it only after the director\'s click, in its own home', async () => {
  const runnerHome = shortHome();
  const home = shortHome();
  await as(runnerHome, async () => {
    // The session's home, where the prompt record keeps the director's click, has this
    // computer's signing key enrolled.
    await as(home, async () => {
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    });
    const helper = await startStandInHelper({ address: testAddress(home), home });
    try {
      const client = helperClient({ address: helper.address });
      const shown = await client.measures.baseline(FIGURES);
      assert.equal(shown.ok, true, shown.refused);
      assert.deepEqual(shown.card.options.map((o) => o.label), ['Record these', 'Not now']);
      assert.ok(fs.existsSync(path.join(home, 'measures', 'pending.json')), 'the figures wait in the session\'s home');
      assert.deepEqual(filesUnder(runnerHome), [], 'never in the home of the process running the evaluation');

      // While they wait, a write holding a figure is refused.
      const holding = await client.state.write({ cwd: home, kind: 'note', data: { text: 'The first version cost $5,321.75.' } });
      assert.deepEqual(holding, { ok: false, refused: CARRIES_BASELINE });

      // No click yet: nothing is recorded.
      const early = await client.measures.baseline({ confirm: shown.hash });
      assert.deepEqual(early, { ok: false, refused: NEEDS_CLICK });
      assert.equal(fs.existsSync(path.join(home, 'measures', 'baseline.json')), false);

      // The director clicks Record these on the card as composed; the prompt record keeps the click.
      await as(home, () => decide({
        cwd: tempFolder('wh-desk '), hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [shown.card], answers: { [shown.card.question]: 'Record these' } },
        tool_response: { answers: { [shown.card.question]: 'Record these' } },
      }, { client: { state: { write: async () => ({ ok: true }), record: async () => ({ ok: true }) }, profile: { record: async () => ({ ok: true }) }, prState: async () => ({ ok: true }) }, projectOf: () => null }));
      assert.deepEqual(await client.measures.baseline({ confirm: shown.hash }), { ok: true, recorded: true });
      const recorded = JSON.parse(fs.readFileSync(path.join(home, 'measures', 'baseline.json'), 'utf8'));
      assert.equal(recorded.merges, 41);
      assert.deepEqual(filesUnder(runnerHome), []);

      // The records say which form was asked for and the answer, never the figures or the card.
      const asked = helper.records().filter((r) => r.route === 'measures/baseline');
      assert.deepEqual(asked.map((r) => [r.form, r.ok]), [['show', true], ['confirm', false], ['confirm', true]]);
      const text = JSON.stringify(helper.records());
      for (const mark of MARKS) assert.ok(!text.includes(mark), mark);
    } finally {
      await helper.close();
    }
  });
});

test('without a home given, the stand-in keeps the baseline\'s files in a scratch folder of its own', async () => {
  const runnerHome = shortHome();
  await as(runnerHome, async () => {
    const helper = await startStandInHelper({ address: testAddress(shortHome()) });
    try {
      const shown = await helperClient({ address: helper.address }).measures.baseline(FIGURES);
      assert.equal(shown.ok, true, shown.refused);
      assert.deepEqual(filesUnder(runnerHome), []);
    } finally {
      await helper.close();
    }
  });
});

test('a stand-in that cannot listen leaves no scratch home of its own behind', async () => {
  const home = shortHome();
  const first = await startStandInHelper({ address: testAddress(home), home });
  // The stand-in makes its own home under the temporary folder; point that at an empty one.
  const scratch = tempFolder('stand-in-tmp-');
  // On Windows the pipe already taken stops it. On a Unix socket the stand-in removes a stale
  // socket file first, so a folder in the way at the address stops it there.
  const blocked = process.platform === 'win32' ? first.address : path.join(tempFolder('stand-in-blocked-'), 'helper.sock');
  if (process.platform !== 'win32') fs.mkdirSync(blocked);
  const names = ['TMPDIR', 'TMP', 'TEMP'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = scratch;
    await assert.rejects(startStandInHelper({ address: blocked }));
    assert.deepEqual(fs.readdirSync(scratch), []);
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
    await first.close();
  }
});

test('the stand-in helper gives the delegation review with the views when asked, as the real one does for the front desk\'s `review`', async () => {
  const helper = await startStandInHelper({ address: testAddress(shortHome()) });
  try {
    const client = helperClient({ address: helper.address });
    assert.equal((await client.state.views({ cwd: '/p' })).review, undefined);
    const got = await client.state.views({ cwd: '/p', review: true });
    assert.equal(got.ok, true);
    assert.ok(Array.isArray(got.review.proposals), JSON.stringify(got.review));
    assert.equal(typeof got.review.due, 'boolean');
    assert.deepEqual(helper.records().filter((r) => r.route === 'state/views').map((r) => r.review ?? false), [false, true]);
  } finally {
    await helper.close();
  }
});
