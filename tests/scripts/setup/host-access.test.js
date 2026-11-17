// tests/scripts/setup/host-access.test.js
// Step 3 finds how the director's computer already reaches the host (scripts/setup/host-access.js): the remote's
// transport, their credential helper, whether their git reaches the remote, whether the key their git holds passes
// GET /user, and the key card for a key that is missing, refused or can only push. No test asks the computer's own store,
// runs git against a real host or reaches a real network: the director's git, the store and curl are stand-ins.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  transportOf, credentialHelperOf, lsRemoteWorks, checkApiKey, findAccess, backendFor, runKeyCard, keyCardLine, keyCardPlanLine,
  asIsReachLine, replacesLine, noRoadLine, hostAddress, NO_KEY_GIVEN, folderMayRewrite,
} from '../../../scripts/setup/host-access.js';
import { makeRoutedCurl } from '../../helpers/fake-curl.js';
import { originUrl } from '../../../scripts/setup/tools.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';

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
  // A Windows drive path is a place on this computer, not host:path.
  for (const drive of ['C:/Users/ann/repo', 'C:\\Users\\ann\\repo', 'd:/work/product.git', 'D:\\work\\product.git']) assert.equal(transportOf(drive), null, drive);
  assert.equal(transportOf('git@gitlab.example.org:team/product.git'), 'ssh');
});

