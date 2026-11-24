// tests/scripts/setup/git-held.test.js
// The look at whether git holds a sign-in for a host stays on this computer: settings and entry names only, never `git credential`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gitHoldsKey } from '../../../scripts/setup/git-held.js';
import { connectionCard } from '../../../scripts/setup/host.js';
import { tempFolder } from '../../helpers/homes.js';

const ADDRESS = 'https://gitlab.example.com';
// A git that names these helpers for the address, and programs that answer as given; every call is kept.
function seam({ helpers = [], programs = {} } = {}) {
  const calls = [];
  const ask = async (args) => {
    calls.push(['git', ...args]);
    return helpers.length === 0 ? { code: 1, stdout: '' } : { code: 0, stdout: `${helpers.join('\n')}\n` };
  };
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const made = programs[file];
    if (made === undefined) throw new Error('not here');
    return made(args);
  };
  return { ask, run, calls };
}
const look = (options, extra = {}) => {
  const { ask, run, calls } = seam(options);
  return gitHoldsKey({ address: ADDRESS, ask, run, home: tempFolder('wh-held-'), ...extra }).then((said) => ({ said, calls }));
};

test('with no helper and no .netrc entry, git holds nothing; a .netrc entry for the host counts as held', async () => {
  assert.equal((await look()).said, 'none');
  const home = tempFolder('wh-held-');
  fs.writeFileSync(path.join(home, '.netrc'), 'machine gitlab.example.com login ann password x\n');
  const { ask, run } = seam();
  assert.equal(await gitHoldsKey({ address: ADDRESS, ask, run, home }), 'held');
});

test('Windows\' Credential Manager is read by entry names alone', async () => {
  const entries = (text) => ({ cmdkey: async () => ({ code: 0, stdout: text }) });
  const held = await look({ helpers: ['manager'], programs: entries('Target: LegacyGeneric:target=git:https://gitlab.example.com\nType: Generic\n') }, { platform: 'win32' });
  assert.equal(held.said, 'held');
  assert.deepEqual(held.calls.at(-1), ['cmdkey', '/list']);
  assert.equal((await look({ helpers: ['manager'], programs: entries('Target: git:https://github.com\n') }, { platform: 'win32' })).said, 'none');
  assert.equal((await look({ helpers: ['manager'], programs: entries('Target: git:https://gitlab.example.com.evil.test\n') }, { platform: 'win32' })).said, 'none');
});

test('the Mac\'s keychain is asked for attributes only: no secret is requested', async () => {
  const keychain = (code) => ({ security: async () => ({ code, stdout: '' }) });
  const held = await look({ helpers: ['osxkeychain'], programs: keychain(0) }, { platform: 'darwin' });
  assert.equal(held.said, 'held');
  assert.deepEqual(held.calls.at(-1), ['security', 'find-internet-password', '-s', 'gitlab.example.com']);
  assert.equal((await look({ helpers: ['osxkeychain'], programs: keychain(44) }, { platform: 'darwin' })).said, 'none');
  assert.equal((await look({ helpers: ['osxkeychain'], programs: keychain(1) }, { platform: 'darwin' })).said, 'unknown');
});

test('git\'s store file is searched for the host and not kept', async () => {
  const home = tempFolder('wh-held-');
  const file = path.join(home, 'creds');
  fs.writeFileSync(file, 'https://ann:pw@gitlab.example.com\n');
  const { ask, run } = seam({ helpers: [`store --file ${file}`] });
  assert.equal(await gitHoldsKey({ address: ADDRESS, ask, run, home }), 'held');
  fs.writeFileSync(file, 'https://ann:pw@github.com\n');
  assert.equal(await gitHoldsKey({ address: ADDRESS, ask, run, home }), 'none');
});

test('a helper this does not know, or a program that is not there, gives unknown, and nothing runs `git credential`', async () => {
  const cache = await look({ helpers: ['cache --timeout 3600'] });
  assert.equal(cache.said, 'unknown');
  const missing = await look({ helpers: ['manager'] }, { platform: 'win32' });
  assert.equal(missing.said, 'unknown');
  const none = await look({ helpers: ['manager', 'cache'], programs: { cmdkey: async () => ({ code: 0, stdout: '' }) } }, { platform: 'win32' });
  assert.equal(none.said, 'unknown', 'one helper unseen into leaves it unknown');
  for (const { calls } of [cache, missing, none]) assert.ok(calls.every((c) => !c.includes('credential') || c[1] === 'config'), 'no credential call');
});

test('where the look cannot tell, "Use my git as it is" claims nothing either way and is not recommended', () => {
  const card = connectionCard({ host: 'gitlab', platform: 'win32', asIs: true, held: null, toolOut: true });
  const own = card.options.find((o) => o.label === 'Use my git as it is');
  assert.match(own.says, /If git holds no GitLab key, you make one on a page that opens/);
  assert.doesNotMatch(own.says, /holds no GitLab key yet|already uses/);
  assert.notEqual(card.recommend, 'Use my git as it is');
  assert.equal(connectionCard({ host: 'gitlab', platform: 'win32', asIs: true, held: true, toolOut: true }).recommend, 'Use my git as it is');
});
