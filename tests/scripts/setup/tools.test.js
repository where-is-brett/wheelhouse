// tests/scripts/setup/tools.test.js
// Setup's step 2, the tools: what is on the computer, git's official installer started first and
// recorded before anything waits on it, gh and glab fetched into Wheelhouse's tools folder and
// checked before anything is unpacked, Node.js below the floor stopping setup with the README's
// line, and the allow rule for setup's own command. Nothing real is installed or fetched: `run`
// and `fetch` are fakes, and every home is a scratch folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  toolsStatus, startInstaller, fetchHostTool, toolsStep, hostToolsFor, nodeRefusal, openCommand, pickInstaller, notesChecksums,
  NODE_LINE, INSTALL_COMMANDS, MAC_INSTALLER, GIT_INSTALLER_ARGS, ChecksumError,
} from '../../../scripts/setup/tools.js';
import { STEPS, planHash } from '../../../scripts/setup/steps.js';
import { runApply, setupRoutes } from '../../../scripts/setup/engine.js';
import { startRun, markStep, findRun, reverseChange } from '../../../scripts/setup/journal.js';
import { toolPath, fetchedPath, toolFolder } from '../../../scripts/lib/host-tools.js';
import { makeAdapter } from '../../../scripts/host/adapter.js';
import { protectionStatus } from '../../../scripts/host/protection.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setupLine, setLineOf } from '../../../scripts/state/card-lines.js';
import { KEEP_HERE } from '../../../scripts/setup/local.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { fileURLToPath } from 'node:url';

const NOW = new Date('2026-10-19T03:00:00.000Z');
const QUIET_STEPS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'helpers', 'setup-quiet-steps.js');
const PLUGIN = '/Applications/Plug ins/wheelhouse';
const SETUP_PLAIN_RULE = `Bash(node "${PLUGIN}/scripts/setup/cli.js":*)`;
const SETUP_FLAGGED_RULE = `Bash(node --no-use-system-ca "${PLUGIN}/scripts/setup/cli.js":*)`;
const SETUP_RULES = [SETUP_PLAIN_RULE, SETUP_FLAGGED_RULE];
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// ---- A fake computer: what `run` finds and does ----

