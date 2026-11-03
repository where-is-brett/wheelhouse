// tests/scripts/setup/host-access.test.js
// Step 3 finds how the director's computer already reaches the host (scripts/setup/host-access.js): the remote's
// transport, their credential helper, whether their git reaches the remote, whether the key their git holds passes
// GET /user, and the key card for a key that is missing, refused or can only push. No test asks the computer's own store,
// runs git against a real host or reaches a real network: the director's git, the store and curl are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transportOf, credentialHelperOf, lsRemoteWorks, checkApiKey, findAccess, backendFor, runKeyCard, keyCardLine, keyCardPlanLine,
  asIsReachLine, replacesLine, noRoadLine, hostAddress, NO_KEY_GIVEN,
} from '../../../scripts/setup/host-access.js';
import { makeRoutedCurl } from '../../helpers/fake-curl.js';

const GITLAB = 'https://gitlab.example.org';
const KEY = 'stand-in-DIRECTORKEY0001';
const NEW_KEY = 'stand-in-PASTEDKEY0002';

// The system's curl, answering GET /user from a table of what each key is; any other address is a 404.
function curlFor(keys) {
  return makeRoutedCurl(({ url, headers }) => {
    const auth = headers.find((h) => /^(?:authorization|private-token):/i.test(h)) ?? '';
    const key = auth.replace(/^[^:]+:\s*(?:Bearer\s+)?/i, '');
    if (!/\/user$/.test(url)) return { status: 404, body: {} };
    const known = keys[key];
    if (known === undefined) return { status: 401, body: { message: '401 Unauthorized' } };
    if (known === 'push-only') return { status: 403, body: { message: '403 Forbidden' } };
    if (known === 'down') return { exit: 7 };
    return { status: 200, body: { username: known, login: known } };
  });
}
const viaOf = (curl) => ({ run: curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'darwin' });

test('the transport of a remote: https, ssh in both forms, or neither for a path on this computer', () => {
  assert.equal(transportOf('https://gitlab.example.org/team/product.git'), 'https');
  assert.equal(transportOf('ssh://git@gitlab.example.org/team/product.git'), 'ssh');
  assert.equal(transportOf('git@gitlab.example.org:team/product.git'), 'ssh');
  assert.equal(transportOf('/Users/a-director/remotes/product.git'), null);
  assert.equal(transportOf(null), null);
});

test('the credential helper and a working ls-remote are read from the director\'s own git, asking nothing', async () => {
  const seen = [];
  const ask = async (args) => {
    seen.push(args);
    if (args[0] === 'config') return { code: 0, stdout: 'manager\n' };
    return { code: args[1].includes('good') ? 0 : 128, stdout: '' };
  };
  assert.equal(await credentialHelperOf({ address: GITLAB, ask }), 'manager');
  assert.deepEqual(seen[0], ['config', '--get-urlmatch', 'credential.helper', GITLAB]);
  assert.equal(await credentialHelperOf({ address: GITLAB, ask: async () => ({ code: 1, stdout: '' }) }), null);
  assert.equal(await lsRemoteWorks({ remoteUrl: 'https://gitlab.example.org/good.git', ask }), true);
  assert.equal(await lsRemoteWorks({ remoteUrl: 'https://gitlab.example.org/bad.git', ask }), false);
  assert.equal(await lsRemoteWorks({ remoteUrl: '/a/path', ask }), false, 'a path on this computer is not tried');
  assert.equal(await lsRemoteWorks({ remoteUrl: 'https://gitlab.example.org/x.git', ask: async () => { throw new Error('no git'); } }), false);
});

test('GET /user tells a key that works from one that can only push, one that is refused, and a host that is down', async () => {
  const curl = curlFor({ [KEY]: 'a-director', 'stand-in-PUSHONLY': 'push-only', 'stand-in-DOWN': 'down' });
  const via = viaOf(curl);
  assert.deepEqual(await checkApiKey({ host: 'gitlab', base: GITLAB, key: KEY, via }), { state: 'works', user: 'a-director' });
  assert.deepEqual(await checkApiKey({ host: 'gitlab', base: GITLAB, key: 'stand-in-PUSHONLY', via }), { state: 'push-only', status: 403 });
  assert.deepEqual(await checkApiKey({ host: 'gitlab', base: GITLAB, key: 'stand-in-WRONG', via }), { state: 'refused', status: 401 });
  const down = await checkApiKey({ host: 'gitlab', base: GITLAB, key: 'stand-in-DOWN', via });
  assert.equal(down.state, 'unreachable');
  assert.equal(down.code, 'HOST_UNREACHABLE');
  assert.equal(curl.calls[0].url, `${GITLAB}/api/v4/user`);
  // GitHub: the same call on api.github.com, with the key as a bearer key.
  const github = await checkApiKey({ host: 'github', key: KEY, via });
  assert.deepEqual(github, { state: 'works', user: 'a-director' });
  assert.equal(curl.calls.at(-1).url, 'https://api.github.com/user');
  assert.ok(curl.calls.at(-1).headers.includes(`Authorization: Bearer ${KEY}`));
});

