// tests/scripts/setup/session-kind.test.js
// The kind of session (the Desktop app or a terminal) goes from the command, through the helper's routes, to the plan and the
// cards: a terminal asks for a typed backup path and recommends skipping the phone test; only the app opens a window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, inDesktopApp } from '../../../scripts/setup/cli.js';
import { setupRoutes } from '../../../scripts/setup/engine.js';
import { startRun } from '../../../scripts/setup/journal.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const STEPS = fileURLToPath(new URL('../../helpers/setup-session-steps.js', import.meta.url));
const NOW = new Date('2026-10-19T03:00:00.000Z');

// The command as a session runs it, its client the engine's own routes.
async function plan(step, { entrypoint, env = {}, routes, folder }) {
  const client = { setup: { plan: routes['/setup/plan'] } };
  let out = '';
  let err = '';
  const code = await main(['plan', String(step)], { client, cwd: folder, out: (t) => { out += t; }, err: (t) => { err += t; }, entrypoint, env });
  assert.equal(code, 0, err);
  return JSON.parse(out);
}

// The label of the option the card recommends.
const recommended = (planned) => planned.ask.card.options.find((o) => o.description.startsWith('Recommended')).label;

async function world(fn) {
  await withHome(async () => {
    const user = fs.realpathSync.native(tempFolder('wh-kind '));
    const folder = path.join(user, 'Projects', 'shop');
    fs.mkdirSync(folder, { recursive: true });
    startRun({ folder, now: () => NOW });
    await fn({ folder, routes: setupRoutes({ now: () => NOW, stepsModule: STEPS, userHome: user, platform: 'darwin' }) });
  });
}

test('a terminal session reaches step 3 with the typed-path backup card, and step 9 with Skip recommended', async () => {
  await world(async ({ folder, routes }) => {
    const three = await plan(3, { entrypoint: 'cli', routes, folder });
    assert.match(three.ask.card.options[0].description, /Type the full path/);
    const nine = await plan(9, { entrypoint: 'cli', routes, folder });
    assert.match(recommended(nine), /^Skip/);
  });
});

test('a terminal started inside a Desktop session (the app\'s value inherited) is still a terminal', async () => {
  assert.equal(inDesktopApp('claude-desktop', {}), true);
  assert.equal(inDesktopApp('claude-desktop', { TMUX: '/tmp/tmux-501/default,1,0' }), false);
  await world(async ({ folder, routes }) => {
    const env = { TMUX: '/tmp/tmux-501/default,1,0' };
    const three = await plan(3, { entrypoint: 'claude-desktop', env, routes, folder });
    assert.match(three.ask.card.options[0].description, /Type the full path/);
    const nine = await plan(9, { entrypoint: 'claude-desktop', env, routes, folder });
    assert.match(recommended(nine), /^Skip/);
  });
});

test('the Desktop app gets the window card and Ready', async () => {
  await world(async ({ folder, routes }) => {
    const three = await plan(3, { entrypoint: 'claude-desktop', routes, folder });
    assert.match(three.ask.card.options[0].description, /window that opens/);
    const nine = await plan(9, { entrypoint: 'claude-desktop', routes, folder });
    assert.match(recommended(nine), /^Ready/);
  });
});