// state: { platform, clt (macOS command-line tools in), paths: { tool: path }, versions: { tool: text },
// installerOpen, installs (xcode-select --install calls), opened (Start-Process lines), unpacked }
function machine(state) {
  const s = { platform: 'darwin', clt: true, paths: {}, versions: {}, installerOpen: false, installs: 0, opened: [], unpacked: [], calls: [], ...state };
  const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  const toolOf = (file) => Object.entries(s.paths).find(([, p]) => p === file)?.[0];
  s.run = async (file, args = [], options = {}) => {
    s.calls.push({ file, args: [...args], cwd: options.cwd, env: options.env });
    s.looked?.(file, args);
    const name = file.split(/[\\/]/).pop();
    if (name === 'which' || name === 'where') return s.paths[args[0]] ? answer(`${s.paths[args[0]]}\n`) : answer('', 1);
    if (name === 'xcode-select' && args[0] === '-p') return s.clt ? answer('/Library/Developer/CommandLineTools\n') : answer('', 2);
    if (name === 'xcode-select' && args[0] === '--install') {
      s.installs += 1;
      s.installerOpen = true;
      return answer('xcode-select: note: install requested for command line developer tools\n');
    }
    if (name === 'pgrep') return s.installerOpen && args[1] === MAC_INSTALLER ? answer('4242\n') : answer('', 1);
    if (name === 'tasklist') return s.installerOpen ? answer(`"${s.installerImage}","${args[1].split(' ').pop()}","Console","1","40,000 K"\n`) : answer('INFO: No tasks are running which match the specified criteria.\n');
    if (name === 'powershell.exe') {
      s.opened.push({ args: [...args], env: options.env, folder: s.watchFolder?.() });
      s.installerOpen = true;
      return answer('5150\n');
    }
    if (/^tar(\.exe)?$/.test(name)) {
      const [, given, , givenInto] = args;
      const archive = path.resolve(options.cwd ?? '.', given);
      const into = path.resolve(options.cwd ?? '.', givenInto);
      s.unpacked.push({ archive, into, bytes: fs.readFileSync(archive), args: [...args], cwd: options.cwd });
      const tool = path.basename(archive).split('_')[0];
      const binary = `${tool}${s.platform === 'win32' ? '.exe' : ''}`;
      fs.mkdirSync(path.join(into, `${tool}_x`, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(into, `${tool}_x`, 'bin', binary), `#!/bin/sh\necho ${tool}\n`);
      return answer('');
    }
    if (args[0] === '--version') {
      const tool = toolOf(file) ?? path.basename(file).replace(/\.exe$/, '');
      // A copy in Wheelhouse's tools folder, or being put there.
      if (file === fetchedPathOf(tool, s.platform) || file.includes(`${path.sep}tools${path.sep}`)) return answer(`${tool} version 2.102.0 (2026-09-30)\n`);
      const version = s.versions[tool];
      if (version === undefined) return answer('', 1);
      return answer(tool === 'node' ? `v${version}\n` : `${tool} version ${version}\n`);
    }
    return answer('', 1);
  };
  return s;
}
const fetchedPathOf = (tool, platform) => {
  try {
    return fetchedPath(tool, { platform });
  } catch {
    return null;
  }
};

const everythingHere = { paths: { git: '/usr/bin/git', node: '/usr/local/bin/node', gh: '/opt/homebrew/bin/gh', glab: '/opt/homebrew/bin/glab' }, versions: { git: '2.39.5', node: '22.3.0', gh: '2.97.0', glab: '1.123.0' } };

// ---- A fake internet: the official release pages ----

const GH_TAG = 'v2.102.0';
const GH_NAMES = ['gh_2.102.0_macOS_arm64.zip', 'gh_2.102.0_macOS_amd64.zip', 'gh_2.102.0_macOS_universal.pkg', 'gh_2.102.0_windows_amd64.zip', 'gh_2.102.0_windows_amd64.msi', 'gh_2.102.0_linux_amd64.tar.gz'];
const GIT_TAG = 'v2.56.0.windows.2';
const GIT_NAME = 'Git-2.56.0.2-64-bit.exe';
const GIT_BYTES = Buffer.from('the official Git for Windows installer');

const GLAB_TAG = 'v1.123.0';
const GLAB_NAMES = ['glab_1.123.0_darwin_arm64.tar.gz', 'glab_1.123.0_darwin_amd64.tar.gz', 'glab_1.123.0_windows_amd64.zip', 'glab_1.123.0_Windows_x86_64_installer.exe'];
const glabUrl = (name) => `https://gitlab.com/gitlab-org/cli/-/releases/${GLAB_TAG}/downloads/${name}`;

function internet({ tamper = false, glabLink = {} } = {}) {
  const calls = [];
  const archive = (name) => Buffer.from(`archive ${name}`);
  const sums = GH_NAMES.map((name) => `${sha(archive(name))}  ${name}`).join('\n');
  const notes = `<table><thead><tr><th>Filename</th><th>SHA-256</th></tr></thead><tbody>
<tr>
<td>${GIT_NAME}</td>
<td>${sha(GIT_BYTES)}</td>
</tr>
<tr>
<td>Git-2.56.0.2-arm64.exe</td>
<td>${'b'.repeat(64)}</td>
</tr>
<tr>
<td>PortableGit-2.56.0.2-64-bit.7z.exe</td>
<td>${'c'.repeat(64)}</td>
</tr></tbody></table>`;
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url === 'https://github.com/cli/cli/releases/latest' && init.redirect === 'manual') {
      return new Response(null, { status: 302, headers: { location: `https://github.com/cli/cli/releases/tag/${GH_TAG}` } });
    }
    if (url === `https://github.com/cli/cli/releases/download/${GH_TAG}/gh_2.102.0_checksums.txt`) return new Response(sums);
    const ghFile = GH_NAMES.find((name) => url === `https://github.com/cli/cli/releases/download/${GH_TAG}/${name}`);
    if (ghFile) {
      const bytes = archive(ghFile);
      return new Response(tamper ? Buffer.concat([Buffer.from([bytes[0] ^ 1]), bytes.subarray(1)]) : bytes);
    }
    if (url === 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest') {
      const links = [...GLAB_NAMES, 'checksums.txt'].map((name) => ({ name, direct_asset_url: glabLink[name] ?? glabUrl(name) }));
      return Response.json({ tag_name: GLAB_TAG, assets: { links } });
    }
    if (url === glabUrl('checksums.txt')) return new Response(GLAB_NAMES.map((name) => `${sha(archive(name))}  ${name}`).join('\n'));
    const glabFile = GLAB_NAMES.find((name) => url === glabUrl(name));
    if (glabFile) return new Response(archive(glabFile));
    if (url === 'https://github.com/git-for-windows/git/releases/latest' && init.redirect === 'manual') {
      return new Response(null, { status: 302, headers: { location: `https://github.com/git-for-windows/git/releases/tag/${GIT_TAG}` } });
    }
    if (url === `https://github.com/git-for-windows/git/releases/tag/${GIT_TAG}`) return new Response(notes);
    if (url === `https://github.com/git-for-windows/git/releases/download/${GIT_TAG}/${GIT_NAME}`) {
      return new Response(tamper ? Buffer.from('a swapped installer') : GIT_BYTES);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls, archive };
}

const noFetch = async (url) => assert.fail(`nothing is fetched here, but ${url} was`);
const ctxFor = (folder, extra = {}) => ({ folder, step: 2, now: () => NOW, platform: 'darwin', userHome: folder, answers: {}, ...extra });

// ---- toolsStatus ----

test('Node.js below 22 counts as missing', async () => {
  for (const [version, ok] of [['20.9.0', false], ['21.99.99', false], ['22.0.0', true], ['22.3.0', true], ['24.1.0', true]]) {
    const m = machine({ ...everythingHere, versions: { ...everythingHere.versions, node: version } });
    const status = await toolsStatus({ platform: 'darwin', run: m.run, env: {} });
    assert.deepEqual(status.node, { found: true, version, path: '/usr/local/bin/node', ok }, version);
  }
  const none = machine({ ...everythingHere, paths: { ...everythingHere.paths, node: undefined } });
  assert.deepEqual((await toolsStatus({ platform: 'darwin', run: none.run, env: {} })).node, { found: false, version: null, path: null, ok: false });
});

test('on a Mac, git counts only once Apple\'s command-line tools are in, and /usr/bin/git is never run before', async () => {
  const m = machine({ ...everythingHere, clt: false });
  const status = await toolsStatus({ platform: 'darwin', run: m.run, env: {}, hostTools: ['gh'] });
  assert.deepEqual(status.git, { found: false, version: null, path: null, ok: false });
  assert.ok(!m.calls.some((c) => c.file === '/usr/bin/git'), 'running /usr/bin/git would open Apple\'s window');
  assert.deepEqual(Object.keys(status), ['git', 'node', 'gh']);
  // A git of the director's own elsewhere counts.
  const own = machine({ ...everythingHere, clt: false, paths: { ...everythingHere.paths, git: '/opt/homebrew/bin/git' } });
  assert.equal((await toolsStatus({ platform: 'darwin', run: own.run, env: {} })).git.ok, true);
});

