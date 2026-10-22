// tests/scripts/setup/glab-source.test.js
// glab from the company's own list where gitlab.com is blocked, and the typed sign-in token (check 71,
// Part 6 Task 3). Nothing real is reached: the downloads, the computer's programs and the box are
// fakes, no downloaded program is run, and every test has a home of its own. Tokens here are made-up
// strings, asserted absent from every argument, line and error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { glabSource, readGlabFrom, fetchHostTool, toolsStep, ChecksumError } from '../../../scripts/setup/tools.js';
import { signIn, signInRoute } from '../../../scripts/setup/host.js';
import { toolFolder } from '../../../scripts/lib/host-tools.js';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const NOW = new Date('2026-10-22T03:00:00.000Z');
const COMPANY = 'https://git.example.org:8443';
const LIST_ADDRESS = 'https://tools.example.org/glab/list.json';
const TOKEN = 'glpat-typed-into-the-box-0001';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const NAME = 'glab_1.200.0_darwin_arm64.tar.gz';
const WINDOWS_NAME = 'glab_1.200.0_windows_amd64.zip';
const archive = (name) => Buffer.from(`the company's copy of ${name}`);

// The stand-ins no test may get past: a real gh or glab on the path would show in this log.
const stand = standInTools();
test.after(() => stand.restore());

// ---- A company's list: the same shape as GitLab's release, on disk or at an address ----

function listFolder({ checksums = 'file', tag = 'v1.200.0', names = [NAME, WINDOWS_NAME] } = {}) {
  const dir = fs.realpathSync.native(tempFolder('wh-company-list-'));
  const links = names.map((name) => ({ name, direct_asset_url: name }));
  for (const name of names) fs.writeFileSync(path.join(dir, name), archive(name));
  if (checksums === 'file') {
    fs.writeFileSync(path.join(dir, 'checksums.txt'), names.map((name) => `${sha(archive(name))}  ${name}`).join('\n'));
    links.push({ name: 'checksums.txt', direct_asset_url: 'checksums.txt' });
  } else if (checksums === 'inline') {
    for (const link of links) link.sha256 = sha(archive(link.name));
  } else if (checksums === 'wrong') {
    for (const link of links) link.sha256 = 'f'.repeat(64);
  }
  const list = path.join(dir, 'list.json');
  fs.writeFileSync(list, JSON.stringify({ ...(tag ? { tag_name: tag } : {}), assets: { links } }));
  return { dir, list };
}

// The same list at an https address, its files beside it; `other` puts one link on another host.
function companyNet({ checksums = 'file', other = null } = {}) {
  const calls = [];
  const base = LIST_ADDRESS.replace(/list\.json$/, '');
  const links = [NAME, WINDOWS_NAME].map((name) => ({ name, direct_asset_url: other?.[name] ?? `${base}${name}` }));
  if (checksums === 'file') links.push({ name: 'checksums.txt', direct_asset_url: `${base}checksums.txt` });
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), redirect: init.redirect });
    if (url === LIST_ADDRESS) return Response.json({ tag_name: 'v1.200.0', assets: { links } });
    if (url === `${base}checksums.txt`) return new Response([NAME, WINDOWS_NAME].map((name) => `${sha(archive(name))}  ${name}`).join('\n'));
    const found = [NAME, WINDOWS_NAME].find((name) => url === `${base}${name}`);
    return found ? new Response(archive(found)) : new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}
const noFetch = async (url) => assert.fail(`nothing is fetched here, but ${url} was`);

// ---- A fake computer: git, node and gh are here, glab is not; tar unpacks a stand-in, nothing runs ----

function computer() {
  const calls = [];
  const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  const present = { git: '/usr/bin/git', node: '/usr/local/bin/node', gh: '/opt/homebrew/bin/gh' };
  const unpacked = [];
  const run = async (file, args = [], options = {}) => {
    calls.push({ file, args: [...args], cwd: options.cwd, env: options.env });
    const name = file.split(/[\\/]/).pop();
    if (name === 'which') return present[args[0]] ? answer(`${present[args[0]]}\n`) : answer('', 1);
    if (name === 'xcode-select' && args[0] === '-p') return answer('/Library/Developer/CommandLineTools\n');
    if (name === 'tar') {
      const archivePath = path.resolve(options.cwd ?? '.', args[1]);
      const into = path.resolve(options.cwd ?? '.', args[3]);
      unpacked.push({ bytes: fs.readFileSync(archivePath) });
      fs.mkdirSync(path.join(into, 'glab_x', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(into, 'glab_x', 'bin', 'glab'), '#!/bin/sh\necho glab\n');
      return answer('');
    }
    if (args[0] === '--version') {
      if (file.includes(`${path.sep}tools${path.sep}`)) return answer('glab version 1.200.0 (2026-10-01)\n');
      return answer(name === 'node' ? 'v22.3.0\n' : `${name} version 2.100.0\n`);
    }
    return answer('', 1);
  };
  return { run, calls, unpacked };
}

const ctxFor = (folder) => ({ folder, step: 2, now: () => NOW, platform: 'darwin', userHome: folder, answers: {} });
function projectWith(setting) {
  const folder = fs.realpathSync.native(tempFolder('wh-glab-proj-'));
  fs.mkdirSync(path.join(folder, '.claude'));
  if (setting !== undefined) fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: setting }));
  return folder;
}
const fetchChange = (planned) => planned.changes.find((c) => c.action === 'fetch' && c.tool === 'glab');
const realToolsRan = () => stand.calls().filter((line) => /^(gh|glab) /.test(line));

