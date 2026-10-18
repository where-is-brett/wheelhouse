// tests/scripts/hooks/kit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readInput, answer, findRepoRoot, projectOf, hookMain, readSmallText, SMALL_FILE_BYTES } from '../../../scripts/hooks/kit.js';
import { managedDir, lockedProjects } from '../../../scripts/protection/managed.js';
import { writeProject } from '../../../scripts/lib/projects.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function temp(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A temporary Wheelhouse home for the length of `fn`.
async function withHome(fn) {
  const home = temp('wh-kit-home-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
});

// A repository with one commit and a linked worktree beside it.
function makeRepo() {
  const base = temp('wh-kit-repo-');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'first');
  const tree = path.join(base, 'tree');
  git(main, 'worktree', 'add', '-q', tree, '-b', 'other');
  return { base, main, tree };
}

function register(main, project = 'owner__name') {
  writeProject(project, {
    folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  });
  return project;
}

test('readInput parses the JSON on the stream and refuses anything else', async () => {
  assert.deepEqual(await readInput(Readable.from(['{"cwd":"/x",', '"session_id":"s"}'])), { cwd: '/x', session_id: 's' });
  await assert.rejects(readInput(Readable.from(['not json'])));
  await assert.rejects(readInput(Readable.from(['[1]'])));
});

test('answer builds the three shapes', () => {
  assert.deepEqual(answer.deny('no'), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' },
  });
  assert.deepEqual(answer.context('SessionStart', 'hello'), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'hello' },
  });
  assert.deepEqual(answer.block('stop'), { decision: 'block', reason: 'stop' });
});

