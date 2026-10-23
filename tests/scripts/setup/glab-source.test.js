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
import { composeCard } from '../../../scripts/cards/compose.js';
import { planHash } from '../../../scripts/setup/steps.js';
import { termsIn, glossaryOf } from '../../../scripts/frontdesk/glossary.js';
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

function computer({ present = { git: '/usr/bin/git', node: '/usr/local/bin/node', gh: '/opt/homebrew/bin/gh' } } = {}) {
  const calls = [];
  const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  const unpacked = [];
  const run = async (file, args = [], options = {}) => {
    calls.push({ file, args: [...args], cwd: options.cwd, env: options.env });
    const name = file.split(/[\\/]/).pop();
    if (name === 'which' || name === 'where') return present[args[0]] ? answer(`${present[args[0]]}\n`) : answer('', 1);
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
      if (name === 'node' || file.endsWith('node.exe')) return answer('v22.3.0\n');
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

  // On the path route a name that climbs out, carries a separator, or is a symbolic link is refused, and nothing is unpacked.
  for (const [what, link, matcher, prepare] of [
    ['a ../ name', '../outside.tar.gz', /not beside the company's list/, null],
    ['a name with a separator', 'sub/glab.tar.gz', /not beside the company's list/, null],
    ['a Windows separator', 'sub\\glab.tar.gz', /not beside the company's list/, null],
    ['a symbolic link', NAME, /not a plain file/, (dir) => {
      const real = path.join(dir, 'real.tar.gz');
      fs.renameSync(path.join(dir, NAME), real);
      fs.symlinkSync(real, path.join(dir, NAME));
    }],
  ]) {
    await withHome(async () => {
      const { dir, list } = listFolder({ checksums: 'inline' });
      const links = JSON.parse(fs.readFileSync(list, 'utf8'));
      if (prepare) prepare(dir);
      else links.assets.links.find((l) => l.name === NAME).direct_asset_url = link;
      fs.writeFileSync(list, JSON.stringify(links));
      const m = computer();
      await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${list}` }) }), matcher, what);
      assert.deepEqual(m.unpacked, [], what);
      assert.equal(fs.existsSync(toolFolder('glab')), false, what);
    });
  }
  // On the address route a certificate this computer does not trust, and a server that is not there, are
  // given in plain lines, naming no way to switch the check off and no setting file to edit.
  for (const [code, matcher] of [['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /isn't one this computer trusts, and setup never switches certificate checks off/], ['ECONNREFUSED', /can't be reached from here, perhaps off the company network/]]) {
    await withHome(async () => {
      const failing = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) }); };
      const m = computer();
      await assert.rejects(
        fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: failing, run: m.run, source: glabSource({ setting: `company ${LIST_ADDRESS}` }) }),
        (error) => {
          assert.match(error.message, matcher);
          assert.match(error.message, /tools\.example\.org/);
          assert.doesNotMatch(error.message, /glabFrom|wheelhouse\.json|NODE_TLS|-k\b/);
          if (code !== 'ECONNREFUSED') assert.match(error.message, /Ask whoever looks after your company's computers.*reaches you as a card/);
          assert.deepEqual(termsIn(error.message, glossaryOf({})), []);
          return true;
        },
      );
      assert.deepEqual(m.unpacked, []);
    });
  }
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

// ---- A list inside the project's folder is never used ----

test('a company list written as a relative path, or lying inside the project folder in any way, is refused and the card names a shown source', async () => {
  const INSIDE = /inside this project's folder.*keep the list outside the project/;
  await withHome(async () => {
    const { dir, list } = listFolder();
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });

    // A relative path: refused at the plan, and by the fetch.
    const relative = projectWith('company tools/list.json');
    await assert.rejects(step.plan(ctxFor(relative)), /must be written as a full path or an https address/);
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: 'company tools/list.json' }), folder: relative }), /full path/);

    // The list and its files copied into the folder: refused, with nothing unpacked.
    const folder = projectWith();
    const inFolder = path.join(folder, 'tools');
    fs.cpSync(dir, inFolder, { recursive: true });
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: `company ${path.join(inFolder, 'list.json')}` }));
    await assert.rejects(step.plan(ctxFor(folder)), INSIDE);
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${path.join(inFolder, 'list.json')}` }), folder }), INSIDE);

    // A link outside the folder that comes to a list inside it: refused (the real path is read).
    const toInside = path.join(dir, 'link.json');
    fs.symlinkSync(path.join(inFolder, 'list.json'), toInside);
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: `company ${toInside}` }));
    await assert.rejects(step.plan(ctxFor(folder)), INSIDE);

    // A link in the folder that comes to a list outside it: refused too, since an agent in the folder can point it elsewhere.
    const linkInFolder = path.join(folder, 'outside.json');
    fs.symlinkSync(list, linkInFolder);
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: `company ${linkInFolder}` }));
    await assert.rejects(step.plan(ctxFor(folder)), INSIDE);

    // The folder itself reached through a link: still inside.
    const folderLink = path.join(dir, 'project-link');
    fs.symlinkSync(folder, folderLink);
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: `company ${path.join(folderLink, 'tools', 'list.json')}` }));
    await assert.rejects(step.plan(ctxFor(folder)), INSIDE);
    assert.deepEqual(m.unpacked, []);

    // The same list outside the folder is used, on the card with its source named even in the terse form.
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: `company ${list}` }));
    const planned = await step.plan(ctxFor(folder));
    assert.equal(fetchChange(planned).source, list);
    assert.ok(planned.card.what.includes(list));
  });
});