test('the project\'s host decides which of gh and glab it needs, none for one kept here, both while a new product\'s place is open', () => {
  const folder = tempFolder('wh-host Zoë ');
  assert.deepEqual(hostToolsFor(folder), ['gh', 'glab']);
  fs.mkdirSync(path.join(folder, '.git'));
  const config = (url) => fs.writeFileSync(path.join(folder, '.git', 'config'), `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://gitlab.com/x/y.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`);
  config('git@github.com:a-director/product.git');
  assert.deepEqual(hostToolsFor(folder), ['gh']);
  config('https://gitlab.com/group/product.git');
  assert.deepEqual(hostToolsFor(folder), ['glab']);
  config('https://git.example.org/team/product.git');
  assert.deepEqual(hostToolsFor(folder), ['glab'], 'another remote names GitLab');
  fs.writeFileSync(path.join(folder, '.git', 'config'), '[remote "origin"]\n\turl = https://git.example.org/team/product.git\n');
  assert.deepEqual(hostToolsFor(folder), []);
  const empty = tempFolder('wh-host Zoë ');
  const said = (label) => ({ label, text: null, at: 'x' });
  assert.deepEqual(hostToolsFor(empty, { '3.join': said(KEEP_HERE) }), []);
  assert.deepEqual(hostToolsFor(empty, { '3.host': said('GitLab') }), ['glab']);
  assert.deepEqual(hostToolsFor(empty, { '3.join': said('GitHub') }), ['gh']);
});

// ---- The installers ----

test('each installer is fetched into an empty folder and checked before it is opened', async () => {
  // Windows: Git for Windows' installer, from its release, into a new folder that holds nothing else.
  const tempRoot = tempFolder('wh-temp ');
  const net = internet();
  const m = machine({ platform: 'win32', installerImage: GIT_NAME });
  m.watchFolder = () => fs.readdirSync(tempRoot).map((d) => [d, fs.readdirSync(path.join(tempRoot, d))]);
  const recorded = [];
  const started = await startInstaller({ tool: 'git', platform: 'win32', arch: 'x64', run: m.run, fetch: net.fetch, tempRoot, record: (c) => recorded.push(c), sleep: async () => {} });
  assert.equal(started.started, true);
  assert.equal(started.waitsFor, 'admin');
  assert.equal(started.pid, 5150);
  assert.equal(m.opened.length, 1);
  const [[folder, inside]] = m.opened[0].folder;
  assert.match(folder, /^wheelhouse-git-/);
  assert.deepEqual(inside, [GIT_NAME], 'the folder held only the installer when it was opened');
  assert.equal(started.image, path.join(tempRoot, folder, GIT_NAME));
  assert.deepEqual(fs.readFileSync(started.image), GIT_BYTES);
  assert.deepEqual(recorded.map((c) => [c.kind, c.target, c.before]), [['folder', path.join(tempRoot, folder), null]]);
  // macOS: Apple's own window; nothing is fetched.
  const mac = machine({ clt: false });
  const onMac = await startInstaller({ tool: 'git', platform: 'darwin', run: mac.run, fetch: noFetch, sleep: async () => {} });
  assert.deepEqual(onMac, { started: true, waitsFor: 'click', pid: 4242, image: MAC_INSTALLER });
  assert.equal(mac.installs, 1);
});

test('a checksum that does not match is refused and nothing is opened', async () => {
  await withHome(async () => {
    const tempRoot = tempFolder('wh-temp ');
    const m = machine({ platform: 'win32' });
    await assert.rejects(
      startInstaller({ tool: 'git', platform: 'win32', arch: 'x64', run: m.run, fetch: internet({ tamper: true }).fetch, tempRoot }),
      (error) => error instanceof ChecksumError && /does not match its published checksum/.test(error.message),
    );
    assert.deepEqual(m.opened, []);
    assert.deepEqual(fs.readdirSync(tempRoot), [], 'nothing was written');
    // gh: refused before anything is unpacked, and no tools folder is made.
    const ghMachine = machine({});
    await assert.rejects(fetchHostTool({ tool: 'gh', platform: 'darwin', arch: 'arm64', fetch: internet({ tamper: true }).fetch, run: ghMachine.run }), ChecksumError);
    assert.deepEqual(ghMachine.unpacked, []);
    assert.equal(fs.existsSync(toolFolder('gh')), false);
    assert.equal(toolPath('gh'), 'gh');
  });
});

test('the installer is picked by matching the release\'s names, and only one may match', () => {
  // As the release page shows the table, with or without attributes on a cell.
  const page = notesChecksums(`<tr>\n<td>${GIT_NAME}</td>\n<td>${'a'.repeat(64)}</td>\n</tr><tr><td align="left">Git-2.56.0.2-arm64.exe</td><td align="left">${'b'.repeat(64)}</td></tr>`);
  assert.deepEqual([...page.entries()], [[GIT_NAME, 'a'.repeat(64)], ['Git-2.56.0.2-arm64.exe', 'b'.repeat(64)]]);
  const names = [...notesChecksums(`${GIT_NAME} | ${'a'.repeat(64)}\nGit-2.56.0.2-arm64.exe | ${'b'.repeat(64)}\nPortableGit-2.56.0.2-64-bit.7z.exe | ${'c'.repeat(64)}\nMinGit-2.56.0.2-64-bit.zip | ${'d'.repeat(64)}`).keys()];
  assert.equal(names.length, 4);
  assert.equal(pickInstaller(names, 'x64'), GIT_NAME);
  assert.equal(pickInstaller(names, 'arm64'), 'Git-2.56.0.2-arm64.exe');
  assert.throws(() => pickInstaller(names, 'ia32'), /processor/);
  assert.throws(() => pickInstaller([...names, 'Git-2.57.0-64-bit.exe'], 'x64'), /found 2/);
});

