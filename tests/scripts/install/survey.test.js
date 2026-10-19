// tests/scripts/install/survey.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../../../scripts/lib/run.js';
import { batchSshCommand, commandsIn, deniedByStandard, surveyProject } from '../../../scripts/install/survey.js';
import { g, makeBareRemote } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'install', 'project');

// The fixture copied into `dir`, its dot-claude folder becoming .claude.
function copyFixture(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const target = path.join(to, entry.name === 'dot-claude' ? '.claude' : entry.name);
    if (entry.isDirectory()) copyFixture(path.join(from, entry.name), target);
    else fs.copyFileSync(path.join(from, entry.name), target);
  }
}

// The made-up project in a scratch repository with a bare remote, pushed, its default branch main.
async function makeProject() {
  const remote = await makeBareRemote();
  const folder = path.join(tempFolder('wh-install-'), 'lantern-shop');
  copyFixture(FIXTURE, folder);
  await g(folder, 'init', '--quiet', '-b', 'main');
  await g(folder, 'add', '--all');
  await g(folder, 'commit', '--quiet', '-m', 'Lantern Shop');
  await g(folder, 'remote', 'add', 'origin', remote.url);
  await g(folder, 'push', '--quiet', '-u', 'origin', 'main');
  await g(folder, 'remote', 'set-head', 'origin', 'main');
  return { folder, remote };
}

