// tests/scripts/hooks/desk-parity.test.js
// The board-context hook gives the same context through the desk as it gave reading the files
// itself: the briefing on the first prompt after a gap, the Logbook on both tabs, the settings, the
// changed sources and the cards line, each for one fixture record at a fixed clock, with the helper
// up (its desk answers, the body crossing as JSON, as it does over the socket) and with it down (the
// desk's local fallback). The fixtures under tests/fixtures/desk-parity/board-context/ were taken
// from the hook before it read through the desk; DESK_PARITY_WRITE=1 writes them again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from '../../../scripts/hooks/board-context.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { deskCore } from '../../../scripts/desk/core.js';
import { fileSource } from '../../../scripts/desk/file-source.js';
import { as, shortHome } from '../../helpers/homes.js';
import { P, NOW, now, put, viewsDir, writeRecord, upClient } from '../desk/fixture.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/desk-parity/board-context/', import.meta.url));
const HOUR_MS = 60 * 60 * 1000;
const before = (hours) => new Date(Date.parse(NOW) - hours * HOUR_MS);

// A card no visit has handed out yet, so the cards line names it.
const UNASKED = { id: 'c2', at: '2026-10-29T10:00:00.000Z', data: { question: 'Shall the footer link to the help page?', options: ['Yes', 'Not now'] }, asked: null };

// Each case: the prompt, and what the record holds beyond the fixture's before it is sent.
const CASES = {
  briefing: { prompt: 'What is new?', given: () => markSeen(P, { promptAt: before(3) }) },
  'logbook-director': { prompt: '/wheelhouse:logbook', given: () => markSeen(P, { promptAt: before(0.1) }) },
  'logbook-build': { prompt: '/wheelhouse:logbook build', given: () => markSeen(P, { promptAt: before(0.1) }) },
  settings: { prompt: '/wheelhouse:settings', given: () => markSeen(P, { promptAt: before(0.1) }) },
  sources: { prompt: '/wheelhouse:sources', given: () => markSeen(P, { promptAt: before(0.1) }) },
  cards: {
    prompt: 'Carry on',
    given: () => {
      markSeen(P, { promptAt: before(0.1) });
      const file = path.join(viewsDir(), 'waiting.json');
      put(file, [...JSON.parse(fs.readFileSync(file, 'utf8')), UNASKED]);
    },
  },
};

// A helper client whose helper is up: its desk is the core over the files, as the helper's is, and
// each body goes through JSON on the way, as it does over the socket. `asked` counts the reads.
function upHelper(repo) {
  const core = deskCore({ source: fileSource(P, { cwd: repo, client: upClient, now }), recorder: {}, now });
  const wire = (body) => JSON.parse(JSON.stringify(body));
  const helper = {
    ...upClient,
    asked: 0,
    desk: {
      read: async (body) => { helper.asked += 1; const { view, args } = wire(body); return wire(await core.read(view, args)); },
      act: async (body) => { const { command, args, evidence } = wire(body); return wire(await core.act(command, args, evidence)); },
      watch: async (body) => wire(await core.watch(wire(body).cursor)),
    },
  };
  return helper;
}

// A helper client whose helper isn't running, in the helper client's own words.
const downHelper = () => ({
  ...upClient,
  desk: Object.fromEntries(['read', 'act', 'watch'].map((op) => [op, async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' })])),
});

// The context the hook adds for the case, in a home of its own.
async function contextFor(name, helperOf) {
  const home = shortHome();
  return as(home, async () => {
    const repo = writeRecord(home);
    CASES[name].given();
    const helper = helperOf(repo);
    const out = await decide({ cwd: repo, session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: CASES[name].prompt }, { now, env: {}, client: helper });
    return { context: out?.hookSpecificOutput?.additionalContext ?? null, asked: helper.asked };
  });
}

const fixtureFile = (name) => path.join(FIXTURES, `${name}.json`);

for (const name of Object.keys(CASES)) {
  test(`${name}: the same context with the helper up and with it down`, async () => {
    const down = await contextFor(name, downHelper);
    if (process.env.DESK_PARITY_WRITE === '1') {
      fs.mkdirSync(FIXTURES, { recursive: true });
      fs.writeFileSync(fixtureFile(name), `${JSON.stringify({ prompt: CASES[name].prompt, context: down.context }, null, 2)}\n`);
    }
    const { context } = JSON.parse(fs.readFileSync(fixtureFile(name), 'utf8'));
    assert.equal(typeof context, 'string', 'the fixture holds a context');
    assert.equal(down.context, context, 'helper down');
    const up = await contextFor(name, upHelper);
    assert.equal(up.context, context, 'helper up');
    assert.ok(up.asked > 0, 'the hook read through the helper\'s desk');
  });
}