test('step 3 finds the transport, the helper, ls-remote and the key without asking anything', async () => {
  const curl = curlFor({ [KEY]: 'a-director' });
  const borrowed = [];
  const run = async (file, args) => (args[0] === 'config' ? { code: 0, stdout: 'manager\n' } : { code: 0, stdout: 'abc\tHEAD\n' });
  const found = await findAccess({
    host: 'gitlab', base: GITLAB, repo: 'team/product', remoteUrl: `${GITLAB}/team/product.git`, run, gitPath: 'git',
    borrow: async (args) => { borrowed.push(args); return { username: 'oauth2', key: KEY }; }, via: viaOf(curl),
  });
  assert.deepEqual(found, { transport: 'https', helper: 'manager', gitReaches: true, key: 'works', user: 'a-director', username: 'oauth2' });
  assert.deepEqual(borrowed, [{ host: 'gitlab.example.org', base: GITLAB, repoPath: 'team/product' }]);
  assert.deepEqual(hostAddress('github'), 'https://github.com');
});

test('no key held by git reads as none; a key that only pushes as push-only; a refused one as refused', async () => {
  const run = async () => ({ code: 1, stdout: '' });
  const curl = curlFor({ 'stand-in-PUSHONLY': 'push-only' });
  const base = { host: 'gitlab', base: GITLAB, repo: null, remoteUrl: null, run, via: viaOf(curl) };
  assert.equal((await findAccess({ ...base, borrow: async () => null })).key, 'none');
  assert.equal((await findAccess({ ...base, borrow: async () => { throw new Error('no helper'); } })).key, 'none');
  assert.equal((await findAccess({ ...base, borrow: async () => ({ username: 'oauth2', key: 'stand-in-PUSHONLY' }) })).key, 'push-only');
  assert.equal((await findAccess({ ...base, borrow: async () => ({ username: 'oauth2', key: 'stand-in-OLD' }) })).key, 'refused');
  assert.equal((await findAccess({ ...base, borrow: async () => null })).gitReaches, null, 'no remote, so none is tried');
});

test('the backend is the tool when it starts and is signed in, otherwise the web API', () => {
  assert.equal(backendFor({ mode: 'as-is', tool: 'works', signedByTool: true }), 'cli');
  assert.equal(backendFor({ mode: 'as-is', tool: 'works', signedByTool: false }), 'rest');
  assert.equal(backendFor({ mode: 'as-is', tool: 'blocked', signedByTool: false }), 'rest');
  assert.equal(backendFor({ mode: 'as-is', tool: 'missing', signedByTool: false }), 'rest');
  // Quick and narrow sign the tool in themselves, so a tool that starts keeps them on it.
  assert.equal(backendFor({ mode: 'quick', tool: 'works', signedByTool: false }), 'cli');
  assert.equal(backendFor({ mode: 'narrow', tool: 'blocked', signedByTool: false }), 'rest');
});

// ---- The key card ----

function cardWorld({ typed = NEW_KEY, keys = { [NEW_KEY]: 'a-director' } } = {}) {
  const lines = [];
  const opened = [];
  const stored = [];
  const curl = curlFor(keys);
  const args = {
    host: 'gitlab', base: GITLAB, owner: 'team', name: 'product', state: 'none', say: (line) => lines.push(line), open: async (url) => { opened.push(url); },
    askSecret: async () => typed, platform: 'darwin', store: async (entry) => { stored.push(entry); }, via: viaOf(curl),
  };
  return { args, lines, opened, stored, curl };
}

test('the key card opens the host\'s page filled in, takes the key from the box, checks it and stores it with the director\'s own user name', async () => {
  const w = cardWorld();
  const got = await runKeyCard({ ...w.args, state: 'push-only', existing: 'oauth2' });
  assert.deepEqual(got, { user: 'a-director', username: 'oauth2' });
  const page = new URL(w.opened[0]);
  assert.equal(page.origin + page.pathname, `${GITLAB}/-/user_settings/personal_access_tokens`);
  assert.equal(page.searchParams.get('scopes'), 'api,write_repository');
  // Checked with GET /user, then stored with the entry git already holds for the host replaced, nothing else.
  assert.equal(w.curl.calls[0].url, `${GITLAB}/api/v4/user`);
  assert.deepEqual(w.stored, [{ host: 'gitlab.example.org', username: 'oauth2', key: NEW_KEY }]);
  assert.ok(w.lines.includes(replacesLine('gitlab.example.org')), 'it says it replaces the one entry');
  assert.ok(w.lines.includes(asIsReachLine('gitlab')));
  assert.ok(w.lines.some((l) => /never into the chat/.test(l)));
  assert.ok(!w.lines.join('\n').includes(NEW_KEY), 'the key is never said');
});