// ---- Test 1 ----

test('a company source is used when set', async () => {
  // The setting: gitlab by default, or company with a path or an https address.
  assert.deepEqual(glabSource({}), { kind: 'gitlab', from: null });
  assert.deepEqual(glabSource({ setting: 'gitlab' }), { kind: 'gitlab', from: null });
  assert.deepEqual(glabSource({ setting: '  gitlab ' }), { kind: 'gitlab', from: null });
  assert.deepEqual(glabSource({ setting: 'company /srv/tools/glab/list.json' }), { kind: 'company', from: '/srv/tools/glab/list.json' });
  assert.deepEqual(glabSource({ setting: `company ${LIST_ADDRESS}` }), { kind: 'company', from: LIST_ADDRESS });
  assert.deepEqual(glabSource({ setting: 'company C:\\tools\\glab\\list.json' }), { kind: 'company', from: 'C:\\tools\\glab\\list.json' });
  // An address is https only, and a setting that is neither word is refused, plainly.
  assert.throws(() => glabSource({ setting: 'company http://tools.example.org/list.json' }), /https/);
  assert.throws(() => glabSource({ setting: 'company ftp://tools.example.org/list.json' }), /https/);
  assert.throws(() => glabSource({ setting: 'company' }), /company <path or address>/);
  assert.throws(() => glabSource({ setting: 'mirror x' }), /gitlab.*company <path or address>/);
  // The project's committed configuration holds it.
  assert.equal(readGlabFrom(projectWith('company /x/list.json')), 'company /x/list.json');
  assert.equal(readGlabFrom(projectWith()), undefined);

  // From a path: the files beside the list are used, nothing is fetched, and gitlab.com is not asked.
  await withHome(async () => {
    const { list } = listFolder();
    const m = computer();
    const got = await fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${list}` }) });
    assert.equal(got.version, '1.200.0');
    assert.deepEqual(m.unpacked[0].bytes, archive(NAME));
    assert.equal(fs.readFileSync(path.join(toolFolder('glab'), 'version'), 'utf8'), 'v1.200.0\n');
  });

  // From an address: https only, redirects refused, every file on the list's own host.
  await withHome(async () => {
    const net = companyNet();
    const m = computer();
    const got = await fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: net.fetch, run: m.run, source: glabSource({ setting: `company ${LIST_ADDRESS}` }) });
    assert.equal(got.version, '1.200.0');
    assert.deepEqual(m.unpacked[0].bytes, archive(NAME));
    assert.ok(net.calls.every((c) => c.url.startsWith('https://tools.example.org/')), net.calls.map((c) => c.url).join(', '));
    assert.ok(net.calls.every((c) => c.redirect === 'error'));
    assert.ok(!net.calls.some((c) => /gitlab\.com/.test(c.url)));
  });
  await withHome(async () => {
    const net = companyNet({ other: { [NAME]: 'https://downloads.example.net/glab.tar.gz' } });
    const m = computer();
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: net.fetch, run: m.run, source: glabSource({ setting: `company ${LIST_ADDRESS}` }) }), /not on the company's list host/);
    assert.deepEqual(m.unpacked, []);
    assert.equal(fs.existsSync(toolFolder('glab')), false);
  });

  // A list whose version disagrees with its file is refused; a path in a name is never followed.
  await withHome(async () => {
    const { list } = listFolder({ tag: 'v1.199.0' });
    const m = computer();
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${list}` }) }), /says v1\.199\.0.*1\.200\.0/);
    assert.deepEqual(m.unpacked, []);
  });

  // Through step 2: the card names the company's list, and apply fetches from it, with nothing from gitlab.com.
  await withHome(async () => {
    const { list } = listFolder();
    const folder = projectWith(`company ${list}`);
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const planned = await step.plan(ctxFor(folder));
    assert.deepEqual(fetchChange(planned), { kind: 'folder', target: toolFolder('glab'), action: 'fetch', tool: 'glab', from: 'company', source: list, version: '1.200.0', checksum: 'listed' });
    assert.ok(planned.card.what.includes(list), planned.card.what);
    assert.match(planned.card.what, /company's list/);
    assert.doesNotMatch(planned.card.what, /no checksum/);
    assert.deepEqual(m.unpacked, []);
    const recorded = [];
    const ctx = { ...ctxFor(folder), record: (c) => recorded.push(c), applyJsonKey: () => {}, stopped: () => false };
    await step.apply(ctx, [fetchChange(planned)]);
    assert.deepEqual(m.unpacked[0].bytes, archive(NAME));
    assert.equal(recorded.length, 1);
    assert.deepEqual(realToolsRan(), []);
  });
  // The default stays the official release: no setting, no company.
  await withHome(async () => {
    const folder = projectWith();
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const change = fetchChange(await step.plan(ctxFor(folder)));
    assert.deepEqual(change, { kind: 'folder', target: toolFolder('glab'), action: 'fetch', tool: 'glab' });
  });
});