// A scratch upstream: the project's drafting skill in its first commit, changed in its second;
// a reviewing skill of its own.
async function makeUpstream(folder) {
  const dir = tempFolder('wh-upstream-');
  const put = (relative, text) => {
    const file = path.join(dir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  await g(dir, 'init', '--quiet', '-b', 'main');
  put('skills/drafting/SKILL.md', fs.readFileSync(path.join(folder, '.claude', 'skills', 'drafting', 'SKILL.md'), 'utf8'));
  put('skills/reviewing/SKILL.md', '---\nname: reviewing\ndescription: The kit\'s review.\n---\n\nRead the diff.\n');
  await g(dir, 'add', '--all');
  await g(dir, 'commit', '--quiet', '-m', 'one');
  put('skills/drafting/SKILL.md', '---\nname: drafting\ndescription: Drafts a plan.\n---\n\nA later wording.\n');
  await g(dir, 'add', '--all');
  await g(dir, 'commit', '--quiet', '-m', 'two');
  return dir;
}

const MANIFEST = {
  upstreams: [{
    name: 'kit-a',
    plugin: 'kit-a',
    repo: 'https://example.invalid/kit-a.git',
    ref: 'v1.0.0',
    sha: 'a'.repeat(40),
    folders: [{ path: 'skills/drafting', hash: 'x' }, { path: 'skills/reviewing', hash: 'x' }, { path: 'skills/planning', hash: 'x' }],
    files: [],
  }],
};

// `run`, with gh and glab answered by `hosts` and everything else run for real.
const withHosts = (hosts) => async (file, args, options) => {
  if (file === 'gh' || file === 'glab') {
    if (!hosts[file]) throw new Error(`${file} was not expected`);
    return hosts[file](args);
  }
  return run(file, args, options);
};
const noPrs = withHosts({ gh: () => ({ code: 0, stdout: '[]', stderr: '' }) });

test('a copy of a pinned skill is a copy; the same name with other content is kept and named', async () => {
  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  // The copy with Windows line endings is still a copy.
  const copy = path.join(folder, '.claude', 'skills', 'drafting', 'SKILL.md');
  fs.writeFileSync(copy, fs.readFileSync(copy, 'utf8').replace(/\n/g, '\r\n'));

  const survey = await surveyProject({ folder, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });

  assert.deepEqual(survey.copies, [{ name: 'drafting', path: '.claude/skills/drafting', plugin: 'kit-a' }]);
  assert.deepEqual(survey.keep, [{ name: 'reviewing', path: '.claude/skills/reviewing', why: 'same name, own content' }]);
  assert.deepEqual(survey.skills.map((s) => s.name).sort(), ['drafting', 'reviewing', 'ship-brief', 'shop-design']);
  assert.deepEqual(survey.agents.map((a) => [a.name, a.path]).sort(), [
    ['builder-one', '.claude/agents/builder-one.md'], ['reviewer-one', '.claude/agents/reviewer-one.md'],
  ]);
  assert.deepEqual(survey.commands.map((c) => [c.name, c.path]), [['stock-report', '.claude/commands/stock-report.md']]);
  assert.deepEqual(survey.hooks, [{ event: 'PostToolUse', matcher: 'Edit|Write', command: 'node .claude/hooks/format.js', path: '.claude/settings.json' }]);
});

test('a pinned name with no copy of its upstream to compare with is refused', async () => {
  const { folder } = await makeProject();
  await assert.rejects(
    surveyProject({ folder, manifest: MANIFEST, run: noPrs, upstreams: {}, host: 'github', claudeHome: tempFolder('wh-claude-') }),
    /kit-a/,
  );
});

test('the first version\'s commands that Standard would still refuse are listed', async () => {
  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  const survey = await surveyProject({ folder, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });

  const named = Object.fromEntries(survey.commandsNamed.map((c) => [c.command, c.paths]));
  assert.deepEqual(named['npm test'], ['.claude/agents/builder-one.md', '.claude/skills/ship-brief/SKILL.md']);
  assert.deepEqual(named['git status'], ['.claude/skills/ship-brief/SKILL.md']);
  assert.deepEqual(named['gh pr merge --squash'], ['.claude/agents/reviewer-one.md']);
  assert.deepEqual(named['npm run report'], ['.claude/commands/stock-report.md']);

  const denied = Object.fromEntries(survey.deniedAfterSwitchBack.map((c) => [c.command, c]));
  assert.deepEqual(Object.keys(denied).sort(), ['gh pr create --fill', 'gh pr diff', 'gh pr merge --squash', 'git push origin HEAD', 'npx vercel deploy --prebuilt']);
  assert.deepEqual(denied['git push origin HEAD'].paths, ['.claude/agents/reviewer-one.md', '.claude/skills/ship-brief/SKILL.md']);
  assert.equal(denied['git push origin HEAD'].rule, 'Bash(git push:*)');
  assert.equal(denied['npx vercel deploy --prebuilt'].rule, 'Bash(npx vercel:*)');
  for (const allowed of ['npm test', 'git status', 'npm run lint', 'npm run report']) assert.equal(denied[allowed], undefined, allowed);
});

test('in flight: behind, local changes, open pull requests and worktrees', async () => {
  const { folder, remote } = await makeProject();
  const upstream = await makeUpstream(folder);
  // Two commits reach the remote from elsewhere.
  const other = path.join(tempFolder('wh-other-'), 'other');
  await g(path.dirname(other), 'clone', '--quiet', remote.url, other);
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(other, `shelf-${n}.txt`), `${n}\n`);
    await g(other, 'add', '--all');
    await g(other, 'commit', '--quiet', '-m', `shelf ${n}`);
  }
  await g(other, 'push', '--quiet', 'origin', 'main');
  // A local change, and a worktree with one of its own.
  fs.appendFileSync(path.join(folder, 'README.md'), '\nA local note.\n');
  const worktree = path.join(path.dirname(folder), 'lantern-labels');
  await g(folder, 'worktree', 'add', '--quiet', '-b', 'feature/shelf-labels', worktree);
  fs.writeFileSync(path.join(worktree, 'labels.txt'), 'draft\n');

  const asked = [];
  const github = withHosts({ gh: (args) => { asked.push(args); return { code: 0, stdout: JSON.stringify([{ number: 7, headRefName: 'feature/stock-count' }]), stderr: '' }; } });
  const survey = await surveyProject({ folder, manifest: MANIFEST, run: github, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });
  assert.equal(survey.inFlight.behind, 2);
  assert.equal(survey.inFlight.dirty, true);
  assert.deepEqual(survey.inFlight.prs, [{ number: 7, branch: 'feature/stock-count' }]);
  assert.equal(survey.inFlight.worktrees.length, 1);
  assert.equal(fs.realpathSync(survey.inFlight.worktrees[0].path), fs.realpathSync(worktree));
  assert.equal(survey.inFlight.worktrees[0].branch, 'feature/shelf-labels');
  assert.equal(survey.inFlight.worktrees[0].dirty, true);
  assert.deepEqual(asked[0].slice(0, 2), ['pr', 'list']);
  assert.ok(!asked.flat().some((a) => /merge|close|create|edit/.test(a)), 'only reads the pull requests');

  // On GitLab the merge requests come from glab.
  const gitlab = withHosts({ glab: (args) => { assert.deepEqual(args.slice(0, 2), ['mr', 'list']); return { code: 0, stdout: JSON.stringify([{ iid: 3, source_branch: 'feature/till' }]), stderr: '' }; } });
  const onGitlab = await surveyProject({ folder, manifest: MANIFEST, run: gitlab, upstreams: { 'kit-a': upstream }, host: 'gitlab', claudeHome: tempFolder('wh-claude-') });
  assert.deepEqual(onGitlab.inFlight.prs, [{ number: 3, branch: 'feature/till' }]);
});