// ---- gh and glab ----

// It fetches the Mac build and has the adapter run it as a Mac does, so on Windows it is skipped there;
// the Windows build's fetch is checked in 'an installer path with a space is quoted'.
test('gh is fetched into the tools folder and the adapter runs that copy', { skip: process.platform === 'win32' && 'the Mac build, run as on a Mac' }, async () => {
  await withHome(async () => {
    const net = internet();
    const m = machine({});
    const recorded = [];
    const got = await fetchHostTool({ tool: 'gh', platform: 'darwin', arch: 'arm64', fetch: net.fetch, run: m.run, record: (c) => recorded.push(c) });
    assert.deepEqual(got, { path: path.join(toolFolder('gh'), 'bin', 'gh'), version: '2.102.0' });
    // The archive for this Mac, checked before it was unpacked, unpacked without -P in a new folder.
    assert.equal(m.unpacked.length, 1);
    assert.equal(path.basename(m.unpacked[0].archive), 'gh_2.102.0_macOS_arm64.zip');
    assert.deepEqual(m.unpacked[0].bytes, net.archive('gh_2.102.0_macOS_arm64.zip'));
    assert.ok(!m.unpacked[0].args.includes('-P'));
    assert.deepEqual(m.unpacked[0].args, ['-xf', 'gh_2.102.0_macOS_arm64.zip', '-C', 'unpacked']);
    assert.equal(fs.statSync(got.path).mode & 0o111, 0o111, 'it can be run');
    assert.equal(fs.readFileSync(path.join(toolFolder('gh'), 'version'), 'utf8'), `${GH_TAG}\n`);
    assert.deepEqual(fs.readdirSync(path.dirname(toolFolder('gh'))), ['gh'], 'the unpacking folder is gone');
    assert.deepEqual(recorded.map((c) => [c.kind, c.target, c.before, c.after]), [['folder', toolFolder('gh'), null, { tool: 'gh', version: GH_TAG }]]);
    // The adapter and the protection calls run that copy.
    assert.equal(toolPath('gh'), got.path);
    const calls = [];
    const fake = async (file, args) => {
      calls.push(file);
      return { code: 0, stdout: '{"defaultBranchRef":{"name":"main"}}', stderr: '' };
    };
    await makeAdapter({ host: 'github', repo: 'a-director/product', run: fake, env: {} }).defaultBranch();
    await protectionStatus({ host: 'github', repo: 'a-director/product', run: fake }).catch(() => {});
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((file) => file === got.path), calls.join(', '));
    // glab, not fetched, is still run by its name.
    assert.equal(toolPath('glab'), 'glab');
    // Fetched again (a newer release), the copy is replaced and its version before recorded.
    await fetchHostTool({ tool: 'gh', platform: 'darwin', arch: 'arm64', fetch: net.fetch, run: m.run, record: (c) => recorded.push(c) });
    assert.deepEqual(recorded[1].before, { version: GH_TAG });
  });
});

// ---- Paths with spaces ----

test('an installer path with a space is quoted', async () => {
  // `run` has no shell, so a path is one argument as it is; only the line PowerShell reads as a
  // command quotes it, with a quote inside it doubled.
  // PowerShell takes ‘ ’ ‚ ‛ as single quotes too, so the path never goes into the command's
  // text: it reaches Start-Process through the environment, whatever it holds.
  for (const name of ["wh-Jo Smith O'Brien Zoë ", 'wh-Zoë O’Brien ‘‚‛ $(x) ']) {
    const tempRoot = tempFolder(name);
    const m = machine({ platform: 'win32', installerImage: GIT_NAME });
    const started = await startInstaller({ tool: 'git', platform: 'win32', arch: 'x64', run: m.run, fetch: internet().fetch, tempRoot, sleep: async () => {} });
    const { args, env } = m.opened[0];
    assert.equal(args.length, 4);
    assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
    assert.equal(args[3], `(Start-Process -FilePath $env:WHEELHOUSE_INSTALLER -ArgumentList ${GIT_INSTALLER_ARGS.map((a) => `'${a}'`).join(',')} -PassThru).Id`);
    assert.equal(env.WHEELHOUSE_INSTALLER, started.image);
    assert.ok(started.image.startsWith(tempRoot), name);
  }
  assert.deepEqual(openCommand('C:\\Users\\Jo O’Brien\\Git.exe', [], { systemRoot: 'C:\\Windows' }), {
    file: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', '(Start-Process -FilePath $env:WHEELHOUSE_INSTALLER -PassThru).Id'],
    env: { WHEELHOUSE_INSTALLER: 'C:\\Users\\Jo O’Brien\\Git.exe' },
  });
  // gh's archive, in a home with a space and an accent, reaches tar as one argument.
  await withHome(async () => {
    const tar = machine({ platform: 'win32' });
    await fetchHostTool({ tool: 'gh', platform: 'win32', arch: 'x64', fetch: internet().fetch, run: tar.run });
    // tar runs in the unpacking folder, with names relative to it, so a home outside the system's
    // code page never reaches tar's own arguments.
    const [archive] = tar.unpacked;
    assert.deepEqual(archive.args, ['-xf', 'gh_2.102.0_windows_amd64.zip', '-C', 'unpacked']);
    assert.ok(archive.cwd.includes(' ') && archive.cwd.startsWith(path.dirname(toolFolder('gh'))), archive.cwd);
    assert.equal(fs.existsSync(archive.cwd), false, 'the unpacking folder is gone');
    assert.match(tar.calls.find((c) => /tar\.exe$/.test(c.file)).file, /System32[\\/]tar\.exe$/);
    assert.equal(toolPath('gh', { platform: 'win32' }), path.join(toolFolder('gh'), 'bin', 'gh.exe'));
  }, { prefix: 'wh-home Jo Smith Zoë ' });
});