// ---- Test 2 ----

test('a copy with no checksum is named on the card', async () => {
  await withHome(async () => {
    const { list } = listFolder({ checksums: 'none' });
    const folder = projectWith(`company ${list}`);
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const planned = await step.plan(ctxFor(folder));
    const change = fetchChange(planned);
    assert.equal(change.checksum, 'none');
    assert.match(planned.card.what, /gives no checksum/);
    assert.match(planned.card.what, /Not now/);
    // The card comes first: planning ran nothing and unpacked nothing.
    assert.deepEqual(m.unpacked, []);
    assert.ok(!m.calls.some((c) => c.file.endsWith('glab') || c.file.endsWith('tar')), 'nothing ran at the plan');
    // Without the card's change saying so, the copy is refused; with it, used.
    const source = glabSource({ setting: `company ${list}` });
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source }), ChecksumError);
    assert.deepEqual(m.unpacked, []);
    assert.equal(fs.existsSync(toolFolder('glab')), false);
    await step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {}, stopped: () => false }, [change]);
    assert.deepEqual(m.unpacked[0].bytes, archive(NAME));
  });
  // A change planned with a checksum is refused when the list has lost it by apply.
  await withHome(async () => {
    const { list, dir } = listFolder();
    const folder = projectWith(`company ${list}`);
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const change = fetchChange(await step.plan(ctxFor(folder)));
    assert.equal(change.checksum, 'listed');
    fs.writeFileSync(list, JSON.stringify({ tag_name: 'v1.200.0', assets: { links: [{ name: NAME, direct_asset_url: NAME }] } }));
    assert.ok(fs.existsSync(dir));
    await assert.rejects(step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {}, stopped: () => false }, [change]), ChecksumError);
    assert.deepEqual(m.unpacked, []);
  });
  // A checksum on the list that does not match is refused, even when the card allowed none.
  await withHome(async () => {
    const { list } = listFolder({ checksums: 'wrong' });
    const m = computer();
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${list}` }), allowNoChecksum: true }), ChecksumError);
    assert.deepEqual(m.unpacked, []);
  });
  // Checksums written on the list's links count as the list's own.
  await withHome(async () => {
    const { list } = listFolder({ checksums: 'inline' });
    const folder = projectWith(`company ${list}`);
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    assert.equal(fetchChange(await step.plan(ctxFor(folder))).checksum, 'listed');
  });
});

// ---- Test 3 ----

// A stand-in glab for the company's GitLab: it notes every call (arguments, environment, standard
// input) and signs in when handed a token on standard input.
function glabWorld({ registered = false, accepts = true } = {}) {
  const w = { calls: [], signedIn: false };
  const answer = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });
  w.run = async (file, args = [], options = {}) => {
    const name = path.basename(file).replace(/\.exe$/, '');
    if (name !== 'glab') return answer('', 1, 'not run in this test');
    w.calls.push({ args: [...args], env: options.env, input: options.input });
    if (args[0] === 'auth' && args[1] === 'status') return w.signedIn ? answer('', 0, 'Logged in') : answer('', 1, 'You are not logged into any hosts');
    if (args[0] === 'config' && args[1] === 'get') return answer(registered ? 'an-application-id\n' : '', 0);
    if (args[0] === 'config' && args[1] === 'set') return answer('');
    if (args[0] === 'auth' && args[1] === 'login') {
      if (args.includes('--stdin')) {
        if (accepts) w.signedIn = true;
        // glab's own words on a refusal would quote the token if it could; setup must not repeat them.
        return accepts ? answer('', 0, 'Logged in') : answer('', 1, `401 Unauthorized for token ${options.input?.trim()}`);
      }
      return answer('', 1, "Set 'client_id' first");
    }
    if (args[0] === 'api' && args[1] === 'user') return w.signedIn ? answer(JSON.stringify({ username: 'a-director' })) : answer('', 1, 'HTTP 401');
    return answer('', 1, 'unknown command');
  };
  return w;
}

const everything = (value) => JSON.stringify(value);

test('the typed token never reaches an argument or the output', async () => {
  await withHome(async () => {
    const w = glabWorld();
    const lines = [];
    const opened = [];
    const boxes = [];
    const got = await signIn({
      host: 'gitlab', run: w.run, base: COMPANY, platform: 'darwin',
      say: (l) => lines.push(l),
      open: async (url) => { opened.push(url); },
      askSecret: async (ask, platform) => { boxes.push({ ask, platform }); return `  ${TOKEN}\n`; },
    });
    assert.deepEqual(got, { signedIn: true, user: 'a-director' });
    // The page that opens is the company's own token page; the box is the computer's own.
    assert.equal(opened.length, 1);
    assert.ok(opened[0].startsWith(`${COMPANY}/-/user_settings/personal_access_tokens`), opened[0]);
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].platform, 'darwin');
    // The token went to glab's standard input, once, and nowhere else.
    const login = w.calls.filter((c) => c.args[0] === 'auth' && c.args[1] === 'login');
    assert.equal(login.length, 1);
    assert.deepEqual(login[0].args, ['auth', 'login', '--hostname', 'git.example.org:8443', '--stdin', '--git-protocol', 'https']);
    assert.equal(login[0].input, `${TOKEN}\n`);
    assert.equal(login[0].env.GITLAB_HOST, 'git.example.org:8443');
    // Today's keyring default is kept: no file route is asked for.
    assert.ok(!w.calls.some((c) => c.args.includes('--insecure-storage')));
    assert.ok(!w.calls.some((c) => c.args.includes('--web')));
    for (const c of w.calls) {
      assert.ok(!everything(c.args).includes(TOKEN), `an argument held the token: ${c.args.join(' ')}`);
      assert.ok(!everything(c.env ?? {}).includes(TOKEN), 'the environment held the token');
      if (c !== login[0]) assert.equal(c.input, undefined);
    }
    for (const text of [...lines, ...opened, ...boxes.map((b) => everything(b.ask))]) assert.ok(!text.includes(TOKEN), text);
    assert.ok(lines.some((l) => /never into the chat/.test(l)), lines.join(' | '));
    // The company's git protocol is set to https, as for the browser route.
    assert.ok(w.calls.some((c) => c.args.join(' ') === 'config set git_protocol https --host git.example.org:8443'));
  });

  // A token the company's GitLab refuses: the error is setup's own words, never glab's, never the token.
  await withHome(async () => {
    const w = glabWorld({ accepts: false });
    const lines = [];
    await assert.rejects(
      signIn({ host: 'gitlab', run: w.run, base: COMPANY, platform: 'darwin', say: (l) => lines.push(l), open: async () => {}, askSecret: async () => TOKEN }),
      (error) => {
        assert.match(error.message, /did not accept the token/);
        assert.ok(!error.message.includes(TOKEN) && !String(error.stack).includes(TOKEN));
        return true;
      },
    );
    for (const l of lines) assert.ok(!l.includes(TOKEN));
  });

  // A box closed or left empty signs nothing in and runs no login.
  await withHome(async () => {
    for (const askSecret of [async () => { throw new Error(`cancelled ${TOKEN}`); }, async () => '   ']) {
      const w = glabWorld();
      await assert.rejects(
        signIn({ host: 'gitlab', run: w.run, base: COMPANY, platform: 'darwin', open: async () => {}, askSecret }),
        (error) => { assert.match(error.message, /No GitLab token was given/); assert.ok(!error.message.includes(TOKEN)); return true; },
      );
      assert.ok(!w.calls.some((c) => c.args[1] === 'login'));
    }
  });

  // Where the company has registered an application, the browser route stays; nothing is typed.
  await withHome(async () => {
    const w = glabWorld({ registered: true });
    assert.equal(await signInRoute({ run: w.run, base: COMPANY }), 'browser');
    assert.equal(await signInRoute({ run: glabWorld().run, base: COMPANY }), 'token');
    let boxes = 0;
    await assert.rejects(signIn({ host: 'gitlab', run: w.run, base: COMPANY, askSecret: async () => { boxes += 1; return TOKEN; } }), /could not sign in/);
    assert.equal(boxes, 0);
    assert.ok(w.calls.some((c) => c.args.includes('--web')));
  });

  assert.deepEqual(realToolsRan(), []);
});