test('findRepoRoot finds the main folder from the folder itself and from a worktree', () => {
  const { base, main, tree } = makeRepo();
  try {
    fs.mkdirSync(path.join(main, 'sub', 'deeper'), { recursive: true });
    fs.mkdirSync(path.join(tree, 'sub'), { recursive: true });
    assert.equal(findRepoRoot(main), main);
    assert.equal(findRepoRoot(path.join(main, 'sub', 'deeper')), main);
    assert.equal(findRepoRoot(tree), main);
    assert.equal(findRepoRoot(path.join(tree, 'sub')), main);
    assert.equal(findRepoRoot(base), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('projectOf never runs git, even in a folder whose config would run a command', async () => {
  await withHome(async () => {
    const { base, main, tree } = makeRepo();
    try {
      const marker = path.join(base, 'marker');
      const script = path.join(base, 'mark.js');
      fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
      git(main, 'config', 'core.fsmonitor', `node "${script}"`);
      git(main, 'config', 'core.hooksPath', path.join(base, 'no-hooks'));
      const project = register(main);
      // The marker file is the proof: fsmonitor would write it if git ran. The
      // throwing run is a backstop, since projectOf takes no run to call.
      const deps = { run: () => { throw new Error('projectOf ran a command'); } };
      for (const cwd of [main, tree]) {
        const found = projectOf(cwd, { ...deps, dir: path.join(base, 'managed') });
        assert.equal(found.project, project);
        assert.equal(found.record.repo, 'owner/name');
        assert.equal(found.locked, false);
      }
      assert.equal(fs.existsSync(marker), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('projectOf is null outside every registered project', async () => {
  await withHome(async () => {
    const { base, main } = makeRepo();
    try {
      assert.equal(projectOf(main, { dir: path.join(base, 'managed') }), null); // a repository, not registered
      register(main);
      assert.equal(projectOf(base, { dir: path.join(base, 'managed') }), null); // no repository
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('lockedProjects reads the main folders, and is empty when the file is missing', () => {
  const dir = temp('wh-managed-');
  try {
    assert.deepEqual(lockedProjects({ dir }), []);
    fs.mkdirSync(path.join(dir, 'wheelhouse'));
    fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify(['/a/b', '/c']));
    assert.deepEqual(lockedProjects({ dir }), ['/a/b', '/c']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('projectOf marks a project Locked when its main folder is listed', async () => {
  await withHome(async () => {
    const { base, main, tree } = makeRepo();
    const dir = path.join(base, 'managed');
    try {
      register(main);
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([main]));
      assert.equal(projectOf(main, { dir }).locked, true);
      assert.equal(projectOf(tree, { dir }).locked, true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

function harness(input) {
  const out = [];
  return { out, io: { stdin: Readable.from([JSON.stringify(input)]), write: (text) => out.push(text), self: '/plugin/scripts/hooks/kit.js', dir: '/nowhere' } };
}

test('a guard that throws denies; an informing hook that throws says nothing', async () => {
  const boom = () => { throw new Error('secret detail'); };
  const guard = harness({ cwd: os.tmpdir() });
  await hookMain(boom, { failClosed: true, event: 'PreToolUse' }, guard.io);
  assert.equal(guard.out.length, 1);
  assert.deepEqual(JSON.parse(guard.out[0]), answer.deny('Wheelhouse\'s check could not run'));
  assert.ok(!guard.out[0].includes('secret detail'));

  const informer = harness({ cwd: os.tmpdir() });
  await hookMain(boom, { failClosed: false, event: 'SessionStart' }, informer.io);
  assert.deepEqual(informer.out, []);

  const unreadable = harness({});
  unreadable.io.stdin = Readable.from(['garbage']);
  await hookMain(() => null, { failClosed: true, event: 'PreToolUse' }, unreadable.io);
  assert.deepEqual(JSON.parse(unreadable.out[0]), answer.deny('Wheelhouse\'s check could not run'));
});

test('hookMain prints what decide answers, and nothing when it answers nothing', async () => {
  const said = harness({ cwd: os.tmpdir(), tool_name: 'Bash' });
  await hookMain((input) => answer.deny(`no ${input.tool_name}`), { failClosed: true, event: 'PreToolUse' }, said.io);
  assert.deepEqual(JSON.parse(said.out[0]), answer.deny('no Bash'));
  const silent = harness({ cwd: os.tmpdir() });
  await hookMain(() => undefined, { failClosed: true, event: 'PreToolUse' }, silent.io);
  assert.deepEqual(silent.out, []);
});

// Puts the managed copy in place: its kit.js, a Node.js of its own, and a
// managed-settings.json whose hook names both.
function putManagedCopy(dir, { kit = true, settings = true, node = true } = {}) {
  const own = path.join(dir, 'wheelhouse');
  fs.mkdirSync(path.join(own, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(own, 'bin'), { recursive: true });
  if (kit) fs.writeFileSync(path.join(own, 'scripts', 'hooks', 'kit.js'), '// kit');
  if (node) fs.writeFileSync(path.join(own, 'bin', 'node'), '');
  if (settings) {
    fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: path.join(own, 'bin', 'node'), args: [path.join(own, 'scripts', 'hooks', 'stop-guard.js')] }] }] },
    }));
  }
}

test('who answers: the plugin\'s copy or the managed copy, in a Locked project or not, managed copy there or not', async () => {
  await withHome(async (home) => {
    const { base, main } = makeRepo();
    const dir = path.join(base, 'managed');
    try {
      const project = register(main);
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      const decide = () => answer.deny('guarded');
      const inform = () => answer.context('SessionStart', 'hello');
      const pluginSelf = path.join(base, 'plugin', 'scripts', 'hooks', 'kit.js');
      const managedSelf = path.join(dir, 'wheelhouse', 'scripts', 'hooks', 'kit.js');
      const marker = path.join(home, 'projects', project ?? 'owner__name', 'sessions', 's1.managed');
      const count = async (self, options, cwd) => {
        const h = harness({ cwd, session_id: 's1' });
        Object.assign(h.io, { dir, self });
        await hookMain(options.failClosed ? decide : inform, options, h.io);
        return h.out.length;
      };
      const guardOpts = { failClosed: true, event: 'PreToolUse' };
      const startOpts = { failClosed: false, event: 'SessionStart' };
      const informOpts = { failClosed: false, event: 'UserPromptSubmit' };

      // Locked, managed copy in place, session-start not yet seen: the plugin's copy still answers
      // (except at SessionStart itself, which goes by the files alone).
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([main]));
      putManagedCopy(dir);
      assert.equal(await count(pluginSelf, guardOpts, main), 1, 'no marker: the plugin answers');
      assert.equal(await count(pluginSelf, startOpts, main), 0, 'SessionStart goes by the files');
      // The marker is there: the plugin's copy is silent; the managed copy answers.
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, '');
      assert.equal(await count(pluginSelf, guardOpts, main), 0);
      assert.equal(await count(pluginSelf, informOpts, main), 0);
      assert.equal(await count(managedSelf, guardOpts, main), 1);
      assert.equal(await count(managedSelf, informOpts, main), 1);

      // Locked, managed copy missing in some way: the plugin's copy runs even with the marker.
      fs.rmSync(path.join(dir, 'wheelhouse', 'scripts'), { recursive: true });
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      assert.equal(await count(pluginSelf, startOpts, main), 1);
      fs.rmSync(path.join(dir, 'managed-settings.json'));
      putManagedCopy(dir, { settings: false });
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), '{ not json');
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: '/x/node', args: ['/elsewhere/x.js'] }] }] } }));
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      // A sibling folder whose name merely starts the same does not count.
      fs.writeFileSync(path.join(dir, 'managed-settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: path.join(dir, 'wheelhouse', 'bin', 'node'), args: [`${path.join(dir, 'wheelhouse')}-other/scripts/hooks/x.js`] }] }] } }));
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      // The Node.js the file names is gone: the plugin's copy answers.
      putManagedCopy(dir);
      assert.equal(await count(pluginSelf, guardOpts, main), 0);
      fs.rmSync(path.join(dir, 'wheelhouse', 'bin', 'node'));
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      assert.equal(await count(pluginSelf, startOpts, main), 1);

      // Not Locked: the plugin's copy answers; the managed copy guards but does not inform.
      putManagedCopy(dir);
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), '[]');
      assert.equal(await count(pluginSelf, guardOpts, main), 1);
      assert.equal(await count(pluginSelf, informOpts, main), 1);
      assert.equal(await count(managedSelf, guardOpts, main), 1);
      assert.equal(await count(managedSelf, informOpts, main), 0);
      // Not Locked and the managed copy missing: the plugin's copy answers.
      fs.rmSync(path.join(dir, 'managed-settings.json'));
      assert.equal(await count(pluginSelf, informOpts, main), 1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('managedDir names the computer-wide settings folder on each system', () => {
  assert.equal(managedDir('darwin'), '/Library/Application Support/ClaudeCode');
  assert.match(managedDir('win32'), /ClaudeCode$/);
  assert.equal(managedDir('linux'), '/etc/claude-code');
});

// Scripts named in hooks.json that are not written yet. Every script exists now.
const NOT_YET_BUILT = new Set();

const cmd = (name) => ({ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/hooks/${name}.js"`, timeout: 10 });

test('hooks.json names a script that exists for every hook', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(file, {
    modules: ['./register.ts'],
    hooks: {
      SessionStart: [{ matcher: 'startup|resume|compact|clear|fork', hooks: [cmd('session-start')] }],
      UserPromptSubmit: [{ hooks: [cmd('stop-word'), cmd('context-gauge'), cmd('board-context')] }],
      PreToolUse: [
        { matcher: '*', hooks: [{ ...cmd('stop-guard'), onFailure: 'block' }] },
        { matcher: 'Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|Bash|PowerShell|Monitor|WebFetch|ListMcpResourcesTool|ReadMcpResourceTool|mcp__.*', hooks: [{ ...cmd('tool-guard'), onFailure: 'block' }] },
      ],
      PostToolUse: [{ matcher: 'AskUserQuestion', hooks: [cmd('prompt-record')] }],
      SubagentStop: [{ matcher: '^wheelhouse:(builder|reviewer)$', hooks: [cmd('report-check')] }],
      PreCompact: [{ hooks: [cmd('precompact-guard')] }],
      SessionEnd: [{ hooks: [cmd('stop-guard')] }],
    },
  });
  const named = new Set();
  for (const groups of Object.values(file.hooks)) {
    for (const group of groups) for (const hook of group.hooks) named.add(/scripts\/hooks\/([\w-]+\.js)"$/.exec(hook.command)[1]);
  }
  for (const script of named) {
    if (NOT_YET_BUILT.has(script)) continue;
    assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'hooks', script)), `${script} is missing`);
  }
});

test('a guard\'s failure answer follows its event', async () => {
  const boom = () => { throw new Error('x'); };
  const reason = 'Wheelhouse\'s check could not run';
  const expected = {
    PreToolUse: answer.deny(reason),
    UserPromptSubmit: answer.block(reason),
    PostToolUse: answer.block(reason),
    SubagentStop: answer.block(reason),
    PreCompact: answer.block(reason),
    SessionStart: null,
    SessionEnd: null,
  };
  for (const [event, want] of Object.entries(expected)) {
    const guard = harness({ cwd: os.tmpdir() });
    await hookMain(boom, { failClosed: true, event }, guard.io);
    if (want === null) assert.deepEqual(guard.out, [], event);
    else assert.deepEqual(guard.out.map((text) => JSON.parse(text)), [want], event);
    const informer = harness({ cwd: os.tmpdir() });
    await hookMain(boom, { failClosed: false, event }, informer.io);
    assert.deepEqual(informer.out, [], event);
  }
});

test('answer.context carries the event it is given', () => {
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse']) {
    assert.equal(answer.context(event, 't').hookSpecificOutput.hookEventName, event);
  }
});

test('a guard with empty input, a rejected decide, or a throwing projectOf denies', async () => {
  const want = answer.deny('Wheelhouse\'s check could not run');
  const empty = harness({});
  empty.io.stdin = Readable.from([]);
  await hookMain(() => null, { failClosed: true, event: 'PreToolUse' }, empty.io);
  assert.deepEqual(empty.out.map((t) => JSON.parse(t)), [want]);

  const rejected = harness({ cwd: os.tmpdir() });
  await hookMain(() => Promise.reject(new Error('later')), { failClosed: true, event: 'PreToolUse' }, rejected.io);
  assert.deepEqual(rejected.out.map((t) => JSON.parse(t)), [want]);

  const thrown = harness({ cwd: os.tmpdir() });
  thrown.io.projectOf = () => { throw new Error('unreadable'); };
  let decided = false;
  await hookMain(() => { decided = true; return null; }, { failClosed: true, event: 'PreToolUse' }, thrown.io);
  assert.deepEqual(thrown.out.map((t) => JSON.parse(t)), [want]);
  assert.equal(decided, false);
});

test('findRepoRoot follows a symlinked .git', (t) => {
  const { base, main } = makeRepo();
  try {
    const link = path.join(base, 'linked');
    fs.mkdirSync(link);
    try {
      fs.symlinkSync(path.join(main, '.git'), path.join(link, '.git'), 'dir');
    } catch {
      t.skip('symlinks are not available here');
      return;
    }
    assert.equal(findRepoRoot(link), link);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('findRepoRoot is null for a worktree of a bare repository', () => {
  const base = temp('wh-kit-bare-');
  try {
    const seed = path.join(base, 'seed');
    fs.mkdirSync(seed);
    git(seed, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(seed, 'a'), 'a');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'first');
    const bare = path.join(base, 'bare.git');
    git(base, 'clone', '-q', '--bare', seed, bare);
    const tree = path.join(base, 'tree');
    git(bare, 'worktree', 'add', '-q', tree, 'main');
    assert.equal(findRepoRoot(tree), null);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('lockedProjects keeps only full paths', () => {
  const dir = temp('wh-managed-');
  try {
    fs.mkdirSync(path.join(dir, 'wheelhouse'));
    fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([process.cwd(), 'relative/folder', '', 7]));
    assert.deepEqual(lockedProjects({ dir }), [process.cwd()]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- final review ---

test('a worktree inside a Locked project whose .git file was rewritten is still Locked', async () => {
  await withHome(async () => {
    const { base, main } = makeRepo();
    const dir = path.join(base, 'managed');
    try {
      register(main);
      fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([main]));
      const inner = path.join(main, 'worktrees', 'x');
      git(main, 'worktree', 'add', '-q', inner, '-b', 'inner');
      // Pointed somewhere with no commondir, so the repository root reads as the worktree itself.
      // Git for Windows marks the .git file hidden, and a hidden file can't be opened to overwrite.
      fs.rmSync(path.join(inner, '.git'));
      fs.writeFileSync(path.join(inner, '.git'), `gitdir: ${path.join(base, 'elsewhere')}\n`);
      const found = projectOf(inner, { dir });
      assert.equal(found.project, 'owner__name');
      assert.equal(found.locked, true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('readSmallText reads a small regular file and nothing else', { skip: process.platform === 'win32' ? 'no FIFOs on Windows' : false }, () => {
  const dir = temp('wh-kit-small-');
  try {
    const file = path.join(dir, 'HEAD');
    fs.writeFileSync(file, 'ref: refs/heads/main\n');
    assert.equal(readSmallText(file), 'ref: refs/heads/main\n');
    // A FIFO with no writer is not waited on.
    const fifo = path.join(dir, 'fifo');
    execFileSync('mkfifo', [fifo]);
    assert.equal(readSmallText(fifo), null);
    assert.equal(readSmallText(dir), null);
    assert.equal(readSmallText(path.join(dir, 'absent')), null);
    fs.writeFileSync(path.join(dir, 'big'), 'x'.repeat(SMALL_FILE_BYTES + 1));
    assert.equal(readSmallText(path.join(dir, 'big')), null);
    assert.equal(readSmallText(path.join(dir, 'big'), SMALL_FILE_BYTES + 1).length, SMALL_FILE_BYTES + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readSmallText reads a small regular file on every system', () => {
  const dir = temp('wh-kit-small-');
  try {
    fs.writeFileSync(path.join(dir, 'commondir'), '../..\n');
    assert.equal(readSmallText(path.join(dir, 'commondir')), '../..\n');
    fs.writeFileSync(path.join(dir, 'empty'), '');
    assert.equal(readSmallText(path.join(dir, 'empty')), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