// ---- Step 2 ----

test('Node.js missing or too old stops setup with the README\'s line, and nothing is installed', async () => {
  for (const node of [undefined, '20.9.0']) {
    const folder = tempFolder('wh-node ');
    const m = machine({ clt: false, paths: { node: node && '/usr/local/bin/node' }, versions: { node } });
    const step = toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot: PLUGIN, env: {} });
    await assert.rejects(step.plan(ctxFor(folder)), (error) => error.message.startsWith(NODE_LINE) && error.message.includes(node ?? 'not found'));
    assert.equal(m.installs, 0);
    assert.ok(!m.calls.some((c) => c.args.includes('--install')));
    assert.equal(fs.existsSync(path.join(folder, '.claude')), false);
  }
  // The line says what to do when every tool is refused for want of node (check 35).
  assert.match(NODE_LINE, /Node\.js 22 or later/);
  assert.match(NODE_LINE, /node: command not found/);
  assert.match(NODE_LINE, /Wheelhouse script/);
  assert.match(NODE_LINE, /nodejs\.org/);
  assert.match(nodeRefusal({ found: true, version: '20.9.0' }), /20\.9\.0.*22\.0\.0 or later/);
});

test('the install commands name Wheelhouse\'s own marketplace, at a release tag, at project scope', () => {
  assert.deepEqual(INSTALL_COMMANDS, [
    'claude plugin marketplace add "where-is-brett/wheelhouse#<tag>" --scope project',
    'claude plugin install wheelhouse@wheelhouse --scope project',
  ]);
  // Never the bare name, which another publisher's plugin can answer to.
  for (const command of INSTALL_COMMANDS) assert.doesNotMatch(command, /--marketplace|install wheelhouse(?!@wheelhouse)/);
});

test('with everything here, the list is only the allow rule, written by key beside the director\'s own, and put back', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj Zoë '));
    const file = path.join(folder, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '{"permissions":{"allow":["Bash(ls:*)"]},"theirs":1}\n');
    const m = machine(everythingHere);
    const step = toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot: PLUGIN, env: {} });
    const planned = await step.plan(ctxFor(folder));
    assert.deepEqual(planned.changes, [{ kind: 'json-key', target: file, key: ['permissions', 'allow'], after: ['Bash(ls:*)', ...SETUP_RULES], added: SETUP_RULES.length }]);
    assert.match(planned.card.what, /two permission rules/);
    assert.equal(planned.director, 'One click');
    // The same world gives the same list, so the hash a card names stays good.
    assert.equal(planHash((await step.plan(ctxFor(folder))).changes), planHash(planned.changes));
    const hash = planHash(planned.changes);
    const { question } = composeCard({ ...planned.card, target: { step: 2, hash } });
    assert.equal(setLineOf(question.question), setupLine(2, hash));
    const run = startRun({ folder, now: () => NOW });
    markStep(run.id, 2, 'clickedAt', { now: () => NOW });
    assert.deepEqual(await runApply({ step, runId: run.id, changes: planned.changes, ctx: ctxFor(folder, { runId: run.id }) }), { ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(ls:*)', ...SETUP_RULES] }, theirs: 1 });
    // Planned again, nothing is left to change, so the step settles with no Go ahead (ruling R75).
    assert.deepEqual(await step.plan(ctxFor(folder)), { settled: { record: { nothing: true } } });
    const [change] = findRun(folder).changes;
    assert.deepEqual(reverseChange(change), { put: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(ls:*)'] }, theirs: 1 });
  });
});

test('a plain rule already in leaves only the flagged rule to add, and the plain one is not repeated', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const file = path.join(folder, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow: [SETUP_PLAIN_RULE] } }));
    const step = toolsStep({ engine: null, run: machine(everythingHere).run, fetch: noFetch, pluginRoot: PLUGIN, env: {} });
    const planned = await step.plan(ctxFor(folder));
    assert.deepEqual(planned.changes, [{ kind: 'json-key', target: file, key: ['permissions', 'allow'], after: [SETUP_PLAIN_RULE, SETUP_FLAGGED_RULE], added: 1 }]);
    assert.match(planned.card.what, /one permission rule/);
  });
});

test('through the helper, step 2 with everything here and the rule in settles: its { nothing } answer and its done mark, no card', async () => {
  await withHome(async (home) => {
    const user = fs.realpathSync.native(tempFolder('wh-user zoë '));
    const folder = path.join(user, 'Projects', 'Café Menu');
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'quiet-world.json'), JSON.stringify({ pluginRoot: PLUGIN }));
    const routes = setupRoutes({ now: () => NOW, userHome: user, platform: 'darwin', stepsModule: QUIET_STEPS });
    // Without the rule, the rule is the list, on a card.
    const card = await routes['/setup/plan']({ folder, step: 2 });
    assert.equal(card.ok, true, card.refused);
    assert.deepEqual(card.changes.map((c) => c.after), [SETUP_RULES]);
    fs.writeFileSync(path.join(folder, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: SETUP_RULES } }));
    assert.deepEqual(await routes['/setup/plan']({ folder, step: 2 }), { ok: true, done: true });
    const run = findRun(folder);
    assert.equal(run.steps[2].doneAt, NOW.toISOString());
    assert.deepEqual(run.changes.filter((c) => c.step === 2).map((c) => [c.kind, c.target, c.before, c.after]), [['answer', 'step 2', null, { nothing: true }]]);
  });
});

