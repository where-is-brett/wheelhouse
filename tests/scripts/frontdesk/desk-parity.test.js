// tests/scripts/frontdesk/desk-parity.test.js
// The front desk's output, pinned: each command run against the stand-in helper, seeded with the
// same record each time, gives exactly the text kept under tests/fixtures/desk-parity/frontdesk/.
// The fixtures were written from the command as it was before it read through the desk, so the
// move changes nothing the director sees. Ids the stand-in makes are random, so every id in the
// output is named by the order it first appears in. `WHEELHOUSE_WRITE_PARITY=1` writes the fixtures
// again; without it a fixture is only compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStandInHelper } from '../../../scripts/eval/stand-in-helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { main, VIEW_NAMES } from '../../../scripts/frontdesk/cli.js';
import { shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/desk-parity/frontdesk/', import.meta.url));
const WRITE = process.env.WHEELHOUSE_WRITE_PARITY === '1';
const NOW = new Date('2026-10-29T03:00:00.000Z');
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const at = (n) => new Date(Date.UTC(2026, 9, 28, 1, 0, n)).toISOString();
const idOf = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const event = (n, kind, data) => ({ v: 1, id: idOf(n), at: at(n), computer: '0e7a1000', kind, data });

const says = (label) => ({ label, says: `It ${label.toLowerCase()}s and goes ahead.` });
const PRODUCT = {
  kind: 'question', level: 2, what: 'Which name suits the order page?', why: 'It is the wording users see.',
  options: [says('Plain'), says('Playful')], recommend: 'Plain', because: 'it reads quickest', meanwhile: 'The page keeps its old name.',
};
const APPROVAL = {
  kind: 'approval', level: 3, what: 'Pull request #7 changes the wording on the sign-in page.', why: 'It changes what users see.',
  options: [says('Approve')], recommend: 'Approve', because: 'the checks passed', meanwhile: 'Nothing is released.',
  target: { pr: 7, sha: FULL },
};
const QUESTION = {
  id: 'q-export-csv-1', work: 'export-csv', what: 'The export needs to know which separator to use.', why: 'It changes the file people download.',
  options: [{ label: 'Comma', says: 'Commas between values; opens in any spreadsheet.' }, { label: 'Tab', says: 'Tabs between values.' }],
  recommendation: 'Tab', level: 2,
};

// The record each command starts from: open work (one of it waiting on the build's question), a
// waiting approval card and a waiting question card, the build's open question, an idea and a ruling.
const SEED = [
  event(1, 'work', { id: 'sign-in-words', title: 'New wording on the sign-in page', lane: 'small', visible: true, dependsOn: [] }),
  event(2, 'work', { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] }),
  event(3, 'card', composeCard(APPROVAL).card),
  event(4, 'card', composeCard(PRODUCT).card),
  event(5, 'question', QUESTION),
  event(6, 'idea', { title: 'A dark theme for the shop' }),
  event(7, 'ruling', { words: 'Money is shown in dollars' }),
];

// Each command, as its fixture's name, its arguments and its standard input.
const RUNS = [
  ['cards', ['cards']],
  ['card', ['card'], JSON.stringify({ ...PRODUCT, what: 'Which colour suits the order button?' })],
  ['again', ['again', '1']],
  ['why', ['why', '1']],
  ...VIEW_NAMES.map((name) => [`views-${name}`, ['views', name]]),
  ['suggest', ['suggest', idOf(3), 'sign-in-words', 'The sign-in page says Welcome back instead of Sign in']],
  ['preview', ['preview', '7']],
];

// Every id in the text named by the order it first appears in.
function steady(text) {
  const seen = new Map();
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!seen.has(id)) seen.set(id, `<id-${seen.size + 1}>`);
    return seen.get(id);
  });
}

// Runs one command against a stand-in helper seeded with SEED; resolves with its exit code and text.
async function runOne(argv, input) {
  const helper = await startStandInHelper({ address: testAddress(shortHome()), state: { events: structuredClone(SEED), pullRequests: { 7: FULL } } });
  try {
    let out = '';
    let err = '';
    const code = await main(argv, {
      cwd: tempFolder('wh-parity-'), client: helperClient({ address: helper.address }), input, now: () => NOW,
      out: (t) => { out += t; }, err: (t) => { err += t; },
    });
    return steady(`exit ${code}\n--- out\n${out}--- err\n${err}`);
  } finally {
    await helper.close();
  }
}

for (const [name, argv, input] of RUNS) {
  test(`the front desk's ${argv.join(' ').slice(0, 40)} gives the text pinned before the desk`, async () => {
    const got = await runOne(argv, input);
    const file = path.join(FIXTURES, `${name}.txt`);
    if (WRITE) {
      fs.mkdirSync(FIXTURES, { recursive: true });
      fs.writeFileSync(file, got);
    }
    assert.ok(fs.existsSync(file), `${file} is missing: run with WHEELHOUSE_WRITE_PARITY=1 on the command before the desk to pin it`);
    assert.equal(got, fs.readFileSync(file, 'utf8'));
  });
}
