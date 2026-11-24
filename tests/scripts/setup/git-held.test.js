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
// `helpers` are values of credential.helper; `settings` are [key, value] pairs, as `git config --null --get-regexp` lists them.
function seam({ helpers = [], settings = helpers.map((value) => ['credential.helper', value]), programs = {} } = {}) {
  const calls = [];
  const ask = async (args) => {
    calls.push(['git', ...args]);
    return settings.length === 0 ? { code: 1, stdout: '' } : { code: 0, stdout: settings.map(([key, value]) => `${key}\n${value}\0`).join('') };
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

test('the hosts this computer holds a sign-in for are read by name alone, and the public hosts are left out', async () => {
  const { signedInHosts } = await import('../../../scripts/setup/git-held.js');
  assert.deepEqual(await signedInHosts({}), [], 'no home named, nothing read');
  const home = tempFolder('wh-signed-');
  fs.mkdirSync(path.join(home, '.config', 'glab-cli'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'glab-cli', 'config.yml'), 'git_protocol: https\nhosts:\n  git.acme.example:\n    token: secret-value\n    api_host: git.acme.example\n  gitlab.com:\n    token: other\n');
  fs.writeFileSync(path.join(home, '.git-credentials'), 'https://ann:pw@code.other.example\nhttps://ann:pw@github.com\n');
  const got = await signedInHosts({ home, platform: 'linux', env: {} });
  assert.deepEqual(got, ['git.acme.example', 'code.other.example']);
  assert.ok(!JSON.stringify(got).includes('secret-value') && !JSON.stringify(got).includes('pw'), 'never a key');
  const win = await signedInHosts({ home: tempFolder('wh-signed-'), platform: 'win32', env: {}, run: async () => ({ code: 0, stdout: 'Target: LegacyGeneric:target=git:https://git.win.example\nTarget: git:https://bitbucket.org\n' }) });
  assert.deepEqual(win, ['git.win.example']);
});

test('the which-GitLab and address cards offer a host this computer holds a sign-in for by name, recommend none, and say where to type', async () => {
  const { gitlabWhere, COMPANY_GITLAB } = await import('../../../scripts/setup/host.js');
  const where = gitlabWhere({ answer: () => null, name: 'Cafe-Menu', others: [], signedIn: () => ['git.acme.example'] });
  assert.deepEqual(where.ask.card.options.map((o) => o.label).slice(0, 1), ['git.acme.example']);
  assert.equal(where.ask.card.recommend, null);
  const chose = (id) => (id === 'gitlab-where' ? { label: COMPANY_GITLAB, text: null } : null);
  const address = gitlabWhere({ answer: chose, name: 'Cafe-Menu', others: [], signedIn: () => ['git.acme.example'] }).ask.card;
  assert.equal(address.options[0].label, 'git.acme.example');
  assert.match(address.what, /type it in the box under the options \(marked Other, or Type something\)/);
  const picked = gitlabWhere({ answer: (id) => (id === 'gitlab-where' ? { label: 'git.acme.example', text: null } : null), name: 'Cafe-Menu', others: [], signedIn: () => ['git.acme.example'] });
  assert.equal(picked.host, 'git.acme.example');
});

test('every helper git is given counts, not only the last: a keychain entry is found behind a store without the host', async () => {
  const home = tempFolder('wh-held-');
  const file = path.join(home, 'creds');
  fs.writeFileSync(file, 'https://ann:pw@github.com\n');
  const keychain = { security: async () => ({ code: 0, stdout: '' }) };
  const both = await look({ helpers: ['osxkeychain', `store --file ${file}`], programs: keychain }, { platform: 'darwin', home });
  assert.equal(both.said, 'held');
  assert.deepEqual(both.calls[0], ['git', 'config', '--null', '--get-regexp', '^credential\\..*helper$']);
  // An empty value clears the helpers before it.
  const cleared = await look({ helpers: ['osxkeychain', '', `store --file ${file}`], programs: keychain }, { platform: 'darwin', home });
  assert.equal(cleared.said, 'none');
});

test('a helper set for this address counts, one for another host does not, and one this cannot match leaves it unknown', async () => {
  const keychain = { security: async () => ({ code: 0, stdout: '' }) };
  const here = await look({ settings: [['credential.helper', ''], ['credential.https://gitlab.example.com.helper', 'osxkeychain']], programs: keychain }, { platform: 'darwin' });
  assert.equal(here.said, 'held');
  const other = await look({ settings: [['credential.https://git.other.example.helper', 'osxkeychain']], programs: keychain }, { platform: 'darwin' });
  assert.equal(other.said, 'none');
  const wild = await look({ settings: [['credential.https://*.example.com.helper', 'osxkeychain']], programs: keychain }, { platform: 'darwin' });
  assert.equal(wild.said, 'unknown');
});

test('.netrc is read for machine names alone, whatever the helpers, and a password is never taken for a name', async () => {
  const home = tempFolder('wh-held-');
  fs.writeFileSync(path.join(home, '.netrc'), 'machine other.example login ann password machine\n');
  assert.equal((await look({ helpers: [] }, { home })).said, 'none');
  fs.writeFileSync(path.join(home, '.netrc'), 'machine gitlab.example.com login ann password x\n');
  assert.equal((await look({ helpers: ['cache'] }, { home })).said, 'held');
  fs.writeFileSync(path.join(home, '.netrc'), 'default login ann password x\n');
  assert.equal((await look({ helpers: [] }, { home })).said, 'held');
});

test('a store line naming the host only in its password is not counted, and the keychain and Credential Manager are given a time limit', async () => {
  const home = tempFolder('wh-held-');
  const file = path.join(home, 'creds');
  fs.writeFileSync(file, 'https://ann:gitlab.example.com@github.com\n');
  assert.equal((await look({ helpers: [`store --file ${file}`] }, { home })).said, 'none');
  const options = [];
  const run = async (file2, args, given) => {
    options.push(given);
    return { code: 44, stdout: '' };
  };
  const { ask } = seam({ helpers: ['osxkeychain'] });
  await gitHoldsKey({ address: ADDRESS, ask, run, platform: 'darwin', home });
  assert.ok(options[0]?.timeoutMs > 0);
});