test('git\'s installer starts at once and the step hands back', async () => {
  await withHome(async () => {
    assert.equal(STEPS[1].long, true, 'step 2 runs in its own process, so the helper hands back at once');
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const m = machine({ ...everythingHere, clt: false, paths: { ...everythingHere.paths, gh: undefined, glab: undefined } });
    const net = internet();
    let looks = 0;
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    // Each look while it waits: the third finds the tools in.
    const sleep = async () => {
      looks += 1;
      if (looks === 1) await finished;
      if (looks === 2) m.clt = true;
    };
    const step = toolsStep({ engine: null, run: m.run, fetch: net.fetch, arch: 'arm64', pluginRoot: PLUGIN, env: {}, sleep, pollMs: 1 });
    fs.mkdirSync(path.join(folder, '.git'));
    fs.writeFileSync(path.join(folder, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/a-director/product.git\n');
    const planned = await step.plan(ctxFor(folder));
    assert.deepEqual(planned.changes.map((c) => [c.kind, c.action ?? null]), [['process', 'install'], ['folder', 'fetch'], ['json-key', null]]);
    assert.equal(planned.changes[1].tool, 'gh', 'only the host\'s tool');
    assert.match(planned.card.what, /Apple's own window/);
    assert.match(planned.director, /Install and Agree/);
    const run = startRun({ folder, now: () => NOW });
    markStep(run.id, 2, 'clickedAt', { now: () => NOW });
    const applying = runApply({ step, runId: run.id, changes: planned.changes, ctx: ctxFor(folder, { runId: run.id, stopped: () => false }) });
    // While it waits, the installer is already in the journal, and gh and the rule are done.
    while (looks === 0) await new Promise((resolve) => { setImmediate(resolve); });
    const kinds = findRun(folder).changes.map((c) => [c.kind, c.after?.tool ?? null]);
    assert.deepEqual(kinds.filter(([k]) => k === 'process'), [['process', 'git']]);
    assert.ok(kinds.some(([k, t]) => k === 'folder' && t === 'gh'));
    assert.ok(kinds.some(([k]) => k === 'json-key'));
    const installer = findRun(folder).changes.find((c) => c.kind === 'process');
    assert.deepEqual(installer.after, { tool: 'git', pid: 4242, startedAt: NOW.toISOString(), image: MAC_INSTALLER });
    assert.equal(installer.before, null);
    assert.equal(m.installs, 1);
    // Planned again meanwhile (a retry after the step's time ran out), it waits for the open
    // installer, and starts no second one.
    const again = await step.plan(ctxFor(folder, { runId: run.id }));
    assert.deepEqual(again.changes[0], { kind: 'process', target: 'git', action: 'wait' });
    assert.match(again.card.what, /already open/);
    finish();
    assert.deepEqual(await applying, { ok: true });
    assert.equal(typeof findRun(folder).steps[2].doneAt, 'string');
    assert.equal(m.installs, 1, 'one installer');
    assert.equal(looks, 2);
  });
});

test('a wait on an open installer starts none, and an installer closed before git was in fails the step', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const m = machine({ ...everythingHere, clt: false, installerOpen: true });
    const run = startRun({ folder, now: () => NOW });
    // An installer from an earlier attempt, still open.
    const { addChanges, newId } = await import('../../../scripts/setup/journal.js');
    addChanges(run.id, [{ id: newId('chg'), step: 2, kind: 'process', target: MAC_INSTALLER, before: null, after: { tool: 'git', pid: 4242, startedAt: NOW.toISOString(), image: MAC_INSTALLER } }]);
    let looks = 0;
    let clock = NOW.getTime();
    const now = () => new Date(clock);
    const sleep = async () => {
      looks += 1;
      clock += 60 * 1000;
      if (looks === 2) m.installerOpen = false; // the director closed it with Not Now
    };
    const step = toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot: PLUGIN, env: {}, sleep, pollMs: 60 * 1000 });
    const planned = await step.plan(ctxFor(folder, { runId: run.id }));
    assert.deepEqual(planned.changes.slice(0, 1), [{ kind: 'process', target: 'git', action: 'wait' }]);
    markStep(run.id, 2, 'clickedAt', { now: () => NOW });
    const done = await runApply({ step, runId: run.id, changes: planned.changes, ctx: ctxFor(folder, { runId: run.id, now, stopped: () => false }) });
    assert.equal(m.installs, 0);
    assert.equal(done.ok, false);
    assert.match(done.reason, /git installer closed before it finished/);
    assert.match(findRun(folder).steps[2].failed, /closed before it finished/);
    // With it closed, a fresh plan starts it again.
    assert.deepEqual((await step.plan(ctxFor(folder, { runId: run.id }))).changes[0], { kind: 'process', target: 'git', action: 'install', waitsFor: 'click' });
  });
});

test('STOP while the installer runs ends the step and leaves the installer to finish', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const m = machine({ ...everythingHere, clt: false });
    const step = toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot: PLUGIN, env: {}, sleep: async () => {}, pollMs: 1 });
    const planned = await step.plan(ctxFor(folder));
    const run = startRun({ folder, now: () => NOW });
    markStep(run.id, 2, 'clickedAt', { now: () => NOW });
    let stop = false;
    const done = runApply({ step, runId: run.id, changes: planned.changes, ctx: ctxFor(folder, { runId: run.id, stopped: () => stop }) });
    stop = true;
    assert.match((await done).reason, /All stop/);
    assert.equal(m.installs, 1);
    assert.equal(m.installerOpen, true);
  });
});