// A volume that ignores case: a folder named in a different case is the same folder, so a list reached that way is inside it.
const caseBlind = (() => {
  const probe = fs.realpathSync.native(tempFolder('wh-case-probe-'));
  const upper = path.join(path.dirname(probe), path.basename(probe).toUpperCase());
  try {
    return upper !== probe && fs.existsSync(upper);
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

test('a company list reached through the project folder written in a different case is refused as inside it', { skip: caseBlind ? false : 'this file system tells upper and lower case apart' }, async () => {
  const INSIDE = /inside this project's folder.*keep the list outside the project/;
  await withHome(async () => {
    const { dir } = listFolder();
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const folder = projectWith();
    const inFolder = path.join(folder, 'tools');
    fs.cpSync(dir, inFolder, { recursive: true });
    const shouted = path.join(path.dirname(folder), path.basename(folder).toUpperCase());
    const listInShoutedFolder = path.join(shouted, 'tools', 'list.json');
    assert.notEqual(shouted, folder);
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ glabFrom: `company ${listInShoutedFolder}` }));
    await assert.rejects(step.plan(ctxFor(folder)), INSIDE);
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${listInShoutedFolder}` }), folder }), INSIDE);
    assert.deepEqual(m.unpacked, []);
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
    // It says what the file becomes: the glab Wheelhouse uses afterwards, the sign-in included.
    assert.match(planned.card.what, /after that it is the glab Wheelhouse uses for your GitLab work, including your sign-in/);
    assert.doesNotMatch(planned.card.what, /runs it only/);
    assert.match(planned.card.what, /Not now/);
    // The file the card is about is pinned by its hash (a read at the plan), and the card composes within its length
    // and needs no glossary words put into plain words.
    assert.equal(change.pin, sha(archive(NAME)));
    assert.ok(composeCard({ ...planned.card, target: { step: 2, hash: planHash(planned.changes) } }).question.question.length > 0);
    assert.deepEqual(termsIn(planned.card.what, glossaryOf({})), []);
    // The card comes first: planning ran nothing and unpacked nothing.
    assert.deepEqual(m.unpacked, []);
    assert.ok(!m.calls.some((c) => c.file.endsWith('glab') || c.file.endsWith('tar')), 'nothing ran at the plan');
    // Without the card's change saying so, the copy is refused; with it, used.
    const source = glabSource({ setting: `company ${list}` });
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source }), ChecksumError);
    assert.deepEqual(m.unpacked, []);
    assert.equal(fs.existsSync(toolFolder('glab')), false);
    // A change with no pin is refused too: only the file the card hashed is used.
    const { pin, ...unpinned } = change;
    await assert.rejects(step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {}, stopped: () => false }, [unpinned]), ChecksumError);
    assert.deepEqual(m.unpacked, []);
    await step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {}, stopped: () => false }, [change]);
    assert.deepEqual(m.unpacked[0].bytes, archive(NAME));
  });
  // The file swapped after the card was shown is refused, and nothing is unpacked or run.
  await withHome(async () => {
    const { list, dir } = listFolder({ checksums: 'none' });
    const folder = projectWith(`company ${list}`);
    const m = computer();
    const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const change = fetchChange(await step.plan(ctxFor(folder)));
    fs.writeFileSync(path.join(dir, NAME), 'a different file from the one the card was shown');
    await assert.rejects(step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {}, stopped: () => false }, [change]), /not the file the card was shown/);
    assert.deepEqual(m.unpacked, []);
    assert.equal(fs.existsSync(toolFolder('glab')), false);
    assert.ok(!m.calls.some((c) => c.file.endsWith('glab')), 'nothing ran');
  });
  // The same at an address: the plan fetched the archive once to hash it, apply fetches it again and compares.
  await withHome(async () => {
    const folder = projectWith(`company ${LIST_ADDRESS}`);
    const m = computer();
    let swapped = false;
    const net = companyNet({ checksums: 'none' });
    const fetch = async (url, init) => (swapped && String(url).endsWith(NAME) ? new Response('swapped') : net.fetch(url, init));
    const step = toolsStep({ run: m.run, fetch, arch: 'arm64', pluginRoot: '/plug', env: {} });
    const change = fetchChange(await step.plan(ctxFor(folder)));
    assert.equal(change.pin, sha(archive(NAME)));
    swapped = true;
    await assert.rejects(step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {}, stopped: () => false }, [change]), /not the file the card was shown/);
    assert.deepEqual(m.unpacked, []);
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
    await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: noFetch, run: m.run, source: glabSource({ setting: `company ${list}` }), pin: sha(archive(NAME)) }), ChecksumError);
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

// Long enough that the full wording of step 2's card does not compose, whichever checksums the list gives.
const LONG_SOURCE = 400;

// Folder names of `chars` characters in all, each at most 100 long (a name has a limit), joined by separators.
function folderNames(chars) {
  const names = [];
  for (let left = chars; left > 0; left -= 101) names.push('x'.repeat(Math.min(100, left)));
  return names;
}

test('step 2\'s card composes in the worst first run, and the no-checksum warning stays on it', async () => {
  // Git's installer on Windows, gh and glab to fetch, the permission rule, and a 400-character source.
  for (const checksums of ['none', 'file']) {
    await withHome(async () => {
      const dir = fs.realpathSync.native(tempFolder('wh-long-'));
      const { list } = listFolder({ checksums });
      const long = path.join(dir, ...folderNames(LONG_SOURCE - dir.length - '/list.json'.length - 1), 'list.json');
      fs.mkdirSync(path.dirname(long), { recursive: true });
      fs.copyFileSync(list, long);
      for (const name of [NAME, WINDOWS_NAME]) fs.copyFileSync(path.join(path.dirname(list), name), path.join(path.dirname(long), name));
      if (checksums === 'file') fs.copyFileSync(path.join(path.dirname(list), 'checksums.txt'), path.join(path.dirname(long), 'checksums.txt'));
      assert.ok(long.length >= LONG_SOURCE - 10, String(long.length));
      const folder = projectWith(`company ${long}`);
      const m = computer({ present: { node: 'C:\\Program Files\\nodejs\\node.exe' } });
      const step = toolsStep({ run: m.run, fetch: noFetch, arch: 'x64', pluginRoot: 'C:\\Plugins\\wheelhouse', env: {} });
      const planned = await step.plan({ ...ctxFor(folder), platform: 'win32' });
      assert.ok(planned.changes.some((c) => c.kind === 'process'), 'git is to be installed');
      assert.ok(planned.changes.some((c) => c.tool === 'gh' && c.action === 'fetch'));
      assert.ok(planned.changes.some((c) => c.kind === 'json-key'));
      const glab = fetchChange(planned);
      assert.equal(glab.source, long);
      assert.equal(glab.checksum, checksums === 'none' ? 'none' : 'listed');
      // It composes, with the source named in short on the card (its beginning and end) and kept whole in
      // the change under the plan hash.
      const { question } = composeCard({ ...planned.card, target: { step: 2, hash: planHash(planned.changes) } });
      assert.ok(question.question.length <= 1200);
      // The full wording does not compose with a source this long, so the card is the terse one, naming the source in short.
      assert.equal(planned.card.what.includes(long), false, 'the terse card is the one shown');
      const shown = `${long.slice(0, 40)}…${long.slice(-23)}`;
      assert.ok(planned.card.what.includes(shown), planned.card.what);
      if (checksums === 'none') {
        assert.match(planned.card.what, /glab: from your company's list at .*, no checksum; it becomes your glab for GitLab and sign-in; Not now if unsure/);
      } else {
        assert.match(planned.card.what, /glab: from your company's list at .*, checked/);
      }
      if (checksums === 'none') {
        assert.match(planned.card.what, /no checksum/);
      } else {
        assert.doesNotMatch(planned.card.what, /no checksum/);
      }
      assert.deepEqual(termsIn(planned.card.what, glossaryOf({})), []);
      // A different source gives a different list, so a different hash.
      assert.notEqual(planHash(planned.changes), planHash(planned.changes.map((c) => (c.source ? { ...c, source: `${c.source}2` } : c))));
    });
  }
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
