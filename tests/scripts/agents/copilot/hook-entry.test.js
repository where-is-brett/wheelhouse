// tests/scripts/agents/copilot/hook-entry.test.js
// The Copilot stop word through the hook entry, pinned against a real helper on a temporary home (archon part 1,
// Task 9): moving it onto the desk changes nothing Copilot is told. Each case is the entry's line and exit code,
// compared with tests/fixtures/desk-parity/copilot/hook-entry.json, and STOP as the word left it.
// DESK_PARITY_WRITE=1 writes the fixture again from today's output.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { guardedRun, standInTools } from '../../../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../../helpers/until.js';
import { run, withoutGitVars } from '../../../../scripts/lib/run.js';
import { NULL_FILE } from '../../../../scripts/lib/safe-git.js';
import { startHelper } from '../../../../scripts/host/helper.js';
import { helperClient } from '../../../../scripts/host/helper-client.js';
import { makeSigningKey, enrol } from '../../../../scripts/state/signing.js';
import { stopState, liftStop } from '../../../../scripts/lib/stop.js';
import { registerLean, updateLean } from '../../../../scripts/lean/project.js';
import { adoptProject } from '../../../../scripts/lean/store.js';
import { runEntry } from '../../../../scripts/agents/copilot/hook-entry.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'desk-parity', 'copilot', 'hook-entry.json');
const COPILOT_ENV = { COPILOT_CLI_BINARY_VERSION: '1.0.101' };

const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const PROJECT = 'shop';
const T0 = Date.parse('2026-10-29T01:00:00.000Z');
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: NULL_FILE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: NULL_FILE,
  GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com',
};
async function git(cwd, args) {
  const got = await run('git', args, { cwd, baseEnv: withoutGitVars(), env: GIT_ENV });
  if (got.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${got.stderr}`);
  return got.stdout.trim();
}

// A Lean project on Copilot, adopted into its store, and a real helper on the home's own address.
async function computer() {
  const home = shortHome();
  const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(shortHome(), 'shop-')));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  await git(folder, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(folder, 'README.md'), 'shop\n');
  await git(folder, ['add', '-A']);
  await git(folder, ['commit', '-q', '-m', 'Start']);
  registerLean({ project: PROJECT, folder, now: () => new Date(T0) });
  updateLean(PROJECT, { agent: 'copilot' });
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: new Date(T0).toISOString() });
  let tick = 0;
  const now = () => new Date(T0 + 1000 * (tick += 1));
  await adoptProject({ project: PROJECT, folder, run: hostGuard, now });
  const helper = await startHelper({
    run: hostGuard,
    address: testAddress(home),
    envFor: async () => { throw new Error('no connection on this computer'); },
    adapterFor: async () => { throw new Error('no adapter on this computer'); },
    askWindow: async () => ({ choice: null }),
    now,
  });
  return {
    folder,
    client: helperClient({ address: helper.address }),
    // A client whose helper isn't there.
    away: helperClient({ address: testAddress(shortHome()) }),
    close: async () => {
      liftStop();
      await helper.close();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
    },
  };
}

// The entry on a typed prompt, with the board context set aside so only the stop word answers.
const prompt = (c, text, client) => runEntry('userPromptSubmitted', {
  stdin: Readable.from([JSON.stringify({ sessionId: 's1', timestamp: 0, cwd: c.folder, prompt: text })]),
  env: COPILOT_ENV,
  deps: { client, steps: { boardContext: async () => undefined } },
});

const pinned = {};

test('the stop word sets All stop through the helper, as the director\'s, and says so as it did', async () => {
  const c = await computer();
  try {
    pinned['not-the-word'] = await prompt(c, 'carry on', c.client);
    assert.equal(stopState().on, false);
    pinned['helper-away'] = await prompt(c, 'stop', c.away);
    assert.equal(stopState().on, false);
    // Set through the desk, as the director's all-stop, not the helper's own /stop/set.
    const asked = [];
    const watched = {
      ...c.client,
      stop: (body) => { asked.push('stop'); return c.client.stop(body); },
      desk: { ...c.client.desk, act: (body) => { asked.push(`desk ${body.command} ${body.args?.by}`); return c.client.desk.act(body); } },
    };
    pinned['stop-word'] = await prompt(c, 'stop', watched);
    assert.deepEqual(asked, ['desk all-stop prompt']);
    const state = stopState();
    assert.deepEqual([state.on, state.by], [true, 'prompt']);
    pinned['stop-word-again'] = await prompt(c, 'all stop', c.client);
    assert.equal(stopState().on, true);
  } finally {
    await c.close();
  }
});

test('every case matches the pinned output', () => {
  if (process.env.DESK_PARITY_WRITE === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, `${JSON.stringify(pinned, null, 2)}\n`);
  }
  assert.deepEqual(pinned, JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
});
