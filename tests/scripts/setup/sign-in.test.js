// tests/scripts/setup/sign-in.test.js
// `cli.js sign-in`: git's own sign-in for the host a step 3 attempt on the "Use my git as it is" route could not reach. The address
// comes from setup's own record; git runs in a folder of its own with the director's own settings looked at first, and may open
// its sign-in window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { signIn, recordedAddress, NO_SIGN_IN_ADDRESS, signedInLine, SIGN_IN_WAIT_MS } from '../../../scripts/setup/sign-in.js';
import { SIGN_IN_TARGET, asIsSettingLine } from '../../../scripts/setup/host.js';
import { startRun, addChanges, newId } from '../../../scripts/setup/journal.js';
import { main } from '../../../scripts/setup/cli.js';
import { as, shortHome, tempFolder } from '../../helpers/homes.js';

const URL_ = 'https://gitlab.com/owner/shop.git';
const FOLDER = '/x/Projects/shop';

// A run for a folder holding a recorded sign-in address (or none).
const withRecord = async (address, fn) => as(shortHome(), async () => {
  const folder = tempFolder('wh-signin-');
  const run = startRun({ folder });
  if (address !== undefined) addChanges(run.id, [{ id: newId('chg'), step: 3, kind: 'answer', target: SIGN_IN_TARGET, before: null, after: { signIn: { address } } }]);
  return fn(folder);
});

// A stand-in git: the guard's reads answer as a clean computer's, and each ls-remote is kept.
const fakeGit = ({ list = 'global\0user.name\nx\0', rewrite = null, listing = { code: 0, stdout: '', stderr: '' } } = {}) => {
  const calls = [];
  const run = async (file, args, options = {}) => {
    calls.push({ args, ...options });
    if (args.includes('--list')) return { code: 0, stdout: list, stderr: '' };
    if (args.includes('--get-urlmatch')) return { code: 1, stdout: '', stderr: '' };
    if (args.includes('--get-url')) return { code: 0, stdout: `${rewrite ?? args.at(-1)}\n`, stderr: '' };
    if (args.includes('--get-regexp')) return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'ls-remote') return listing;
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls, findGit: async () => ({ ok: true, path: 'git' }) };
};

test('with no address recorded, or one that is not a plain https address, it refuses and runs nothing', async () => {
  for (const address of [undefined, 'ssh://git@gitlab.com/o/s.git', 'https://user:pw@gitlab.com/o/s.git', 'http://gitlab.com/o/s.git', 'https://gitlab.com/o/s.git?x=1', 'not a url', 7]) {
    await withRecord(address, async (folder) => {
      const g = fakeGit();
      await assert.rejects(signIn({ folder, ...g, env: {} }), (e) => e.message === NO_SIGN_IN_ADDRESS, String(address));
      assert.equal(g.calls.length, 0);
    });
  }
  assert.equal(recordedAddress('/nowhere'), null);
});

test('it lists the recorded address\'s branches with the director\'s own git, from a folder of its own, with git\'s window allowed and a long wait', async () => {
  await withRecord(URL_, async (folder) => {
    const g = fakeGit();
    const line = await signIn({ folder, ...g, env: { PATH: process.env.PATH, GIT_SSL_NO_VERIFY: '1', GIT_SSL_CAINFO: '/evil', GIT_PROXY_SSL_CERT: 'x' } });
    assert.equal(line, signedInLine('gitlab.com'));
    const listed = g.calls.find((c) => c.args[0] === 'ls-remote' && !c.args.includes('--get-url'));
    assert.deepEqual(listed.args, ['ls-remote', '--heads', '--end-of-options', URL_]);
    assert.notEqual(listed.cwd, folder, 'not the project\'s folder');
    assert.ok(!fs.existsSync(listed.cwd), 'its own folder is removed after');
    assert.equal(listed.env.GIT_TERMINAL_PROMPT, '1');
    assert.equal(listed.env.GCM_INTERACTIVE, 'auto');
    assert.ok(listed.timeoutMs >= 5 * 60 * 1000 && listed.timeoutMs === SIGN_IN_WAIT_MS);
    for (const name of ['GIT_SSL_NO_VERIFY', 'GIT_SSL_CAINFO', 'GIT_PROXY_SSL_CERT']) assert.equal(listed.env[name], undefined, name);
    assert.equal(listed.env.GIT_CONFIG_GLOBAL, undefined, 'the director\'s own settings are read');
    assert.equal(listed.env.GIT_ALLOW_PROTOCOL, 'https');
    // The guard's look at the settings came first, for the same address.
    const guarded = g.calls.findIndex((c) => c.args.includes('--get-url'));
    assert.ok(guarded >= 0 && guarded < g.calls.indexOf(listed));
  });
});

test('git\'s refusal is said with what git said, a setting that is unsafe is refused before any contact, and nothing here asks for a token', async () => {
  await withRecord(URL_, async (folder) => {
    const refused = fakeGit({ listing: { code: 128, stdout: '', stderr: 'fatal: Authentication failed for \'https://oauth2:glpat-abcdefgh1234@gitlab.com/owner/shop.git/\'\n' } });
    await assert.rejects(signIn({ folder, ...refused, env: {} }), (e) => {
      assert.match(e.message, /^Git could not reach gitlab\.com after its sign-in was opened \(git said: fatal: Authentication failed for 'https:\/\/\[hidden\]@gitlab\.com\/owner\/shop\.git\/'\); /);
      assert.ok(!/glpat/.test(e.message));
      assert.ok(!/make a token|create a token|personal access token/i.test(e.message));
      return true;
    });
    const rewritten = fakeGit({ rewrite: 'ssh://git@gitlab.com/owner/shop.git' });
    await assert.rejects(signIn({ folder, ...rewritten, env: {} }), (e) => e.message === asIsSettingLine('it points this project\'s address somewhere else, for example to SSH'));
    assert.ok(!rewritten.calls.some((c) => c.args[0] === 'ls-remote' && !c.args.includes('--get-url')), 'no contact with the host');
  });
});

test('a GitHub address is run for GitHub, and a company GitLab address for that GitLab', async () => {
  for (const address of ['https://github.com/o/s.git', 'https://git.example.org/g/s.git']) {
    await withRecord(address, async (folder) => {
      const g = fakeGit();
      assert.equal(await signIn({ folder, ...g, env: {} }), signedInLine(new URL(address).hostname));
      assert.equal(g.calls.find((c) => c.args[0] === 'ls-remote' && c.args.includes('--heads')).args.at(-1), address);
    });
  }
});

test('the form: `sign-in` prints the one line, and a refusal is one line on standard error', async () => {
  let out = '';
  let err = '';
  const given = [];
  const base = { cwd: FOLDER, out: (t) => { out += t; }, err: (t) => { err += t; }, entrypoint: 'cli', env: {} };
  assert.equal(await main(['sign-in'], { ...base, signIn: async (o) => { given.push(o); return 'Signed in: ok.'; } }), 0);
  assert.equal(out, 'Signed in: ok.\n');
  assert.deepEqual(given, [{ folder: FOLDER }]);
  assert.equal(await main(['sign-in'], { ...base, signIn: async () => { throw new Error('Git could not reach x.\nsecond line'); } }), 1);
  assert.equal(err, 'Git could not reach x. second line\n');
  // The form takes nothing after it: an address is never given by the session.
  err = '';
  assert.equal(await main(['sign-in', 'https://evil.example/x.git'], { ...base, signIn: async () => 'no' }), 1);
  assert.match(err, /^Commands: /);
});