test('the longest list\'s card composes within the card\'s length, on a Mac and on Windows', async () => {
  await withHome(async () => {
    for (const [platform, pluginRoot] of [['darwin', PLUGIN], ['win32', 'C:\\Users\\Jo Smith\\AppData\\Roaming\\Claude\\plugins\\wheelhouse']]) {
      const folder = tempFolder('wh-card ');
      const m = machine({ platform, clt: false, paths: { node: '/usr/local/bin/node' }, versions: { node: '22.3.0' } });
      const planned = await toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot, env: {} }).plan(ctxFor(folder, { platform }));
      assert.deepEqual(planned.changes.map((c) => c.action ?? c.kind), ['install', 'fetch', 'fetch', 'json-key'], platform);
      const { question } = composeCard({ ...planned.card, target: { step: 2, hash: planHash(planned.changes) } });
      assert.ok(question.question.includes('gh and glab'), question.question);
      assert.match(question.question, platform === 'darwin' ? /Apple's own window/ : /Windows asks you to allow it/);
    }
  });
});

test('glab is fetched from GitLab\'s release, picked from its links and checked against its checksums', async () => {
  await withHome(async () => {
    const net = internet();
    const m = machine({});
    const got = await fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: net.fetch, run: m.run });
    assert.deepEqual(got, { path: path.join(toolFolder('glab'), 'bin', 'glab'), version: '1.123.0' });
    assert.deepEqual(m.unpacked[0].bytes, net.archive('glab_1.123.0_darwin_arm64.tar.gz'));
    assert.deepEqual(net.calls, [
      'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest',
      glabUrl('checksums.txt'),
      glabUrl('glab_1.123.0_darwin_arm64.tar.gz'),
    ]);
    assert.equal(fs.readFileSync(path.join(toolFolder('glab'), 'version'), 'utf8'), `${GLAB_TAG}\n`);
    assert.equal(toolPath('glab', { platform: 'darwin' }), got.path, 'the Mac build, found as a Mac finds it');
  });
});

test('a release file anywhere but its official host is refused, and nothing is fetched from it', async () => {
  await withHome(async () => {
    for (const glabLink of [
      { 'glab_1.123.0_darwin_arm64.tar.gz': 'https://downloads.example.com/glab.tar.gz' },
      { 'checksums.txt': 'https://gitlab.com.example.com/checksums.txt' },
      { 'glab_1.123.0_darwin_arm64.tar.gz': 'http://gitlab.com/gitlab-org/cli/glab.tar.gz' },
    ]) {
      const net = internet({ glabLink });
      const m = machine({});
      await assert.rejects(fetchHostTool({ tool: 'glab', platform: 'darwin', arch: 'arm64', fetch: net.fetch, run: m.run }), /not on gitlab\.com/);
      assert.ok(net.calls.every((url) => url.startsWith('https://gitlab.com/')), net.calls.join(', '));
      assert.deepEqual(m.unpacked, []);
      assert.equal(fs.existsSync(toolFolder('glab')), false);
    }
  });
});

test('the rule is written only once each installer\'s start is recorded', async () => {
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const m = machine({ ...everythingHere, clt: false });
    const step = toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot: PLUGIN, env: {}, sleep: async () => {} });
    const planned = await step.plan(ctxFor(folder));
    assert.deepEqual(planned.changes.map((c) => c.kind), ['process', 'json-key']);
    const order = [];
    const ctx = ctxFor(folder, {
      record: (change) => order.push(change.kind),
      applyJsonKey: () => {
        order.push('json-key');
        throw new Error('the settings file is held by another program');
      },
    });
    await assert.rejects(step.apply(ctx, planned.changes), /held by another program/);
    assert.deepEqual(order, ['process', 'json-key']);
  });
});

test('on a Mac, an installer window not seen for two minutes of looks fails the step; one seen again in time does not', async () => {
  // Ruling R55: completion is read only by xcode-select -p; not seeing Apple's window fails the
  // step only after two minutes without it, not after a few looks.
  await withHome(async () => {
    for (const comesBack of [false, true]) {
      const folder = fs.realpathSync.native(tempFolder('wh-proj '));
      const m = machine({ ...everythingHere, clt: false });
      let clock = NOW.getTime();
      const seen = [];
      const sleep = async () => {
        clock += 30 * 1000;
        const after = clock - NOW.getTime();
        if (after === 30 * 1000) m.installerOpen = false; // not seen from 30 s on
        if (comesBack && after === 120 * 1000) m.installerOpen = true; // seen again at 2 minutes
        if (comesBack && after === 150 * 1000) m.clt = true; // and then finishes
        seen.push(after);
      };
      const step = toolsStep({ engine: null, run: m.run, fetch: noFetch, pluginRoot: PLUGIN, env: {}, sleep, pollMs: 30 * 1000 });
      const now = () => new Date(clock);
      const planned = await step.plan(ctxFor(folder, { now }));
      const run = startRun({ folder, now });
      markStep(run.id, 2, 'clickedAt', { now });
      const done = await runApply({ step, runId: run.id, changes: planned.changes, ctx: ctxFor(folder, { runId: run.id, now, stopped: () => false }) });
      if (comesBack) {
        assert.deepEqual(done, { ok: true });
        assert.equal(m.installs, 1);
      } else {
        assert.equal(done.ok, false);
        assert.match(done.reason, /closed before it finished/);
        // Last seen at 0 s: not failed at 2:00 minus a look, failed at the first look 2 minutes on.
        assert.equal(seen.at(-1), 120 * 1000);
      }
    }
  });
});