test('scheduled tasks, plugins and personal skills are read for the brief', async () => {
  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  const claudeHome = tempFolder('wh-claude-');
  const put = (relative, value) => {
    const file = path.join(claudeHome, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const installed = path.join(claudeHome, 'plugins', 'cache', 'm', 'notes-kit', '1.0.0');
  put('settings.json', {
    enabledPlugins: {
      'notes-kit@market-b': true, 'idle-kit@market-b': false, 'wheelhouse@wheelhouse': true, 'kit-a@wheelhouse': true,
      'superpowers@claude-plugins-official': true, 'quiet-kit@synced': false,
    },
  });
  put('plugins/installed_plugins.json', { version: 2, plugins: { 'notes-kit@market-b': [{ scope: 'user', installPath: installed, version: '1.0.0' }] } });
  put('plugins/cache/m/notes-kit/1.0.0/.claude-plugin/plugin.json', { name: 'notes-kit', description: 'Takes meeting notes.' });
  put('plugins/synced/account_org/manifest.json', {
    plugins: [
      { name: 'chart-kit', description: 'Draws charts.' }, { name: 'quiet-kit', description: 'Switched off.' }, { name: 'mattpocock-skills', description: 'A pinned kit.' },
    ],
  });
  put('skills/letter-writer/SKILL.md', '---\nname: letter-writer\ndescription: Writes letters in my voice.\n---\n\nWrite the letter.\n');

  const survey = await surveyProject({
    folder, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome,
    scheduled: [{ name: 'weekly-stock', folder }, { name: 'elsewhere', folder: path.dirname(folder) }],
  });
  assert.deepEqual(survey.scheduled, [{ name: 'weekly-stock' }]);
  assert.deepEqual(survey.plugins, [
    { id: 'chart-kit@synced', description: 'Draws charts.' },
    { id: 'notes-kit@market-b', description: 'Takes meeting notes.' },
  ]);
  assert.deepEqual(survey.personalSkills, [{ name: 'letter-writer', description: 'Writes letters in my voice.' }]);
});

test('the survey changes nothing in the project but its remote-tracking refs', async () => {
  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  const status = async () => g(folder, 'status', '--porcelain', '--untracked-files=all');
  const before = await status();
  await surveyProject({ folder, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });
  assert.equal(await status(), before);
});

test('with no scheduled list given, scheduled is null, not empty', async () => {
  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  const survey = await surveyProject({ folder, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });
  assert.equal(survey.scheduled, null);
  const given = await surveyProject({ folder, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-'), scheduled: [] });
  assert.deepEqual(given.scheduled, []);
});

test('commands run through pnpm dlx, bunx and yarn dlx are listed and checked', () => {
  assert.deepEqual(commandsIn('pnpm dlx vercel deploy --prod && bunx netlify deploy'), ['pnpm dlx vercel deploy --prod', 'bunx netlify deploy']);
  assert.deepEqual(commandsIn('yarn dlx wrangler deploy'), ['yarn dlx wrangler deploy']);
  assert.deepEqual(commandsIn('pnpm install && yarn build'), []);
  const denied = deniedByStandard([
    { command: 'pnpm dlx vercel deploy --prod', paths: ['a'] }, { command: 'bunx netlify deploy', paths: ['a'] }, { command: 'yarn dlx wrangler deploy', paths: ['a'] },
  ]);
  assert.deepEqual(denied.map((d) => d.rule), ['Bash(pnpm dlx vercel:*)', 'Bash(bunx netlify:*)', 'Bash(yarn dlx wrangler:*)']);
});

test('the survey never runs the project\'s hooks or fsmonitor, and its fetch never asks for a passphrase', async () => {
  const { folder, remote } = await makeProject();
  const upstream = await makeUpstream(folder);
  // A new commit on the remote, so the fetch updates a ref and would run reference-transaction.
  const other = path.join(tempFolder('wh-other-'), 'other');
  await g(path.dirname(other), 'clone', '--quiet', remote.url, other);
  await g(other, 'commit', '--quiet', '--allow-empty', '-m', 'more');
  await g(other, 'push', '--quiet', 'origin', 'main');
  const marker = path.join(tempFolder('wh-marker-'), 'ran');
  const hook = path.join(folder, '.git', 'hooks', 'reference-transaction');
  fs.writeFileSync(hook, `#!/bin/sh\necho ran >> "${marker.replace(/\\/g, '/')}"\n`);
  fs.chmodSync(hook, 0o755);
  await g(folder, 'config', 'core.fsmonitor', hook);

  const calls = [];
  const recording = async (file, args, options) => {
    if (file === 'git') calls.push({ args, env: options?.env ?? {} });
    return noPrs(file, args, options);
  };
  await surveyProject({ folder, manifest: MANIFEST, run: recording, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });
  assert.equal(fs.existsSync(marker), false, 'a project hook ran');
  for (const { args } of calls) {
    assert.ok(args.includes('core.fsmonitor=false'), args.join(' '));
    assert.ok(args.some((a) => a.startsWith('core.hooksPath=')), args.join(' '));
  }
  const fetch = calls.find((c) => c.args.includes('fetch'));
  assert.match(fetch.env.GIT_SSH_COMMAND, /BatchMode=yes/);
  // The same hook does run under plain git, so the test would see it.
  await g(other, 'commit', '--quiet', '--allow-empty', '-m', 'again');
  await g(other, 'push', '--quiet', 'origin', 'main');
  await g(folder, '-c', 'core.fsmonitor=false', 'fetch', '--quiet', 'origin');
  assert.equal(fs.existsSync(marker), true);
});

test('surveyed from a linked worktree, the main checkout is listed and the worktree itself is not', async () => {
  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  const worktree = path.join(path.dirname(folder), 'lantern-till');
  await g(folder, 'worktree', 'add', '--quiet', '-b', 'feature/till', worktree);
  const survey = await surveyProject({ folder: worktree, manifest: MANIFEST, run: noPrs, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-') });
  assert.deepEqual(survey.inFlight.worktrees.map((w) => [fs.realpathSync(w.path), w.branch]), [[fs.realpathSync(folder), 'main']]);
});

test('a command-start word at the end of a piece is not taken for a runner', () => {
  assert.deepEqual(commandsIn('ls'), []);
  assert.deepEqual(commandsIn('if true; then git push; fi'), ['git push']);
  assert.deepEqual(commandsIn('for x in a; do npm test; done'), ['npm test']);
  assert.deepEqual(commandsIn('pnpm'), []);
});

test('the fetch keeps the director\'s own ssh command and adds BatchMode to it', async () => {
  assert.equal(batchSshCommand({ env: {}, configured: '' }), 'ssh -o BatchMode=yes');
  assert.equal(batchSshCommand({ env: {}, configured: 'ssh -i ~/.ssh/shop_key' }), 'ssh -i ~/.ssh/shop_key -o BatchMode=yes');
  assert.equal(batchSshCommand({ env: { GIT_SSH_COMMAND: 'C:/Windows/System32/OpenSSH/ssh.exe' }, configured: 'ssh -i k' }), 'C:/Windows/System32/OpenSSH/ssh.exe -o BatchMode=yes');

  const { folder } = await makeProject();
  const upstream = await makeUpstream(folder);
  await g(folder, 'config', 'core.sshCommand', 'ssh -i ~/.ssh/shop_key');
  const calls = [];
  const recording = async (file, args, options) => {
    if (file === 'git') calls.push({ args, env: options?.env ?? {} });
    return noPrs(file, args, options);
  };
  await surveyProject({ folder, manifest: MANIFEST, run: recording, upstreams: { 'kit-a': upstream }, host: 'github', claudeHome: tempFolder('wh-claude-'), sshEnv: {} });
  assert.equal(calls.find((c) => c.args.includes('fetch')).env.GIT_SSH_COMMAND, 'ssh -i ~/.ssh/shop_key -o BatchMode=yes');
});

test('a bare main repository is not listed as a worktree in flight', async () => {
  const { remote } = await makeProject();
  const bare = path.join(tempFolder('wh-bare-'), 'shop.git');
  await g(path.dirname(bare), 'clone', '--quiet', '--bare', remote.url, bare);
  const worktree = path.join(path.dirname(bare), 'shop-main');
  await g(bare, 'worktree', 'add', '--quiet', worktree, 'main');
  const survey = await surveyProject({ folder: worktree, manifest: { upstreams: [] }, run: noPrs, upstreams: {}, host: 'github', claudeHome: tempFolder('wh-claude-') });
  assert.deepEqual(survey.inFlight.worktrees, []);
});