test('the credential helper and a working ls-remote are read from the director\'s own git, asking nothing', async () => {
  const seen = [];
  const ask = async (args) => {
    seen.push(args);
    if (args[0] === 'config') return { code: 0, stdout: 'manager\n' };
    return { code: args.at(-2).includes('good') ? 0 : 128, stdout: '' };
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

test('on GitLab, git runs without the director\'s token variables, and on GitHub with the environment as it is', async () => {
  const seen = [];
  const rewrites = {};
  const run = async (file, args, opts) => {
    if (args.includes('--get-url')) return { code: 0, stdout: `${rewrites[args.at(-1)] ?? args.at(-1)}\n` };
    seen.push(opts.baseEnv);
    return { code: 0, stdout: 'abc\tHEAD\n' };
  };
  const env = { PATH: '/bin', GITLAB_TOKEN: 'tok', GH_TOKEN: 'tok2' };
  const base = { repo: 'team/product', run, borrow: async () => null, via: viaOf(curlFor({})), env };
  await findAccess({ ...base, host: 'gitlab', base: GITLAB, remoteUrl: `${GITLAB}/team/product.git` });
  assert.ok(seen.length > 0);
  for (const e of seen) {
    assert.equal(e.GITLAB_TOKEN, undefined);
    assert.equal(e.GH_TOKEN, undefined);
    assert.equal(e.PATH, '/bin');
  }
  seen.length = 0;
  await findAccess({ ...base, host: 'github', remoteUrl: 'https://github.com/ann/cafe.git' });
  for (const e of seen) assert.equal(e.GH_TOKEN, 'tok2');
  // What decides is the host git is asked to reach, not the host named: a remote on another host loses them either way.
  seen.length = 0;
  await findAccess({ ...base, host: 'github', remoteUrl: 'https://git.example.org/ann/cafe.git' });
  assert.ok(seen.length > 0);
  for (const e of seen) assert.equal(e.GH_TOKEN, undefined);
  seen.length = 0;
  await findAccess({ ...base, host: 'gitlab', base: GITLAB, remoteUrl: 'https://github.com/ann/cafe.git' });
  for (const e of seen) assert.equal(e.GH_TOKEN, 'tok2');
  // git reads the host its own way: a backslash in the authority is no github.com, and the host after the last @ is the one.
  for (const remote of ['https://github.com\\@git.example.org/a/b', 'https://github.com@git.example.org/a/b', 'git@git.example.org:a/b']) {
    seen.length = 0;
    await findAccess({ ...base, host: 'github', remoteUrl: remote });
    assert.ok(seen.length > 0, remote);
    for (const e of seen) assert.equal(e.GH_TOKEN, undefined, remote);
  }
  // An authority that git, curl and a URL reader end differently, or a second @, keeps the variables out.
  for (const remote of ['https://evil.example.org?@github.com/o/r', 'https://evil.example.org#@github.com/o/r', 'https://a@evil.example.org@github.com/o/r', 'https://evil.example.org%40@github.com/o/r', 'git@evil.example.org:x@github.com:o/r']) {
    seen.length = 0;
    await findAccess({ ...base, host: 'github', remoteUrl: remote });
    assert.ok(seen.length > 0, remote);
    for (const e of seen) assert.equal(e.GH_TOKEN, undefined, remote);
  }
  seen.length = 0;
  await findAccess({ ...base, host: 'github', remoteUrl: 'https://user@github.com/a/b' });
  for (const e of seen) assert.equal(e.GH_TOKEN, 'tok2');
  // The address git uses after its own url.<base>.insteadOf rewriting decides, and an address it cannot give keeps them out.
  rewrites['https://github.com/a/b'] = 'https://git.example.org/a/b';
  seen.length = 0;
  await findAccess({ ...base, host: 'github', remoteUrl: 'https://github.com/a/b' });
  assert.ok(seen.length > 0);
  for (const e of seen) assert.equal(e.GH_TOKEN, undefined);
  rewrites['https://github.com/a/b'] = 'not an address';
  seen.length = 0;
  await findAccess({ ...base, host: 'github', remoteUrl: 'https://github.com/a/b' });
  for (const e of seen) assert.equal(e.GH_TOKEN, undefined);
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
    askSecret: async () => typed, platform: 'darwin', via: viaOf(curl),
    store: async (entry) => { stored.push(entry); },
    borrow: async () => (stored.length > 0 ? { username: stored.at(-1).username, key: stored.at(-1).key } : null),
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
  assert.deepEqual(w.stored, [{ host: 'gitlab.example.org', base: GITLAB, repoPath: 'team/product', username: 'oauth2', key: NEW_KEY }]);
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

test('if git still gives the old key after the new one is stored, the card says so plainly instead of connecting', async () => {
  const w = cardWorld();
  w.args.borrow = async () => ({ username: 'oauth2', key: 'stand-in-OLD' });
  await assert.rejects(runKeyCard({ ...w.args, state: 'refused', existing: 'oauth2' }), /still gives an older one for gitlab\.example\.org/);
});

test('on GitHub the key card says plainly what the replaced entry loses, and asks for every repository the pushes need', async () => {
  const lines = [];
  const stored = [];
  const curl = curlFor({ [NEW_KEY]: 'a-director' });
  const args = {
    host: 'github', owner: 'a-director', name: 'shop', state: 'push-only', existing: 'a-director', say: (l) => lines.push(l), open: async () => {},
    askSecret: async () => NEW_KEY, platform: 'darwin', via: viaOf(curl), store: async (e) => { stored.push(e); },
    borrow: async () => ({ username: 'a-director', key: NEW_KEY }),
  };
  try { await runKeyCard(args); } catch { /* the check below is on the words */ }
  const said = lines.join('\n');
  assert.doesNotMatch(said, /so your pushes keep working/);
  assert.match(said, /Pushes to any repository the new key does not include would be refused, so include every repository you push to from this computer/);
  assert.match(said, /then shop and every other repository you push to from this computer/);
  assert.doesNotMatch(said, /\bREST\b|\bcurl\b/i);
});

test('a key a director\'s git holds by path is stored with the same path a borrow sends', async () => {
  const { storeDirectorKey } = await import('../../../scripts/host/store.js');
  const sent = [];
  const run = async ({ args, input }) => {
    if (args[0] === 'config') return { code: 0, stdout: 'true\n', stderr: '' };
    sent.push(input);
    return { code: 0, stdout: '', stderr: '' };
  };
  await storeDirectorKey({ host: 'gitlab.example.org', base: GITLAB, repoPath: 'team/product', username: 'oauth2', key: NEW_KEY, run });
  assert.match(sent[0], /^protocol=https\nhost=gitlab\.example\.org\npath=team\/product\.git\nusername=oauth2\n/);
  const plain = [];
  await storeDirectorKey({ host: 'gitlab.example.org', base: GITLAB, repoPath: 'team/product', username: 'oauth2', key: NEW_KEY, run: async ({ args, input }) => { if (args[0] === 'config') return { code: 1, stdout: '', stderr: '' }; plain.push(input); return { code: 0, stdout: '', stderr: '' }; } });
  assert.doesNotMatch(plain[0], /path=/);
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

test('a folder whose own git settings could rewrite an address keeps the director\'s token variables out, and git is never run in it', async () => {
  const folders = [];
  const folderWith = (config) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-rewrite-'));
    folders.push(folder);
    if (config !== null) {
      fs.mkdirSync(path.join(folder, '.git'));
      fs.writeFileSync(path.join(folder, '.git', 'config'), config);
    }
    return folder;
  };
  try {
    const seen = [];
    const cwds = [];
    const run = async (file, args, opts) => {
      cwds.push(opts.cwd);
      if (args.includes('--get-url')) return { code: 0, stdout: `${args.at(-1)}\n` };
      seen.push(opts.baseEnv);
      return { code: 0, stdout: 'abc\tHEAD\n' };
    };
    const env = { PATH: '/bin', GH_TOKEN: 'tok2' };
    const base = { repo: 'ann/cafe', run, borrow: async () => null, via: viaOf(curlFor({})), env, host: 'github', remoteUrl: 'https://github.com/ann/cafe.git' };
    const rewriting = [
      '[remote "origin"]\n\turl = https://github.com/ann/cafe.git\n[url "https://git.example.org/"]\n\tinsteadOf = https://github.com/\n',
      '[remote "origin"]\n\turl = https://github.com/ann/cafe.git\n[url "https://git.example.org/"]\n\tpushInsteadOf = https://github.com/\n',
      '[include]\n\tpath = ../more.config\n',
      '[includeIf "gitdir:~/"]\n\tpath = ../more.config\n',
    ];
    for (const config of rewriting) {
      const folder = folderWith(config);
      assert.equal(folderMayRewrite(folder), true, config);
      seen.length = 0;
      await findAccess({ ...base, folder });
      assert.ok(seen.length > 0);
      for (const e of seen) assert.equal(e.GH_TOKEN, undefined, config);
    }
    // A folder with plain settings, or none, keeps the environment as it is on GitHub.
    for (const config of ['[remote "origin"]\n\turl = https://github.com/ann/cafe.git\n[core]\n\tbare = false\n', null]) {
      const folder = folderWith(config);
      assert.equal(folderMayRewrite(folder), false);
      seen.length = 0;
      await findAccess({ ...base, folder });
      for (const e of seen) assert.equal(e.GH_TOKEN, 'tok2');
    }
    assert.equal(cwds.some((c) => folders.includes(c)), false, 'git is not run inside the folder');
  } finally {
    for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
  }
});

test('an origin address that reads as an option or a transport helper never reaches git, and creates no file', async () => {
  const marker = path.join(os.tmpdir(), `wh-pwned-${process.pid}`);
  const evil = `--upload-pack=touch\${IFS}${marker};@x:y`;
  const seen = [];
  const run = async (file, args, opts) => {
    seen.push({ args, opts });
    return { code: 0, stdout: 'abc\tHEAD\n' };
  };
  const base = { host: 'github', repo: 'ann/cafe', run, borrow: async () => null, via: viaOf(curlFor({})), env: { PATH: '/bin', GIT_DIR: '/elsewhere', GIT_CONFIG_COUNT: '1', GH_TOKEN: 'tok2' } };
  const bad = [evil, '-oProxyCommand=x@y:z', 'ext::sh -c touch pwned', 'ssh://-oProxyCommand=x/y', 'git@-evil:a/b', 'https://-evil/a'];
  for (const remoteUrl of bad) {
    assert.equal(transportOf(remoteUrl), null, remoteUrl);
    seen.length = 0;
    const found = await findAccess({ ...base, remoteUrl });
    assert.equal(found.gitReaches, false, remoteUrl);
    assert.equal(seen.some(({ args }) => args.includes('ls-remote')), false, `${remoteUrl} reached git`);
  }
  assert.equal(fs.existsSync(marker), false);
  // A good address is passed after --end-of-options, from a folder outside any repository, with none of git's own variables.
  for (const remoteUrl of ['https://github.com/ann/cafe.git', 'git@github.com:ann/cafe.git', 'ssh://git@github.com/ann/cafe.git']) {
    assert.notEqual(transportOf(remoteUrl), null, remoteUrl);
    seen.length = 0;
    await findAccess({ ...base, remoteUrl });
    const listed = seen.filter(({ args }) => args.includes('ls-remote'));
    assert.ok(listed.length > 0, remoteUrl);
    for (const { args, opts } of listed) {
      assert.ok(args.indexOf('--end-of-options') >= 0 && args.indexOf('--end-of-options') < args.indexOf(remoteUrl), remoteUrl);
      assert.equal(opts.cwd, wheelhouseHome());
    }
    for (const { opts } of seen) {
      assert.equal(opts.baseEnv.GIT_DIR, undefined);
      assert.equal(opts.baseEnv.GIT_CONFIG_COUNT, undefined);
      assert.equal(opts.baseEnv.GIT_ALLOW_PROTOCOL, 'https:ssh');
    }
  }
  // The folder's own origin is never read when it starts with a dash.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-origin-'));
  try {
    fs.mkdirSync(path.join(folder, '.git'));
    fs.writeFileSync(path.join(folder, '.git', 'config'), `[remote "origin"]\n\turl = ${evil}\n`);
    assert.equal(originUrl(folder), null);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('a linked worktree, or a repository with a config of its own for one, may rewrite addresses too', () => {
  for (const marker of ['commondir', 'config.worktree']) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-worktree-'));
    try {
      fs.mkdirSync(path.join(folder, '.git'));
      fs.writeFileSync(path.join(folder, '.git', 'config'), '[core]\n\tbare = false\n');
      assert.equal(folderMayRewrite(folder), false);
      fs.writeFileSync(path.join(folder, '.git', marker), 'x\n');
      assert.equal(folderMayRewrite(folder), true, marker);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
});

test('an address git would rewrite to another scheme, or to a transport helper, keeps the token variables out', async () => {
  const seen = [];
  const rewrites = { 'https://github.com/a/b': 'file://github.com/a/b', 'https://github.com/a/c': 'ext::https://github.com/a/c' };
  const run = async (file, args, opts) => {
    if (args.includes('--get-url')) return { code: 0, stdout: `${rewrites[args.at(-1)]}\n` };
    seen.push(opts.baseEnv);
    return { code: 0, stdout: 'abc\tHEAD\n' };
  };
  for (const remoteUrl of Object.keys(rewrites)) {
    seen.length = 0;
    await findAccess({ repo: 'a/b', host: 'github', run, borrow: async () => null, via: viaOf(curlFor({})), env: { PATH: '/bin', GH_TOKEN: 'tok2' }, remoteUrl });
    assert.ok(seen.length > 0, remoteUrl);
    for (const e of seen) assert.equal(e.GH_TOKEN, undefined, remoteUrl);
  }
});