test('a key with no entry yet is stored under the user name the host gives', async () => {
  const w = cardWorld();
  const got = await runKeyCard(w.args);
  assert.equal(got.username, 'a-director');
  assert.ok(!w.lines.includes(replacesLine('gitlab.example.org')), 'nothing is replaced when git held no key');
});

test('a key the host does not accept, or that cannot be checked, is not stored', async () => {
  const wrong = cardWorld({ typed: 'stand-in-WRONG' });
  await assert.rejects(runKeyCard(wrong.args), /did not accept the key/);
  assert.deepEqual(wrong.stored, []);
  const down = cardWorld({ typed: 'stand-in-DOWN', keys: { 'stand-in-DOWN': 'down' } });
  await assert.rejects(runKeyCard(down.args), /could not be reached to check the key/);
  assert.deepEqual(down.stored, []);
  for (const typed of ['', '   \n', null]) {
    const empty = cardWorld({ typed });
    await assert.rejects(runKeyCard(empty.args), new RegExp(NO_KEY_GIVEN('gitlab')));
    assert.deepEqual(empty.stored, []);
  }
  const closed = cardWorld();
  closed.args.askSecret = async () => { throw new Error('box closed'); };
  await assert.rejects(runKeyCard(closed.args), new RegExp(NO_KEY_GIVEN('gitlab')));
});

test('on GitHub the key card opens the fine-grained page for the repository, or for all repositories while the project is new', async () => {
  const w = cardWorld();
  await runKeyCard({ ...w.args, host: 'github', owner: 'a-director', name: 'shop' });
  const page = new URL(w.opened[0]);
  assert.equal(page.pathname, '/settings/personal-access-tokens/new');
  assert.equal(page.searchParams.get('target_name'), 'a-director');
  assert.ok(w.lines.some((l) => /Only select repositories.*shop/.test(l)));
  assert.equal(w.curl.calls[0].url, 'https://api.github.com/user');
  const fresh = cardWorld();
  await runKeyCard({ ...fresh.args, host: 'github', owner: null, name: 'shop' });
  assert.equal(new URL(fresh.opened[0]).searchParams.get('target_name'), null);
  assert.ok(fresh.lines.some((l) => /All repositories/.test(l)));
});

test('the key card\'s words never say REST or curl, for any state, host or reason', async () => {
  const said = [];
  for (const host of ['github', 'gitlab']) {
    for (const state of ['none', 'push-only', 'refused']) {
      said.push(keyCardLine({ host, address: 'example.org', state }), keyCardPlanLine(host, state));
    }
    said.push(asIsReachLine(host));
  }
  said.push(replacesLine('example.org'));
  for (const state of ['none', 'push-only', 'refused']) {
    const w = cardWorld();
    await runKeyCard({ ...w.args, state, existing: state === 'none' ? null : 'oauth2' });
    said.push(...w.lines);
  }
  for (const line of said) assert.doesNotMatch(line, /\bREST\b|\bcurl\b/i, line);
  // The three openings say what is wrong, in plain words.
  assert.match(keyCardLine({ host: 'gitlab', address: 'gitlab.example.org', state: 'none' }), /key is missing/);
  assert.match(keyCardLine({ host: 'gitlab', address: 'gitlab.example.org', state: 'refused' }), /stopped working/);
  assert.match(keyCardLine({ host: 'gitlab', address: 'gitlab.example.org', state: 'push-only' }), /can push/);
  assert.equal(replacesLine('gitlab.example.org'), 'This replaces the key your git uses for gitlab.example.org with the new one, so your pushes keep working.');
  assert.equal(asIsReachLine('gitlab'), 'Wheelhouse uses the same key your git already uses. It can reach everything your account can on GitLab.');
});

test('a computer with neither a tool nor curl is told so in the design\'s own line, as a wait and not on a card', () => {
  assert.equal(noRoadLine('gitlab'), 'This computer has no curl Wheelhouse can use, so it can only reach GitLab through GitLab\'s own tool. Ask IT for either.');
  assert.match(noRoadLine('github'), /through GitHub's own tool/);
});