test('step 2 lists the engine folder, Archon\'s settings and the broker', async () => {
  const { engineChanges, applyEngine, brokerLauncher, brokerText, engineWanted } = await import('../../../scripts/setup/engine-parts.js');
  const { engineDir, archonHome } = await import('../../../scripts/lib/paths.js');
  const { archonSettingsFile } = await import('../../../scripts/engine/archon/build.js');
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const file = path.join(folder, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow: SETUP_RULES } }));
    const installs = [];
    const engine = {
      wanted: engineWanted,
      changes: engineChanges,
      apply: (changes, opts) => applyEngine(changes, { ...opts, install: async (o) => { installs.push(o.folder); return { ok: true }; } }),
    };
    const step = toolsStep({ engine, run: machine(everythingHere).run, fetch: noFetch, pluginRoot: PLUGIN, env: {} });
    const planned = await step.plan(ctxFor(folder));
    assert.deepEqual(planned.changes, [
      { kind: 'folder', target: engineDir(), action: 'engine', tool: 'archon' },
      { kind: 'file', target: archonSettingsFile(archonHome()), action: 'archon-settings' },
      { kind: 'file', target: brokerLauncher(), action: 'broker' },
    ]);
    assert.match(planned.card.what, /set to run its steps with Claude/);
    assert.match(planned.card.what, /the build engine, Archon/);
    assert.match(planned.card.what, /usage reporting off/);
    assert.match(planned.card.what, /broker/);
    const recorded = [];
    await step.apply({ ...ctxFor(folder), record: (c) => recorded.push(c), applyJsonKey: () => assert.fail('no rule to write') }, planned.changes);
    assert.deepEqual(installs, [engineDir()]);
    assert.equal(fs.readFileSync(brokerLauncher(), 'utf8'), brokerText());
    // Archon's own settings name Claude, so its tier list names an assistant and the health check passes.
    assert.equal(fs.readFileSync(archonSettingsFile(archonHome()), 'utf8'), 'defaultAssistant: claude\n');
    fs.rmSync(archonHome(), { recursive: true, force: true });
    assert.deepEqual(recorded.map((c) => [c.kind, c.target, c.before]), [['file', brokerLauncher(), null]]);
    // On Windows the engine isn't installed yet, so step 2 lists nothing for it.
    const windows = await step.plan(ctxFor(folder, { platform: 'win32' })).catch((error) => error);
    assert.ok(!(windows.changes ?? []).some((c) => c.action === 'engine' || c.action === 'broker'));
  });
});

test('a refused engine install fails step 2 with its plain reason', async () => {
  const { engineChanges, applyEngine, engineWanted } = await import('../../../scripts/setup/engine-parts.js');
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    const engine = { wanted: engineWanted, changes: engineChanges, apply: (changes, opts) => applyEngine(changes, { ...opts, install: async () => ({ ok: false, refused: 'bun-darwin-aarch64.zip: checksum 00 is not the pinned 11' }) }) };
    const step = toolsStep({ engine, run: machine(everythingHere).run, fetch: noFetch, pluginRoot: PLUGIN, env: {} });
    const planned = await step.plan(ctxFor(folder));
    await assert.rejects(step.apply({ ...ctxFor(folder), record: () => {}, applyJsonKey: () => {} }, planned.changes), /checksum 00 is not the pinned 11/);
  });
});

test('a Mac whose projects are all on GitLab gets no engine in step 2', async () => {
  const { engineChanges, applyEngine, engineWanted } = await import('../../../scripts/setup/engine-parts.js');
  // The engine builds on GitHub only: a project whose host isn't chosen yet may be on GitHub.
  assert.equal(engineWanted({ platform: 'darwin', hosts: ['gitlab'] }), false);
  assert.equal(engineWanted({ platform: 'darwin', hosts: ['gitlab', 'github'] }), true);
  assert.equal(engineWanted({ platform: 'darwin', hosts: ['gitlab', null] }), true);
  assert.equal(engineWanted({ platform: 'win32', hosts: ['github'] }), false);
  await withHome(async () => {
    const folder = fs.realpathSync.native(tempFolder('wh-proj '));
    fs.mkdirSync(path.join(folder, '.git'));
    fs.writeFileSync(path.join(folder, '.git', 'config'), '[remote "origin"]\n\turl = https://gitlab.com/o/p.git\n');
    const file = path.join(folder, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow: SETUP_RULES } }));
    const engine = { wanted: engineWanted, changes: engineChanges, apply: applyEngine };
    const step = toolsStep({ engine, run: machine(everythingHere).run, fetch: noFetch, pluginRoot: PLUGIN, env: {} });
    const planned = await step.plan(ctxFor(folder));
    assert.ok(!(planned.changes ?? []).some((c) => c.action === 'engine' || c.action === 'broker' || c.action === 'archon-settings'));
    // With another project on GitHub on this computer, the engine is listed.
    const { writeProject } = await import('../../../scripts/lib/projects.js');
    writeProject('o__q', { folder: tempFolder('wh-other '), remoteUrl: 'https://github.com/o/q.git', host: 'github', repo: 'o/q', connection: { host: 'github', mode: 'quick', project: 'o/q' } });
    const other = await step.plan(ctxFor(folder));
    assert.ok(other.changes.some((c) => c.action === 'engine'));
  });
});
