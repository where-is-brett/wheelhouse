// tests/scripts/update/bootstrap.test.js
// The bootstrap from v0.2.6 (update design, section 13): checks, the typed answer, install, the hand-over, then the project's
// change, with the computer put back when the change is refused or closed. Real git for the clone and the project; every other
// outside thing is a stand-in. Nothing touches the real Wheelhouse home or installs anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { bootstrap, IN_SESSION, NO_TERMINAL, terminalAsk } from '../../../scripts/update/bootstrap.js';
import { main } from '../../../scripts/update/cli.js';
import { openJournal, updateLockHeld } from '../../../scripts/update/journal.js';
import { rootIsCacheFor } from '../../../scripts/update/finish.js';
import { g } from '../../helpers/git-fixture.js';
import { withHome, tempFolder } from '../../helpers/homes.js';

const OLD = { extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v0.2.6' } } } };
const named = (ref) => `${JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref } } } }, null, 2)}\n`;

async function repo(files) {
  const dir = tempFolder('wh-bs-');
  await g(dir, 'init', '-q', '-b', 'main');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

const shaOf = async (dir) => g(dir, 'rev-parse', 'HEAD');

// The world: a project, a clone of the tag, a cache folder with finish.js, and stand-ins that log what they do.
async function world(over = {}) {
  const dir = await repo({ '.claude/settings.json': `${JSON.stringify(OLD, null, 2)}\n` });
  const clone = await repo({ '.claude-plugin/plugin.json': '{"version":"0.2.7"}\n' });
  const sha = await shaOf(clone);
  const claudeHome = tempFolder('wh-claude-');
  const cache = path.join(claudeHome, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', '0.2.7');
  fs.mkdirSync(path.join(cache, 'scripts', 'update'), { recursive: true });
  fs.writeFileSync(path.join(cache, 'scripts', 'update', 'finish.js'), '// stand-in\n');
  const log = [];
  const seen = {};
  const state = { pr: 'merged', checkOk: true, installOk: true, finishOk: true, open: { ok: true, result: { number: 7 } }, ...over };
  const client = {
    push: async (b) => { log.push(['push', b.refspec]); return { ok: true }; },
    // A change that merges at once reaches the project's folder as soon as it is opened.
    openReleasePr: async (b) => {
      log.push(['open', b.head]);
      if (state.pr === 'merged' && state.open.ok) fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), named('v0.2.7'));
      return state.open;
    },
    prState: async () => ({ ok: true, state: state.pr }),
    state: { views: async () => ({ ok: true, views: { features: {} } }) },
  };
  const steps = {
    fetch: async () => { log.push(['fetch']); return state.checkOk ? { ok: true, sha } : { ok: false }; },
    check: async () => ({ ok: state.checkOk, says: 'It adds the update command.' }),
    install: async () => {
      log.push(['install']);
      seen.lockDuringInstall = updateLockHeld();
      return state.installOk ? { ok: true, line: 'Installed.' } : { ok: false, line: 'Install failed.' };
    },
    finishRun: async ({ script }) => {
      log.push(['finish']);
      seen.script = script;
      seen.lockDuringFinish = updateLockHeld();
      seen.finishStep = openJournal('p1').read().steps.finish?.state;
      seen.cacheOk = rootIsCacheFor({ newRoot: path.dirname(path.dirname(path.dirname(script))), claudeHome, tag: 'v0.2.7' });
      return { code: 0, stdout: `${JSON.stringify({ ok: state.finishOk, line: 'Handed over.' })}\n` };
    },
    raise: async () => { log.push(['raise']); },
    stopped: () => false,
    features: async () => ({}),
  };
  const putBackRun = async (args) => { log.push(['putBack']); seen.putBackArgs = args; return { ok: true, line: 'This computer was put back to v0.2.6.' }; };
  const said = [];
  const typed = [...(over.typed ?? ['1'])];
  const asked = [];
  const ask = async (prompt) => { asked.push(prompt); return typed.length > 0 ? typed.shift() : null; };
  const call = () => bootstrap({
    projectDir: dir, project: 'p1', root: clone, ask, say: (t) => said.push(t), client, claudeHome, mirror: tempFolder('wh-mirror-'), from: 'v0.2.6', steps, putBackRun, env: {},
  });
  return { call, log, seen, said, asked, dir, claudeHome };
}

const quiet = (log) => log.map((l) => l[0]).filter((n) => n !== 'fetch');

test('bootstrap: checks, then the typed 1, then install, finish and the change, in that order', () => withHome(async () => {
  const w = await world();
  const out = await w.call();
  assert.equal(out.ok, true);
  assert.deepEqual(quiet(w.log), ['install', 'finish', 'push', 'open', 'raise']);
  assert.ok(w.said.some((l) => /v0\.2\.6 → v0\.2\.7/.test(l)));
  assert.equal(openJournal('p1').read().steps.done.state, 'done');
  assert.equal(updateLockHeld(), false, 'the lock is let go at the end');
}));

test('bootstrap: finish runs through the job, under the live lock, from the cache folder of the tag', () => withHome(async () => {
  const w = await world();
  await w.call();
  assert.equal(w.seen.lockDuringInstall, true);
  assert.equal(w.seen.lockDuringFinish, true);
  assert.equal(w.seen.finishStep, 'running');
  assert.equal(w.seen.cacheOk, true);
  assert.equal(w.seen.script, path.join(w.claudeHome, 'plugins', 'cache', 'wheelhouse', 'wheelhouse', '0.2.7', 'scripts', 'update', 'finish.js'));
}));

test('bootstrap: a typed answer other than 1 or 2 asks again', () => withHome(async () => {
  const w = await world({ typed: ['yes', '', '3', '1'] });
  const out = await w.call();
  assert.equal(out.ok, true);
  assert.equal(w.asked.length, 4);
  assert.equal(w.said.filter((l) => l === 'Please type 1 or 2.').length, 3);
}));

test('bootstrap: 2 changes nothing; so does an input that ends, or answers that never come right', () => withHome(async () => {
  for (const typed of [['2'], [], ['x', 'x', 'x', 'x', 'x', '1']]) {
    const w = await world({ typed });
    const out = await w.call();
    assert.equal(out.ok, false);
    assert.deepEqual(quiet(w.log), []);
  }
}));

test('bootstrap: nothing is asked or installed before the tag checks out', () => withHome(async () => {
  const w = await world({ checkOk: false });
  const out = await w.call();
  assert.equal(out.ok, false);
  assert.match(out.line, /doesn't check out/);
  assert.deepEqual(w.log.map((l) => l[0]), ['fetch']);
  assert.equal(w.asked.length, 0);
}));

test('bootstrap: a failed install stops there; no change is opened', () => withHome(async () => {
  const w = await world({ installOk: false });
  const out = await w.call();
  assert.equal(out.ok, false);
  assert.equal(out.line, 'Install failed.');
  assert.deepEqual(quiet(w.log), ['install']);
}));

test('bootstrap: a refused change puts the computer back', () => withHome(async () => {
  const w = await world({ open: { ok: false, refused: 'Not allowed.' } });
  const out = await w.call();
  assert.equal(out.ok, false);
  assert.match(out.line, /could not be opened: Not allowed\./);
  assert.match(out.line, /put back to v0\.2\.6/);
  assert.ok(w.log.some((l) => l[0] === 'putBack'));
  assert.equal(w.seen.putBackArgs.journal.folder, openJournal('p1').folder);
}));

test('bootstrap: a closed change after the install puts the computer back', () => withHome(async () => {
  const w = await world({ pr: 'closed' });
  const out = await w.call();
  assert.equal(out.ok, false);
  assert.match(out.line, /closed without being merged/);
  assert.deepEqual(quiet(w.log).filter((n) => n !== 'raise'), ['install', 'finish', 'push', 'open', 'putBack']);
}));

test('bootstrap: a change still open is left waiting, with the board\'s words, and nothing is put back', () => withHome(async () => {
  const w = await world({ pr: 'open' });
  const out = await w.call();
  assert.equal(out.ok, true);
  assert.equal(out.waiting, true);
  assert.match(out.line, /This computer has v0\.2\.7; the change naming it for your project is waiting to be merged/);
  assert.ok(!w.log.some((l) => l[0] === 'putBack'));
  assert.equal(openJournal('p1').read().steps.merged.state, 'running');
  assert.equal(updateLockHeld(), false);
}));

test('bootstrap: a folder that is not a project, or no way to ask, changes nothing', () => withHome(async () => {
  const w = await world();
  const none = await bootstrap({ projectDir: w.dir, root: w.dir, ask: null, env: {} });
  assert.equal(none.line, NO_TERMINAL);
  const stranger = await bootstrap({ projectDir: tempFolder('wh-none-'), ask: async () => '1', env: {} });
  assert.match(stranger.line, /not a Wheelhouse project/);
}));

test('cli bootstrap: refuses when standard input is not a terminal, so an agent cannot pipe the answer in', async () => {
  const errors = [];
  const piped = Readable.from(['1\n']);
  const code = await main(['bootstrap', '/some/project'], { stdin: piped, err: (t) => errors.push(t), out: () => {}, client: {} });
  assert.equal(code, 1);
  assert.equal(errors.join(''), `${NO_TERMINAL}\n`);
  assert.equal(terminalAsk({ stdin: piped }), null);
});

test('cli bootstrap: takes exactly one folder', async () => {
  const errors = [];
  assert.equal(await main(['bootstrap'], { err: (t) => errors.push(t), out: () => {}, client: {} }), 1);
  assert.match(errors.join(''), /bootstrap <project folder>/);
});

test('bootstrap: refuses inside a Claude Code or Wheelhouse session, before anything is read or changed', () => withHome(async () => {
  for (const name of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_PROJECT_DIR']) {
    let asked = false;
    const out = await bootstrap({ projectDir: '/x', ask: async () => { asked = true; return '1'; }, env: { [name]: 'x' } });
    assert.equal(out.line, IN_SESSION, name);
    assert.equal(asked, false);
  }
}));

test('bootstrap: the typed card names the account entry the update changes, and a foreign source stops it', () => withHome(async () => {
  const w = await world();
  fs.writeFileSync(path.join(w.claudeHome, 'settings.json'), JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 'v0.2.6' } } } }));
  const out = await w.call();
  assert.equal(out.ok, true, out.line);
  assert.ok(w.said.includes('Your account settings name Wheelhouse at v0.2.6; the update changes that one entry to v0.2.7.'));
  const odd = await world();
  fs.writeFileSync(path.join(odd.claudeHome, 'settings.json'), JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'someone/else', ref: 'v0.2.6' } } } }));
  const stopped = await odd.call();
  assert.equal(stopped.ok, false);
  assert.match(stopped.line, /not the Wheelhouse repository/);
  assert.deepEqual(quiet(odd.log), []);
}));
