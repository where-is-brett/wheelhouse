// tests/scripts/hooks/tool-guard.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decide } from '../../../scripts/hooks/tool-guard.js';
import { CREDENTIALS } from '../../../scripts/lib/credentials.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { CONTROL_FILE, homeControlFolders } from '../../../scripts/lib/agent-control.js';

const temp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const CASE_BLIND = process.platform === 'darwin' || process.platform === 'win32';

async function withHome(fn) {
  const home = temp('wh-tool-home-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = path.join(home, 'wh');
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
});

function makeProject(config) {
  const base = temp('wh-tool-repo-');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'first');
  if (config !== undefined) {
    fs.mkdirSync(path.join(main, '.claude'));
    fs.writeFileSync(path.join(main, '.claude', 'wheelhouse.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  writeProject('owner__name', {
    folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  });
  return { base, main };
}

const PLUGIN = path.join(os.tmpdir(), 'wh-plugin-root');
const call = (cwd, tool, tool_input = {}) => ({ cwd, session_id: 's', hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: tool, tool_input });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
const run = (base, home, input, platform = process.platform) => decide(input, { dir: path.join(base, 'managed'), home, platform, pluginRoot: PLUGIN });

const FILE_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit'];

test('.env, .env.local, .ENV.local and .env.example are refused', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const name of ['.env', '.env.local', '.ENV.local', 'sub/.env.production']) {
        for (const tool of FILE_TOOLS) {
          assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(main, name) }), 'darwin')), `${tool} ${name}`);
        }
      }
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: '.env' }), 'darwin')), 'relative to cwd');
      assert.ok(denied(await run(base, home, call(main, 'NotebookEdit', { notebook_path: path.join(main, '.env') }), 'darwin')));
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: path.join(main, '.env.example') }))));
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(main, 'a.txt') })), undefined);
      assert.ok(denied(await run(base, home, call(main, 'Glob', { pattern: '**/.env*' }))));
      assert.ok(denied(await run(base, home, call(main, 'Grep', { pattern: 'x', glob: '.env.local' }))));
      assert.ok(denied(await run(base, home, call(main, 'Glob', { pattern: '**/.env.example' }))));
      assert.equal(await run(base, home, call(main, 'Grep', { pattern: 'x' })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('a link pointing at .env is refused by where it points', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      fs.writeFileSync(path.join(main, '.env'), 'S=1');
      try { fs.symlinkSync(path.join(main, '.env'), path.join(main, 'innocent.txt')); } catch { return; }
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: path.join(main, 'innocent.txt') }))));
      // A new file under a link to a folder is placed by the folder it really lands in.
      fs.mkdirSync(path.join(home, '.ssh'));
      fs.symlinkSync(path.join(home, '.ssh'), path.join(main, 'keys'));
      assert.ok(denied(await run(base, home, call(main, 'Write', { file_path: path.join(main, 'keys', 'new_key') }))));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the keys folder and each credential file are refused to every file tool', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const cred of CREDENTIALS) {
        const target = path.join(home, ...cred.split('/'));
        for (const tool of FILE_TOOLS) {
          assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(target, 'x') }))), `${tool} ${cred}`);
          assert.ok(denied(await run(base, home, call(main, tool, { file_path: target }))), `${tool} ${cred} itself`);
        }
        assert.ok(denied(await run(base, home, call(main, 'Grep', { pattern: 'x', path: target }))), `Grep ${cred}`);
        assert.ok(denied(await run(base, home, call(main, 'Glob', { pattern: '*', path: target }))), `Glob ${cred}`);
      }
      for (const tool of FILE_TOOLS) {
        assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(home, '.wheelhouse', 'keys', 'signing') }))));
      }
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: path.join(process.env.WHEELHOUSE_HOME, 'keys', 'k') }))));
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(home, '.sshfoo', 'x') })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('writes to the project\'s settings and hooks are refused; reads are not', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const tool of ['Edit', 'Write', 'MultiEdit']) {
        for (const rel of [['.claude', 'settings.json'], ['.claude', 'settings.local.json'], ['.claude', 'hooks', 'a.js'], ['.claude', 'hooks', 'deep', 'b.js'], ...(CASE_BLIND ? [['.CLAUDE', 'Settings.JSON']] : [])]) {
          assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(main, ...rel) }))), rel.join('/'));
        }
        assert.equal(await run(base, home, call(main, tool, { file_path: path.join(main, 'hooks', 'a.js') })), undefined);
        assert.equal(await run(base, home, call(main, tool, { file_path: path.join(main, '.claude', 'wheelhouse.json') })), undefined);
      }
      assert.ok(denied(await run(base, home, call(main, 'NotebookEdit', { notebook_path: path.join(main, '.claude', 'hooks', 'x.ipynb') }))));
      for (const rel of [['.claude', 'settings.json'], ['.claude', 'settings.local.json'], ['.claude', 'hooks', 'a.js']]) {
        assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(main, ...rel) })), undefined);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('writes to ~/.claude, the plugin and settings.local.json are refused; reads of ~/.claude are not', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const tool of ['Edit', 'Write', 'MultiEdit']) {
        assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(home, '.claude', 'settings.json') }))));
        assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(PLUGIN, 'hooks', 'hooks.json') }))));
        assert.ok(denied(await run(base, home, call(main, tool, { file_path: path.join(main, '.claude', 'settings.local.json') }))));
        assert.equal(await run(base, home, call(main, tool, { file_path: path.join(main, 'src.txt') })), undefined);
      }
      assert.ok(denied(await run(base, home, call(main, 'NotebookEdit', { notebook_path: path.join(home, '.claude', 'x.ipynb') }))));
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(home, '.claude', 'settings.json') })), undefined);
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(PLUGIN, 'hooks', 'hooks.json') })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

const REFUSED = ['gh pr merge 3', '/usr/local/bin/gh api x', 'sh -c "gh pr merge 3"',
  '"C:\\Program Files\\GitHub CLI\\gh.exe" pr merge 3', 'env glab mr merge 1', 'git push origin main',
  'x;gh pr merge 3', 'a&&gh pr merge 3', 'echo $(gh api x)', 'echo "`gh api x`"', 'echo "$(gh api x)"', 'git -C x push', 'git -c a=b push',
  'cmd /c gh pr merge 3', 'bash -lc "x; glab mr list"', 'sh -c "sh -c \\"gh x\\""', 'echo \'unclosed', 'cat .env', 'cat ./sub/.ENV.local',
  'cat <.env', 'cp --from=.env x', 'eval "gh api x"', 'GH pr merge 3', 'env git push', 'true | gh api x'];
for (const cmd of REFUSED) {
  test(`Bash refuses: ${cmd}`, async () => {
    await withHome(async (home) => {
      const { base, main } = makeProject();
      try {
        const out = await run(base, home, call(main, 'Bash', { command: cmd }), 'darwin');
        assert.ok(denied(out));
        assert.match(out.hookSpecificOutput.permissionDecisionReason, /helper/);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
  });
}

test('Bash allows git commit and node scripts', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const cmd of ['git commit -m "Add the thing"', 'git status && git diff', 'node scripts/x.js --flag', 'ls -la | wc -l',
        'echo "a; b" > out.txt', 'git log --oneline', 'sh -c "echo hi"']) {
        assert.equal(await run(base, home, call(main, 'Bash', { command: cmd })), undefined, cmd);
      }
      // A plugin read with the one redirect the STOP guard takes (stop-guard.js, scriptArguments).
      const desk = `node "${PLUGIN}/scripts/frontdesk/cli.js" cards`;
      assert.equal(await run(base, home, call(main, 'Bash', { command: `${desk} 2>/dev/null` })), undefined);
      assert.equal(await run(base, home, call(main, 'Bash', { command: `${desk} 2>NUL` }), 'win32'), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('a connector is refused unless the configuration lists its server', async () => {
  await withHome(async (home) => {
    const listed = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: ['figma', 'my_server'], webDomains: [] };
    const a = makeProject(listed);
    try {
      assert.equal(await run(a.base, home, call(a.main, 'mcp__figma__get_design')), undefined);
      assert.equal(await run(a.base, home, call(a.main, 'mcp__my_server__do_it')), undefined);
      assert.ok(denied(await run(a.base, home, call(a.main, 'mcp__my__server__do_it'))));
      assert.ok(denied(await run(a.base, home, call(a.main, 'mcp__github__create_issue'))));
      assert.ok(denied(await run(a.base, home, call(a.main, 'mcp__figma'))));
    } finally { fs.rmSync(a.base, { recursive: true, force: true }); }
    for (const config of [undefined, 'not json', { v: 2 }]) {
      const b = makeProject(config);
      try {
        assert.ok(denied(await run(b.base, home, call(b.main, 'mcp__figma__get_design'))), JSON.stringify(config));
        // The file and Bash checks still run.
        assert.ok(denied(await run(b.base, home, call(b.main, 'Bash', { command: 'gh x' }))));
        assert.equal(await run(b.base, home, call(b.main, 'Read', { file_path: path.join(b.main, 'a.txt') })), undefined);
      } finally { fs.rmSync(b.base, { recursive: true, force: true }); }
    }
  });
});

const APP_TOOLS = ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'mcp__ccd_view__show_pane',
  'mcp__ccd_view__close_pane', 'mcp__ccd_view__get_layout', 'mcp__ccd_view__set_transcript_view'];
// A call as from a session the Claude Desktop app started, unless another entrypoint is given.
const desk = (base, home, input, entrypoint = 'claude-desktop', projectDir = undefined) => decide(input, {
  dir: path.join(base, 'managed'), home, platform: process.platform, pluginRoot: PLUGIN, entrypoint, projectDir: projectDir ?? null,
});

test('the Claude app\'s own drawing tools pass unlisted, each by its whole name; its other tools stay with the list', async () => {
  await withHome(async (home) => {
    for (const config of [undefined, { v: 1, criticalAreas: [], ciFiles: [], mcpServers: ['figma'], webDomains: [] }]) {
      const { base, main } = makeProject(config);
      try {
        for (const tool of APP_TOOLS) assert.equal(await desk(base, home, call(main, tool)), undefined, `${tool} ${JSON.stringify(config)}`);
        for (const tool of ['mcp__ccd_turn__other', 'mcp__ccd_turn__wrap_up_now', 'mcp__ccd_turn__wrap_up__x', 'mcp__ccd_turnx__wrap_up',
          'mcp__CCD_TURN__wrap_up', 'mcp__ccd_view__show_pane2', 'mcp__plugin_x_ccd_turn__wrap_up', 'mcp__ccd_session_mgmt__delete_session',
          'mcp__ccd_session__spawn_task', 'mcp__ccd_host__clean_up_worktrees', 'mcp__ccd_settings__set_setting', 'mcp__ccd_turn', 'mcp__ccd_view__']) {
          assert.ok(denied(await desk(base, home, call(main, tool))), tool);
        }
        assert.ok(denied(await desk(base, home, call(main, 'ReadMcpResourceTool', { server: 'ccd_turn', uri: 'x://y' }))));
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
    // Listing another of the app's servers lets it through by the list, as any connector.
    const listed = makeProject({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: ['ccd_session_mgmt'], webDomains: [] });
    try {
      assert.equal(await desk(listed.base, home, call(listed.main, 'mcp__ccd_session_mgmt__list_sessions')), undefined);
      assert.equal(await desk(listed.base, home, call(listed.main, 'mcp__ccd_turn__wrap_up')), undefined);
    } finally { fs.rmSync(listed.base, { recursive: true, force: true }); }
    // A configuration that can't be read refuses them with every connector.
    const unreadable = makeProject('not json');
    try {
      for (const tool of APP_TOOLS) assert.ok(denied(await desk(unreadable.base, home, call(unreadable.main, tool))), tool);
    } finally { fs.rmSync(unreadable.base, { recursive: true, force: true }); }
  });
});

test('a project whose configuration names ccd_turn or ccd_view is refused those servers\' tools, the app\'s own included', async () => {
  await withHome(async (home) => {
    const plain = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
    const mcpJson = (servers) => JSON.stringify({ mcpServers: Object.fromEntries(servers.map((s) => [s, { command: 'node' }])) });
    const cases = [
      { label: 'listed ccd_turn', config: { ...plain, mcpServers: ['ccd_turn'] } },
      { label: 'listed ccd_view', config: { ...plain, mcpServers: ['figma', 'ccd_view'] } },
      { label: '.mcp.json ccd_view', config: plain, mcp: mcpJson(['figma', 'ccd_view']) },
      { label: '.mcp.json ccd.turn', config: plain, mcp: mcpJson(['ccd.turn']) },
      { label: '.mcp.json ccd turn', config: undefined, mcp: mcpJson(['ccd turn']) },
      { label: '.mcp.json not json', config: plain, mcp: '{ nope' },
      { label: '.mcp.json servers not an object', config: plain, mcp: JSON.stringify({ mcpServers: ['ccd_turn'] }) },
    ];
    for (const { label, config, mcp } of cases) {
      const { base, main } = makeProject(config);
      try {
        if (mcp !== undefined) fs.writeFileSync(path.join(main, '.mcp.json'), mcp);
        for (const tool of [...APP_TOOLS, 'mcp__ccd_turn__other', 'mcp__ccd_view__other']) {
          const out = await desk(base, home, call(main, tool));
          assert.ok(denied(out), `${label}: ${tool}`);
          assert.match(out.hookSpecificOutput.permissionDecisionReason, /ccd_turn or ccd_view/, `${label}: ${tool}`);
        }
        assert.ok(denied(await desk(base, home, call(main, 'ListMcpResourcesTool', { server: 'ccd_view' }))), label);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
    // A .mcp.json naming other servers, or none, leaves the app's tools passing.
    for (const mcp of [mcpJson(['figma', 'ccd-turn', 'CCD_TURN']), JSON.stringify({}), 'null']) {
      const { base, main } = makeProject(plain);
      try {
        fs.writeFileSync(path.join(main, '.mcp.json'), mcp);
        for (const tool of APP_TOOLS) assert.equal(await desk(base, home, call(main, tool)), undefined, `${mcp}: ${tool}`);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
    // A .mcp.json in the session's own folder, or a folder above it, counts as well as the main folder's.
    const { base, main } = makeProject(plain);
    try {
      const deep = path.join(main, 'app', 'web');
      fs.mkdirSync(deep, { recursive: true });
      fs.writeFileSync(path.join(main, 'app', '.mcp.json'), mcpJson(['ccd_turn']));
      assert.equal(await desk(base, home, call(main, 'mcp__ccd_turn__wrap_up')), undefined);
      assert.ok(denied(await desk(base, home, call(deep, 'mcp__ccd_turn__wrap_up'))));
      assert.ok(denied(await desk(base, home, call(path.join(main, 'app'), 'mcp__ccd_view__get_layout'))));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the session\'s start folder (CLAUDE_PROJECT_DIR), a linked folder\'s real path and an unreadable .mcp.json count too', async () => {
  await withHome(async (home) => {
    const plain = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };
    const mcpJson = (servers) => JSON.stringify({ mcpServers: Object.fromEntries(servers.map((s) => [s, { command: 'node' }])) });
    const ccd = (out, label) => {
      assert.ok(denied(out), label);
      assert.match(out.hookSpecificOutput.permissionDecisionReason, /ccd_turn or ccd_view/, label);
    };

    // The session started in a worktree whose folder above holds a .mcp.json, and its cwd has
    // since moved to the main folder, where nothing names the app's servers.
    {
      const { base, main } = makeProject(plain);
      const before = process.env.CLAUDE_PROJECT_DIR;
      try {
        const start = path.join(main, 'trees', 'one');
        fs.mkdirSync(start, { recursive: true });
        fs.writeFileSync(path.join(main, 'trees', '.mcp.json'), mcpJson(['ccd_turn']));
        assert.equal(await desk(base, home, call(main, 'mcp__ccd_turn__wrap_up')), undefined, 'no start folder given');
        ccd(await desk(base, home, call(main, 'mcp__ccd_turn__wrap_up'), 'claude-desktop', start), 'the start folder walked');
        ccd(await desk(base, home, call(main, 'mcp__ccd_view__get_layout'), 'claude-desktop', start), 'the start folder walked, ccd_view');
        // By default the start folder is read from the hook's environment.
        process.env.CLAUDE_PROJECT_DIR = start;
        ccd(await decide(call(main, 'mcp__ccd_turn__wrap_up'), { dir: path.join(base, 'managed'), home, platform: process.platform, pluginRoot: PLUGIN, entrypoint: 'claude-desktop' }), 'from the environment');
        delete process.env.CLAUDE_PROJECT_DIR;
        assert.equal(await decide(call(main, 'mcp__ccd_turn__wrap_up'), { dir: path.join(base, 'managed'), home, platform: process.platform, pluginRoot: PLUGIN, entrypoint: 'claude-desktop' }), undefined, 'none in the environment');
      } finally {
        if (before === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = before;
        fs.rmSync(base, { recursive: true, force: true });
      }
    }

    // A cwd reached through a link: the folders above its real path are walked too.
    if (process.platform !== 'win32') {
      const { base, main } = makeProject(plain);
      try {
        fs.mkdirSync(path.join(main, 'app', 'web'), { recursive: true });
        fs.writeFileSync(path.join(main, 'app', '.mcp.json'), mcpJson(['ccd_view']));
        const link = path.join(main, 'linked');
        fs.mkdirSync(link);
        fs.symlinkSync(path.join(main, 'app', 'web'), path.join(link, 'web'));
        // As given, the link's folders hold no .mcp.json naming one; its real path's do.
        ccd(await desk(base, home, call(path.join(link, 'web'), 'mcp__ccd_turn__wrap_up')), 'a linked cwd');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }

    // A .mcp.json that is there but can't be read counts as naming one: a folder, and a file
    // its owner can't read (where the platform keeps that from the owner).
    {
      const { base, main } = makeProject(plain);
      try {
        fs.mkdirSync(path.join(main, '.mcp.json'));
        ccd(await desk(base, home, call(main, 'mcp__ccd_turn__wrap_up')), 'EISDIR');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    }
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      const { base, main } = makeProject(plain);
      const file = path.join(main, '.mcp.json');
      try {
        fs.writeFileSync(file, mcpJson(['figma']));
        fs.chmodSync(file, 0o000);
        ccd(await desk(base, home, call(main, 'mcp__ccd_turn__wrap_up')), 'EACCES');
      } finally {
        fs.chmodSync(file, 0o600);
        fs.rmSync(base, { recursive: true, force: true });
      }
    }
  });
});

test('the app\'s drawing tools pass only in a session the Desktop app started, by its entrypoint', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: ['figma'], webDomains: [] });
    const before = process.env.CLAUDE_CODE_ENTRYPOINT;
    try {
      for (const entrypoint of ['claude-desktop', 'claude-desktop-3p']) {
        for (const tool of APP_TOOLS) assert.equal(await desk(base, home, call(main, tool), entrypoint), undefined, `${entrypoint}: ${tool}`);
      }
      for (const entrypoint of ['cli', 'sdk-ts', 'claude-desktopx', 'Claude-Desktop', '', null]) {
        for (const tool of APP_TOOLS) {
          const out = await desk(base, home, call(main, tool), entrypoint);
          assert.ok(denied(out), `${entrypoint}: ${tool}`);
          assert.match(out.hookSpecificOutput.permissionDecisionReason, /has not listed that connector/, `${entrypoint}: ${tool}`);
        }
      }
      // By default the entrypoint is read from the hook's environment; missing refuses.
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      for (const tool of APP_TOOLS) assert.ok(denied(await run(base, home, call(main, tool))), `missing: ${tool}`);
      process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop';
      for (const tool of APP_TOOLS) assert.equal(await run(base, home, call(main, tool)), undefined, `from the environment: ${tool}`);
      // A listed figma is held by the list whatever the entrypoint.
      assert.equal(await desk(base, home, call(main, 'mcp__figma__get_design'), 'cli'), undefined);
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT; else process.env.CLAUDE_CODE_ENTRYPOINT = before;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('tools it does not name pass untouched, and a folder outside any project is left alone', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    const outside = temp('wh-tool-out-');
    try {
      for (const tool of ['NotebookRead', 'BashOutput', 'WebFetch', 'Agent', 'LS']) {
        assert.equal(await run(base, home, call(main, tool, { file_path: path.join(main, '.env'), command: 'gh x' })), undefined, tool);
      }
      assert.equal(await run(base, home, call(outside, 'Bash', { command: 'gh pr merge 3' })), undefined);
      assert.equal(await run(base, home, call(outside, 'Read', { file_path: path.join(outside, '.env') })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

test('a folder inside a registered project is guarded by path even when .git does not lead to it', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const sub = path.join(main, 'deep');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, '.git'), 'gitdir: /nowhere\n');
      assert.ok(denied(await run(base, home, call(sub, 'Bash', { command: 'gh x' }))));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

// Fix round 1
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { words } from '../../../scripts/hooks/shell-words.js';

const MORE_REFUSED = ['bash -cx "gh x"', 'bash -c -x "gh x"', 'pwsh -Command "gh pr merge 3"', 'powershell -Command "gh x"', 'env -S "gh x"',
  'env --split-string="gh x"', "$'gh' x", '$"gh" x', 'git -c alias.p=push p origin main', 'git -c ALIAS.p=push p', '/usr/lib/git-core/git-push origin',
  'git-send-pack.exe x', 'git-receive-pack x', 'git send-pack x', 'GH=gh; $GH x', 'X=gh && $X x', 'cat .en?', 'ln .e* x', 'cat .ENV[a-z]',
  'git --git-dir=x -C y push', 'zsh -c "echo; gh x"', 'cmd.exe /d /c "gh x"'];
for (const cmd of MORE_REFUSED) {
  test(`Bash refuses (round 1): ${cmd}`, async () => {
    await withHome(async (home) => {
      const { base, main } = makeProject();
      try {
        assert.ok(denied(await run(base, home, call(main, 'Bash', { command: cmd }), 'darwin')));
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
  });
}

const REV_ENV_REFUSED = ['git show HEAD:.env.local', 'git show HEAD:.env', 'git show :.env', 'git show main:sub/.env.production', 'git cat-file -p HEAD:.env',
  'git cat-file blob HEAD:.env.local', 'git diff HEAD:.env HEAD~1:.env', "git -C x show 'HEAD:.env.local'", 'git log -p -- .env.local',
  'git grep x HEAD -- .env', 'git show HEAD:.e*'];
for (const cmd of REV_ENV_REFUSED) {
  test(`Bash refuses an .env file behind a revision: ${cmd}`, async () => {
    await withHome(async (home) => {
      const { base, main } = makeProject();
      try {
        assert.ok(denied(await run(base, home, call(main, 'Bash', { command: cmd }), 'darwin')));
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
  });
}

test('Bash refuses .env.example', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const cmd of ['cat .env.example', 'cp .env.example .env.local']) {
        assert.ok(denied(await run(base, home, call(main, 'Bash', { command: cmd }), 'darwin')), cmd);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('Bash allows git stash push and a push that is only an option value', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const cmd of ['git stash push -m x', 'git log --grep push', 'git commit -m push', 'git -C x log --grep=push', 'git -c k=v status',
        'bash -c "echo hi"', 'env FOO=1 node x.js', 'echo $HOME']) {
        assert.equal(await run(base, home, call(main, 'Bash', { command: cmd })), undefined, cmd);
      }
      assert.ok(denied(await run(base, home, call(main, 'Bash', { command: 'git -C x push' }))));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the strict splitter still refuses $-quoting', () => {
  assert.equal(words("node $'x'", false), null);
});

test('a leading ~ is expanded to the home folder for every path field', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: '~/.ssh/id_rsa' }))));
      assert.ok(denied(await run(base, home, call(main, 'NotebookEdit', { notebook_path: '~/.claude/x.ipynb' }))));
      assert.ok(denied(await run(base, home, call(main, 'Grep', { pattern: 'x', path: '~/.aws' }))));
      assert.ok(denied(await run(base, home, call(main, 'Glob', { pattern: '*', path: '~\\.kube' }), 'win32')));
      assert.equal(await run(base, home, call(main, 'Read', { file_path: '~/notes.txt' })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('Grep and Glob over the home folder or an ancestor of a guarded folder are refused', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const tool of ['Grep', 'Glob']) {
        for (const p of [home, '~', path.join(home, '.config'), path.join(home, '.docker'), path.dirname(home)]) {
          assert.ok(denied(await run(base, home, call(main, tool, { pattern: '*', path: p }))), `${tool} ${p}`);
        }
        assert.equal(await run(base, home, call(main, tool, { pattern: '*' })), undefined);
        assert.equal(await run(base, home, call(main, tool, { pattern: '*', path: path.join(home, 'projects') })), undefined);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('a dangling link is followed to where it will land', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      fs.mkdirSync(path.join(home, '.ssh'));
      fs.mkdirSync(path.join(home, '.claude'));
      try {
        fs.symlinkSync(path.join(home, '.ssh', 'authorized_keys'), path.join(main, 'x'));
        fs.symlinkSync(path.join(home, '.claude', 'commands'), path.join(main, 'y'));
        fs.symlinkSync('y', path.join(main, 'z')); // a link to a link, relative
        fs.symlinkSync('loop2', path.join(main, 'loop1'));
        fs.symlinkSync('loop1', path.join(main, 'loop2'));
      } catch { return; }
      for (const name of ['x', 'y', 'z']) {
        assert.ok(denied(await run(base, home, call(main, 'Write', { file_path: path.join(main, name) }))), name);
        assert.ok(denied(await run(base, home, call(main, 'Write', { file_path: path.join(main, name, 'deeper') }))), `${name}/deeper`);
      }
      assert.ok(denied(await run(base, home, call(main, 'Write', { file_path: path.join(main, 'loop1') }))));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('more credential files are refused, ~/.claude/.credentials.json even to Read', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const rel of ['.git-credentials', '.config/git/credentials', '.claude/.credentials.json']) {
        assert.ok(CREDENTIALS.includes(rel), rel);
        assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: path.join(home, ...rel.split('/')) }))), rel);
      }
      assert.deepEqual(credentialPaths('darwin'), CREDENTIALS);
      for (const rel of ['AppData/Roaming/GitHub CLI', 'AppData/Roaming/glab-cli', 'AppData/Local/glab-cli']) {
        assert.ok(credentialPaths('win32').includes(rel));
        assert.ok(!CREDENTIALS.includes(rel));
        assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: path.join(home, ...rel.split('/'), 'hosts.yml') }), 'win32')), rel);
        assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(home, ...rel.split('/'), 'hosts.yml') }), 'linux'), undefined);
      }
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(home, '.claude', 'settings.json') })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the PowerShell tool is held to the same command rules as Bash', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const command of ['gh pr list', 'git push origin main', 'Get-Content .env', 'glab mr list', '& gh.exe auth status']) {
        assert.ok(denied(await run(base, home, call(main, 'PowerShell', { command }), 'win32')), command);
      }
      assert.equal(await run(base, home, call(main, 'PowerShell', { command: 'Get-ChildItem' }), 'win32'), undefined);
      assert.ok(denied(await run(base, home, call(main, 'PowerShell', { command: 'gh pr list' }), 'darwin')));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('on Windows, trailing dots and spaces and stream suffixes do not hide a guarded path', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const rel of ['.claude\\settings.json.', '.claude\\hooks \\x.js', '.claude\\settings.json::$DATA', '.claude\\settings.local.json. ', '.claude. \\hooks\\x.js']) {
        assert.ok(denied(await run(base, home, call(main, 'Write', { file_path: `${main}\\${rel}` }), 'win32')), rel);
      }
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: `${home}/.ssh. /id_rsa` }), 'win32')));
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: `${home}/.ssh/id_rsa::$DATA` }), 'win32')));
      assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: `${main}\\.env.` }), 'win32')));
      assert.equal(await run(base, home, call(main, 'Write', { file_path: `${main}\\src.txt.` }), 'win32'), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the host tools\' credential stores are refused', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const rel of ['.config/stripe', '.fly', '.wrangler', '.supabase', '.railway', '.config/neonctl', '.netlify', '.vercel']) {
        assert.ok(CREDENTIALS.includes(rel), rel);
        assert.ok(denied(await run(base, home, call(main, 'Read', { file_path: path.join(home, ...rel.split('/'), 'config.json') }))), rel);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

// --- final review ---

test('Monitor\'s command is held to the same rules as Bash; a WebSocket watch has no command to check', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const command of ['gh pr checks 7 --watch', 'git push origin main', 'tail -f .env', 'bash -c "glab mr list"']) {
        assert.ok(denied(await run(base, home, call(main, 'Monitor', { command, description: 'd', timeout_ms: 1000 }))), command);
      }
      assert.equal(await run(base, home, call(main, 'Monitor', { command: 'tail -f build.log', description: 'd', timeout_ms: 1000 })), undefined);
      assert.equal(await run(base, home, call(main, 'Monitor', { ws: { url: 'wss://example.invalid/x' }, description: 'd', timeout_ms: 1000 })), undefined);
      await assert.rejects(run(base, home, call(main, 'Monitor', { command: 7, description: 'd' })), 'a command that is not text fails, which refuses');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the MCP resource tools are held by their server against the project\'s list; no server is refused', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: ['figma'], webDomains: [] });
    try {
      for (const tool of ['ListMcpResourcesTool', 'ReadMcpResourceTool']) {
        assert.equal(await run(base, home, call(main, tool, { server: 'figma', uri: 'figma://x' })), undefined, tool);
        assert.ok(denied(await run(base, home, call(main, tool, { server: 'github', uri: 'github://x' }))), tool);
        assert.ok(denied(await run(base, home, call(main, tool, { uri: 'figma://x' }))), `${tool} with no server`);
        assert.ok(denied(await run(base, home, call(main, tool, { server: '' }))), `${tool} with an empty server`);
        assert.ok(denied(await run(base, home, call(main, tool, { server: ['figma'] }))), `${tool} with a server that is not text`);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('pwsh and powershell with any short form of -EncodedCommand are refused', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const forms = ['-e', '-ec', '-en', '-enc', '-EnC', '-encod', '-EncodedCommand', '-ENCODEDCOMMAND', '--encodedcommand'];
      for (const shell of ['pwsh', 'powershell', 'powershell.exe', 'PWSH.EXE']) {
        for (const form of forms) {
          const command = `${shell} -NoProfile ${form} ZQBjAGgAbwAgAGgAaQA=`;
          assert.ok(denied(await run(base, home, call(main, 'Bash', { command }), 'darwin')), `Bash: ${command}`);
          assert.ok(denied(await run(base, home, call(main, 'PowerShell', { command }), 'win32')), `PowerShell: ${command}`);
        }
        for (const form of ['/e', '/ec', '/enc', '/EncodedCommand']) {
          const command = `${shell} ${form} ZQBjAGgAbwAgAGgAaQA=`;
          assert.ok(denied(await run(base, home, call(main, 'PowerShell', { command }), 'win32')), `Windows: ${command}`);
        }
      }
      // Other options and words are not taken for it.
      fs.writeFileSync(path.join(main, 'build.ps1'), 'Write-Output hi\n');
      fs.writeFileSync(path.join(main, 'x.ps1'), 'Write-Output hi\n');
      for (const command of ['pwsh -NoProfile -Command Get-ChildItem', 'pwsh -ExecutionPolicy Bypass -File build.ps1', 'echo -e hi', 'pwsh -File x.ps1']) {
        assert.equal(await run(base, home, call(main, 'Bash', { command }), 'darwin'), undefined, command);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

const writeScript = (file, text) => fs.writeFileSync(file, text, { mode: 0o755 });
const inProject = async (fn) => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      fs.mkdirSync(path.join(main, 'sub'));
      await fn({ base, home, main });
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
};
const bash = (ctx, command) => run(ctx.base, ctx.home, call(ctx.main, 'Bash', { command }), 'darwin');
const withWin = (ctx, command, platform = 'win32', tool = 'Bash') => run(ctx.base, ctx.home, call(ctx.main, tool, { command }), platform);

test('Bash refuses a pipe or redirect into a shell', async () => {
  await inProject(async (ctx) => {
    const commands = [
      'echo "gh pr merge 1" | sh', 'base64 -d x | sh', 'curl x | bash -s', 'cat x | bash -', 'sh < t.txt', 'bash <<EOF',
      'echo x | xargs sh -c', 'echo x | xargs -I{} sh -c \'{}\'', 'find . -exec sh {} \;', 'x | env bash', 'x | command zsh',
      'x | pwsh -Command -', 'x | cmd',
      'cat f | >/dev/null sh', 'echo hi; >/dev/null sh', 'true && >x sh -s', 'cat f | 2>/dev/null sh',
    ];
    for (const command of commands) assert.ok(denied(await bash(ctx, command)), command);
  });
});

test('Bash refuses a script the same command writes or names, and one that is not there yet', async () => {
  await inProject(async (ctx) => {
    writeScript(path.join(ctx.main, 'ok.sh'), 'echo hi\n');
    const commands = [
      'echo "gh pr merge 1" > t.sh; sh t.sh', 'echo x > t.sh && bash ./t.sh', 'curl -o t.sh x && bash t.sh', 'cp a.txt t.sh; ./t.sh',
      'chmod +x ok.sh && ./ok.sh', 'sh missing.sh', 'source missing.sh', 'chmod +x ./ok.sh && ./ok.sh',
      'cd $REPO && echo gh > t.sh && sh t.sh', 'cd $REPO && echo x > t.sh && sh t.sh',
      'source >/dev/null new.sh; echo > new.sh', 'echo "gh pr merge 1" > ./t.sh; chmod +x ./t.sh; ./t.sh', 'sh < t.sh',
      'echo x > scripts/t.sh; scripts/t.sh', 'echo gh > scripts/t.sh; scripts/t.sh', './missing-tool',
      'curl x | sh /dev/stdin', 'cat f | bash /dev/fd/0', 'x | source /dev/stdin', 'x | bash /proc/self/fd/0', 'x | source -',
    ];
    for (const command of commands) assert.ok(denied(await bash(ctx, command)), command);
  });
});

test('Bash allows scripts that are there, whatever they hold, and commands that only name a path', async () => {
  await inProject(async (ctx) => {
    writeScript(path.join(ctx.main, 'gradlew'), [
      '#!/bin/sh',
      '# Don\'t edit: generated',
      'case "$(uname)" in',
      '  CYGWIN* ) cygwin=true ;;',
      '  Darwin* ) darwin=true ;;',
      'esac',
      'app_path=$0',
      'while [ -h "$app_path" ]; do',
      '  ls=$( ls -ld "$app_path" )',
      '  link=${ls#*\' -> \'}',
      '  case $link in',
      '    /*)   app_path=$link ;;',
      '    *)    app_path=$( dirname "$app_path" )/$link ;;',
      '  esac',
      'done',
      'APP_HOME=$( cd "$( dirname "$app_path" )" && pwd -P ) || exit',
      'gh pr merge 1',
      'exec "$JAVACMD" "$@"',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(ctx.main, 'scripts', 'hooks'), { recursive: true });
    writeScript(path.join(ctx.main, 'scripts', 'ok.sh'), 'gh pr merge 1\n');
    fs.writeFileSync(path.join(ctx.main, 'scripts', 'x.js'), 'gh x\n');
    fs.writeFileSync(path.join(ctx.main, 'scripts', 'hooks', 'tool-guard.js'), 'gh x\n');
    writeScript(path.join(ctx.main, 'ok.sh'), 'git push origin main\n');
    writeScript(path.join(ctx.main, 'sub', 'ok.sh'), 'gh x\n');
    fs.mkdirSync(path.join(ctx.main, 'src'));
    fs.mkdirSync(path.join(ctx.main, 'node_modules', '.bin'), { recursive: true });
    writeScript(path.join(ctx.main, 'node_modules', '.bin', 'eslint'), '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(ctx.main, 'tool.js'), '#!/usr/bin/env node\nrequire(\'gh\')\n');
    fs.writeFileSync(path.join(ctx.home, 'home.sh'), 'gh x\n');
    const commands = [
      './gradlew build', 'bash scripts/ok.sh', 'source ./ok.sh', 'sh ok.sh', './ok.sh', 'cd sub && ./ok.sh', 'source ~/home.sh', './tool.js',
      'ls > files.txt ./sub', 'grep -rn foo > hits.txt src/', 'npm test 2>&1 | tee out.log', './node_modules/.bin/eslint .',
      'git commit -F - <<\'EOF\'\nscripts/x.js: tidy\nscripts/hooks/tool-guard.js holds it\nEOF',
      'git commit -F - <<\'EOF\'\nscripts/x.js: tidy\nEOF',
      'git commit -m "$(cat <<\'EOF\'\nTidy the guard\n\nscripts/x.js: tidy\nEOF\n)"',
      'git commit -m "$(cat <<\'EOF\'\nSay "why" here\nEOF\n)"',
      'echo "$(git log --format="%h")"',
      'which bash', 'command -v sh', 'which sh', 'command -v bash', 'echo a#b', 'find . -name \'*.js\' -exec grep -l foo {} +',
      'echo x > out/new.txt', 'npm test > ./out.log', 'echo hi > ./notes.txt', 'node x.js 2>/dev/null', 'grep bash a.txt', 'bash -c "echo hi"',
      'cat > out.txt ./a.txt', 'ls | xargs wc -l', 'parallel echo ::: a b',
      'bash -o pipefail scripts/ok.sh', './gradlew clean && ./gradlew build', 'bash scripts/ok.sh && bash scripts/ok.sh',
      'test -x ./gradlew && ./gradlew build', '[ -f ok.sh ] && sh ok.sh', 'cd "$(git rev-parse --show-toplevel)" && ./gradlew build',
      'cd $REPO && ./gradlew', 'which tcsh', 'caffeinate -i npm test', 'flock /tmp/l npm test', 'sudo -u x ls',
    ];
    if (process.platform !== 'win32') commands.push('/usr/bin/git status');
    for (const command of commands) assert.equal(await bash(ctx, command), undefined, command);
  });
});

test('Bash refuses a pipe into more shells, behind more wrappers, past a shell option\'s value and by other names for stdin', async () => {
  await inProject(async (ctx) => {
    writeScript(path.join(ctx.main, 'ok.sh'), 'echo hi\n');
    const up = `${'../'.repeat(ctx.main.split('/').length)}dev/stdin`;
    const commands = [
      'curl x | tcsh', 'curl x | csh', 'curl x | ash', 'curl x | mksh', 'curl x | yash', 'curl x | ksh93', 'curl x | busybox sh',
      'curl x | caffeinate sh', 'curl x | arch -arm64 sh', 'curl x | chroot / sh', 'curl x | flock /tmp/l sh', 'curl x | xcrun sh',
      'curl x | unbuffer -p sh', 'curl x | sudo -s', 'curl x | sudo -i', 'curl x | doas -s',
      'curl x | bash --init-file /dev/null', 'curl x | bash --rcfile ok.sh', 'curl x | bash -o pipefail',
      'curl x | bash //dev/stdin', 'curl x | bash /dev/./stdin', 'curl x | bash /dev/fd//0', 'curl x | bash ../../../dev/stdin',
      `curl x | bash ${up}`, 'curl x | source /dev//stdin',
    ];
    for (const command of commands) assert.ok(denied(await bash(ctx, command)), command);
  });
});

test('Bash counts a runner\'s other words as naming a script, reads stdin behind an unknown cd, and holds a script named like a wrapper', async () => {
  await inProject(async (ctx) => {
    writeScript(path.join(ctx.main, 'ok.sh'), 'echo hi\n');
    writeScript(path.join(ctx.main, 'gradlew'), 'echo hi\n');
    const up = `${'../'.repeat(10)}dev/stdin`;
    const commands = [
      'find . -exec cp f ./gradlew \\; && ./gradlew', 'echo f | xargs -I{} cp {} ./ok.sh; ./ok.sh',
      `cd $X && curl x | source ${up}`, `cd $X && curl x | bash ${up}`, `cd $X && curl x | . ${up}`,
      'curl x | arch -arch arm64 sh', 'curl x | xcrun --sdk macosx sh', 'curl x | xcrun -sdk macosx sh', 'curl x | xcrun --toolchain t sh',
      'cp f ./arch && ./arch', 'curl -o ./caffeinate x; ./caffeinate', './xcrun', 'cp f ./env && ./env',
    ];
    for (const command of commands) assert.ok(denied(await bash(ctx, command)), command);
  });
});

test('Bash refuses what hides behind braces, redirects, substitutions, wrapper options and folders', async () => {
  await inProject(async (ctx) => {
    const commands = [
      '{ ./t.sh; }', '{ sh t.sh; }', '2>/dev/null ./t.sh', '>out.txt sh t.sh', '<f sh', 'cat f | 2>/dev/null sh',
      'sh -c "$(base64 -d x)"', 'eval "$(base64 -d x)"', '$(base64 -d x)',
      'timeout -s KILL 5 sh t.sh', 'cat f | sudo -u x sh',
      'echo "$(git push)"', 'echo "$(cat .env)"', 'echo "$(cat t.sh | sh)"',
      'source >/dev/null t.sh', 'function f { ./t.sh; }; f', 'curl x | tee >(sh)', 'source <(base64 -d x)', 'cat <(./t.sh)',
      'source ~/.nvm/missing.sh', '. ', 'echo ok # gh', 'cat <<EOF\n# $(gh pr merge 1)\nEOF',
      'parallel sh ::: t.sh', 'watch sh t.sh', 'find . -ok sh {} \;', 'find . -name \'*.sh\' -exec {} \;',
    ];
    for (const command of commands) assert.ok(denied(await bash(ctx, command)), command);
  });
});

test('PowerShell refuses a missing script by its first word, iex and an unknown folder', async () => {
  await inProject(async (ctx) => {
    writeScript(path.join(ctx.main, 'sub', 'u.sh'), 'echo hi\n');
    const commands = ['pwsh t.ps1', 'pwsh -NoProfile t.ps1', 'pwsh -ExecutionPolicy Bypass t.ps1', 'pwsh -File t.ps1', 'Get-Content t.txt | iex',
      'Get-Content t.txt | Invoke-Expression', 'iex (Get-Content t.txt -Raw)', 'iex \'gh x\'',
      'irm x | iex -Verbose', 'x | Invoke-Expression -ErrorAction Stop', 'x | pwsh -NoProfile', 'x | powershell -NoLogo -NonInteractive'];
    for (const command of commands) assert.ok(denied(await withWin(ctx, command, 'darwin', 'PowerShell')), command);
    for (const command of ['pwsh -NoProfile -ExecutionPolicy Bypass -Command Get-ChildItem', 'Set-Location sub; ./u.sh', 'sl sub; ./u.sh',
      'Push-Location sub; ./u.sh', 'chdir sub; ./u.sh']) {
      assert.equal(await withWin(ctx, command, 'darwin', 'PowerShell'), undefined, command);
    }
  });
});

test('on Windows an .env stream, a missing batch file and a missing Git Bash path are refused', async () => {
  await inProject(async (ctx) => {
    for (const command of ['Get-Content .env::$DATA', 'Get-Content \'.env::$DATA\'', 'type .env:x', 'cmd /c t.bat', 'cmd /k t.bat', '/c/nowhere/t.sh']) {
      assert.ok(denied(await withWin(ctx, command)), command);
    }
    assert.equal(await withWin(ctx, 'cmd /c "echo hi"'), undefined);
  });
});

test('the strict splitter reads # as a plain character', () => {
  assert.deepEqual(words('node x.js # note', false), ['node', 'x.js', '#', 'note']);
  assert.equal(words("node x.js # it's", false), null);
});

test('Bash refuses a script a runner starts that is not there yet or the command names, and a bare parallel', async () => {
  await inProject(async (ctx) => {
    for (const command of ['watch ./t.sh', 'watch -n 5 ./t.sh', 'cat f | parallel', 'cat f | parallel -j 4', 'parallel ::: "gh x"',
      'xargs ./t.sh < f', 'find . -exec ./t.sh {} \;', 'find . -execdir ./t.sh {} +', 'curl -o t.sh x; chmod +x t.sh; watch ./t.sh']) {
      assert.ok(denied(await bash(ctx, command)), command);
    }
  });
});


// --- the files that steer an agent ---

const REASON = (out) => out?.hookSpecificOutput?.permissionDecisionReason;
const WRITERS = [['Edit', 'file_path'], ['Write', 'file_path'], ['MultiEdit', 'file_path'], ['NotebookEdit', 'notebook_path']];
const runWithEnv = (base, home, input, { platform = process.platform, env = {} } = {}) => decide(input, { dir: path.join(base, 'managed'), home, platform, pluginRoot: PLUGIN, env });

test('the tool guard refuses an Edit to .vscode/tasks.json with CONTROL_FILE, and every writing tool the same', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const [tool, key] of WRITERS) {
        for (const rel of ['.vscode/tasks.json', '.github/hooks/x.json', '.github/copilot-instructions.md', '.github/skills/a/SKILL.md', 'AGENTS.md', 'docs/deep/AGENTS.md', 'GEMINI.md',
          '.agents/skills/a.md', '.codex/config.toml', '.cursor/rules/a.mdc', '.gemini/settings.json', 'plugin.json', '.plugin/x', 'com.github.copilot/a', '.github/plugin/plugin.json', '.gitattributes']) {
          const out = await run(base, home, call(main, tool, { [key]: path.join(main, ...rel.split('/')) }));
          assert.ok(denied(out), `${tool} ${rel}`);
          assert.equal(REASON(out), CONTROL_FILE, `${tool} ${rel}`);
        }
        // A relative path is placed from the folder the tool runs in.
        assert.equal(REASON(await run(base, home, call(main, tool, { [key]: '.vscode/settings.json' }))), CONTROL_FILE, `${tool} relative`);
        // Neighbours are left alone.
        for (const rel of ['src/a.js', '.github/workflows-notes.md', '.github/ISSUE_TEMPLATE/a.md', 'AGENTS.md.bak', 'docs/MYAGENTS.md', 'sub/plugin.json']) {
          assert.equal(await run(base, home, call(main, tool, { [key]: path.join(main, ...rel.split('/')) })), undefined, `${tool} ${rel}`);
        }
      }
      if (CASE_BLIND) assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: path.join(main, '.VSCode', 'Tasks.json') }))), CONTROL_FILE);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('the tool guard refuses a Write to ~/.copilot/hooks/x.json and to VS Code\'s user settings, whatever the system', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const platform of ['darwin', 'linux']) {
        for (const folder of homeControlFolders({ home, platform, env: {} })) {
          for (const [tool, key] of WRITERS) {
            const out = await runWithEnv(base, home, call(main, tool, { [key]: path.join(folder, 'settings.json') }), { platform });
            assert.equal(REASON(out), CONTROL_FILE, `${platform} ${tool} ${folder}`);
          }
        }
      }
      assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: path.join(home, '.copilot', 'hooks', 'x.json') }))), CONTROL_FILE);
      assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: '~/.copilot/hooks/x.json' }))), CONTROL_FILE, 'by the ~ form');
      assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json') }), 'darwin')), CONTROL_FILE);
      // Windows: %APPDATA%\Code\User, wherever APPDATA points, and the home folder's AppData\Roaming when it is not set.
      const roaming = path.join(home, 'Roam');
      assert.equal(REASON(await runWithEnv(base, home, call(main, 'Write', { file_path: path.join(roaming, 'Code', 'User', 'settings.json') }), { platform: 'win32', env: { APPDATA: roaming } })), CONTROL_FILE);
      assert.equal(REASON(await runWithEnv(base, home, call(main, 'Write', { file_path: path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'tasks.json') }), { platform: 'win32', env: {} })), CONTROL_FILE);
      // Other places in the home folder, and similar names, are left alone.
      for (const rel of ['.copilotx/a', '.vscode/argv.json', 'Library/Application Support/Code/Cache/a', 'notes.txt', '.agentsfoo/a']) {
        assert.equal(await run(base, home, call(main, 'Write', { file_path: path.join(home, ...rel.split('/')) }), 'darwin'), undefined, rel);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('a link inside the worktree that leads to .github/hooks is refused by its real path', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      fs.mkdirSync(path.join(main, '.github', 'hooks'), { recursive: true });
      fs.mkdirSync(path.join(home, '.copilot', 'hooks'), { recursive: true });
      try {
        fs.symlinkSync(path.join(main, '.github', 'hooks'), path.join(main, 'innocent'));
        fs.symlinkSync(path.join(home, '.copilot'), path.join(main, 'steer'));
        fs.symlinkSync(path.join(main, '.vscode'), path.join(main, 'dangling'));
      } catch { return; }
      for (const rel of [['innocent', 'x.json'], ['innocent'], ['steer', 'hooks', 'x.json'], ['dangling', 'tasks.json']]) {
        assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: path.join(main, ...rel) }))), CONTROL_FILE, rel.join('/'));
      }
      // The new file may not exist yet: its nearest existing parent is placed first.
      assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: path.join(main, 'innocent', 'new', 'deeper', 'x.json') }))), CONTROL_FILE);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('a worktree of the project is held to the same files, by its own root', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const worktree = path.join(base, 'wt');
      git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree);
      const real = fs.realpathSync(worktree);
      assert.equal(REASON(await run(base, home, call(real, 'Write', { file_path: path.join(real, '.vscode', 'tasks.json') }))), CONTROL_FILE);
      assert.equal(REASON(await run(base, home, call(real, 'Edit', { file_path: path.join(real, 'sub', 'AGENTS.md') }))), CONTROL_FILE);
      assert.equal(await run(base, home, call(real, 'Write', { file_path: path.join(real, 'src', 'a.js') })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('reading those files is still allowed', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const tool of ['Read']) {
        for (const p of [path.join(main, '.vscode', 'tasks.json'), path.join(main, 'AGENTS.md'), path.join(main, '.github', 'hooks', 'x.json'), path.join(home, '.copilot', 'hooks', 'x.json'),
          path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json')]) {
          assert.equal(await run(base, home, call(main, tool, { file_path: p }), 'darwin'), undefined, `${tool} ${p}`);
        }
      }
      assert.equal(await run(base, home, call(main, 'Grep', { pattern: 'x', path: path.join(main, '.vscode') })), undefined);
      assert.equal(await run(base, home, call(main, 'Glob', { pattern: '**/AGENTS.md', path: main })), undefined);
      assert.equal(await run(base, home, call(main, 'Grep', { pattern: 'x', path: path.join(main, '.github', 'hooks') })), undefined);
      // The shell is judged as before: this guard does not read a command for what it writes.
      assert.equal(await run(base, home, call(main, 'Bash', { command: 'cat .vscode/tasks.json' })), undefined);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('a write to a .git file or anything under a .git folder is refused with CONTROL_FILE, in every project (ruling P5-28)', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      // A worktree's pointer file, as a Lean project's folder has into its store.
      const worktree = path.join(base, 'wt');
      git(main, 'worktree', 'add', '-q', '-b', 'feature', worktree);
      const real = fs.realpathSync(worktree);
      for (const [tool, key] of WRITERS) {
        for (const target of [path.join(real, '.git'), path.join(main, '.git', 'config'), path.join(main, '.git', 'hooks', 'post-merge'),
          path.join(main, '.git', 'refs', 'heads', 'main'), path.join(main, 'sub', '.git')]) {
          assert.equal(REASON(await run(base, home, call(real, tool, { [key]: target }))), CONTROL_FILE, `${tool} ${target}`);
        }
        assert.equal(REASON(await run(base, home, call(real, tool, { [key]: '.git' }))), CONTROL_FILE, `${tool} relative`);
        // Neighbours are left alone, and reading stays allowed.
        for (const rel of ['.gitignore', '.github/workflows/ci.yml', 'src/.gitkeep', 'git/x']) {
          assert.equal(await run(base, home, call(real, tool, { [key]: path.join(real, ...rel.split('/')) })), undefined, `${tool} ${rel}`);
        }
      }
      assert.equal(await run(base, home, call(real, 'Read', { file_path: path.join(real, '.git') })), undefined);
      if (CASE_BLIND) assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: path.join(main, '.GIT', 'config') }))), CONTROL_FILE);
      // On Windows, trailing dots and stream suffixes don't hide it.
      assert.equal(REASON(await run(base, home, call(main, 'Write', { file_path: `${path.join(main, '.git.')}\\config` }), 'win32')), CONTROL_FILE);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

import { segments, segmentsWithOperators } from '../../../scripts/hooks/shell-words.js';

test('segments reads quotes and substitutions nested inside each other', () => {
  assert.deepEqual(segments('echo "$(cat "a b")"', false).flat(), ['echo', '', 'cat', 'a b']);
  assert.deepEqual(segments('echo "a \\" b"', false), [['echo', 'a " b']]);
  assert.deepEqual(segments("echo 'it'\\''s'", false), [['echo', "it's"]]);
  assert.deepEqual(segments('echo "${HOME}/x" "${y:-"a b"}"', false), [['echo', '${HOME}/x', '${y:-a b}']]);
  assert.deepEqual(segments('echo "$(echo ")"; gh pr list)"', false).flat().slice(0, 2), ['echo', '']);
  const found = segmentsWithOperators('echo "$(echo "$(gh x)")"', false);
  assert.ok(found.segments.some((s) => s[0] === 'gh'));
  assert.equal(found.segments.length, found.operators.length);
  assert.deepEqual(segments('git commit -m "$(cat <<\'EOF\'\nSay "why" here\nEOF\n)"', false).flat().includes('why'), true);
});

test('segments gives null for anything it cannot read with confidence', () => {
  const unreadable = [
    'echo "$(gh', 'echo "$(cat "a)"', 'echo $(echo "x)', 'echo `gh', 'echo "`gh',
    'echo "x', "echo 'x", 'echo $(gh', 'echo "${x', 'echo "${x:-\'y\'}"', 'echo "${x:-\\}}"',
    'echo "`echo \\"gh\\"`"', 'echo `echo \\`gh\\``', 'echo `echo "`gh`"`', 'echo `echo $(echo `gh`)`',
    'echo "$(case x in a) gh ;; esac)"', "echo $'x'", 'echo $"x"', 'echo "$(echo $\'x\')"',
    `${'$(echo '.repeat(40)}x${')'.repeat(40)}`, `echo ${'"$(echo '.repeat(33)}x${')"'.repeat(33)}`,
  ];
  for (const command of unreadable) assert.equal(segments(command, false), null, command);
  assert.notEqual(segmentsWithOperators('echo )', false), null);
  assert.notEqual(segments('case $x in a) echo 1 ;; esac', false), null);
  const ok = `echo ${'"$(echo '.repeat(8)}x${')"'.repeat(8)}`;
  assert.notEqual(segments(ok, false), null);
});

test('Bash reads nested quotes inside substitutions, and refuses what hides in them', async () => {
  await inProject(async (ctx) => {
    const allowed = [
      'echo "$(cat "a b")"', 'echo "a \\" b"', 'echo "a \\"gh\\" b"', "echo 'it'\\''s'", 'echo "$(echo "x")"',
      'echo "${HOME}/x"', 'echo "${x:-"y z"}"', 'echo "$(echo "$(echo "a b")")"', 'echo "a `echo b` c"',
      'git commit -m "$(cat <<\'EOF\'\nTidy the guard\n\nSay "why" here\nEOF\n)"',
    ];
    for (const command of allowed) assert.equal(await bash(ctx, command), undefined, command);
    const refused = [
      'echo "$(echo "x" ; gh pr list)"', 'echo "$(cat ".env")"', 'echo "$(printf ")"; gh pr list)"',
      'echo "$(echo "$(gh pr list)")"', 'echo "`gh pr list`"', 'echo "$(echo `gh x`)"', 'echo "`echo \\"gh\\"`"',
      'echo "a \\" $(gh x) \\" b"', 'echo "$(gh', 'echo "$(cat "a)"', 'echo $(echo "x)', 'echo `gh',
      'echo "${x:-"$(gh x)"}"', 'echo "$(echo \'a)\'; gh x)"', 'echo "$(case x in a) gh ;; esac)"',
      `echo ${'"$(echo '.repeat(33)}x${')"'.repeat(33)}`, 'echo "$(echo "x"; git push)"',
    ];
    for (const command of refused) assert.ok(denied(await bash(ctx, command)), command);
  });
});

test('a heredoc body cannot close a frame the shell is still in', async () => {
  await inProject(async (ctx) => {
    const refused = [
      'echo "$(cat <<\'EOF\'\n1)\nEOF\ngh pr list)"',
      'echo "$(cat <<EOF\n1)\nEOF\ngh pr list)"',
      'echo "$(cat <<"EOF"\n1)\nEOF\ngh pr list)"',
      'echo "$(cat <<-EOF\n\t1)\n\tEOF\ngh pr list)"',
      'echo "`cat <<EOF\n1`\nEOF\ngh pr list`"',
      'echo "$(cat <<A <<B\n1)\nA\nx\nB\ngh pr list)"',
      'echo "$(cat <<EOF\nx"\nEOF\ngh pr list)"',
      'echo "$(cat <<EOF\nDon\'t\nEOF\n)"',
      'cat <<EOF\nhello', 'echo "$(cat <<EOF\nhello\n)"', 'cat <<$X\nhello\n$X', 'cat <<\nx',
    ];
    for (const command of refused) assert.ok(denied(await bash(ctx, command)), command);
    const allowed = [
      'git commit -m "$(cat <<\'EOF\'\nTidy (a) and b\nEOF\n)"',
      'git commit -m "$(cat <<-\'EOF\'\n\tTidy (a)\n\tEOF\n)"',
      'cat <<EOF\nhello\nEOF', 'cat <<A <<B\nx\nA\ny\nB', 'cat <<< "hello"',
    ];
    for (const command of allowed) assert.equal(await bash(ctx, command), undefined, command);
  });
});

test('Bash reads heredoc bodies as the shell does, and keeps refusing what they hide', async () => {
  await inProject(async (ctx) => {
    const refused = [
      'cat <<EOF\nIt\'s $(gh pr list) it\'s\nEOF',
      'cat <<EOF\n\'\n$(gh pr list)\n\'\nEOF',
      'git commit -m "$(cat <<EOF\nDon\'t $(gh pr list) won\'t\nEOF\n)"',
      'cat <<\'EOF\'\nit\'s\nEOF\ngh pr list\n\'\nEOF',
      'cat <<EOF\nit\'s\nEOF\ngh pr list\n\'\nEOF',
      'cat <<EOF\nx $(echo "\nEOF\n")',
      'cat <<\'EOF\'\nDon\'t\nEOF',
      'bash <<\'EOF\'\ngh pr list\nEOF', 'sh -s <<EOF\ngh pr list\nEOF', 'cat <<\'EOF\' | sh\ngh pr list\nEOF',
      'source /dev/stdin <<EOF\ngh pr list\nEOF', 'source <(cat <<\'EOF\'\ngh pr list\nEOF\n)',
      '. <(cat <<\'EOF\'\ngh pr list\nEOF\n)', 'eval "$(cat <<\'EOF\'\ngh pr list\nEOF\n)"',
      'cat <<gh\nx\ngh',
    ];
    for (const command of refused) assert.ok(denied(await bash(ctx, command)), command);
    const allowed = [
      'cat <<EOF\nIt\\\'s fine, $(echo hi) and ${HOME} (see 1)\nEOF',
      'cat <<\'EOF\'\nit "quoted" (a)\nEOF',
      'git commit -m "$(cat <<\'EOF\'\nTidy (a) and b\n\nCloses #12\n1) first\nEOF\n)"',
      'cat <<EOF\nhello $(echo "a b")\nEOF\necho done',
    ];
    for (const command of allowed) assert.equal(await bash(ctx, command), undefined, command);
  });
});

test('Bash refuses what hides in comments and case patterns, and a gh word built with $', async () => {
  await inProject(async (ctx) => {
    const refused = [
      'echo x # \'\ngh pr list\n# \'', 'echo "$(echo x # )\ngh pr list\n)"', 'echo "$(echo "$(echo x # )\ngh pr list\n)")"',
      'echo ok # gh', 'echo x # (\ngh pr list',
      'echo "$(! case x in x) gh pr list ;; esac)"', 'echo "$({ case x in x) gh pr list ;; esac; })"',
      'echo "$(if true; then case x in x) gh pr list ;; esac; fi)"', 'echo "$(time case x in x) gh pr list ;; esac)"',
      'echo "$(echo "$(! case x in x) gh pr list ;; esac)")"', 'for i in 1; do echo "$(case x in x) gh pr list ;; esac)"; done',
      'gh$x pr list', 'gh${y} pr list', 'glab$x mr list',
    ];
    for (const command of refused) assert.ok(denied(await bash(ctx, command)), command);
    const allowed = ['echo a#b $# "${#HOME}"', 'echo x # a note', 'case $x in a) echo 1 ;; esac', 'echo "$(echo case)"'.replace('case)', 'cased)'), 'echo "$(echo x) # not a comment"'];
    for (const command of allowed) assert.equal(await bash(ctx, command), undefined, command);
  });
});

test('on Windows a backslash before a quote, $ or a backtick is refused', async () => {
  await inProject(async (ctx) => {
    for (const command of ['echo \\\'; gh pr list; echo \\\'', 'echo \\"; gh pr list; echo \\"', 'echo \\$x', 'echo \\`x']) {
      assert.ok(denied(await withWin(ctx, command)), command);
    }
    assert.equal(await withWin(ctx, 'dir C:\\Users\\x'), undefined);
  });
});

test('Bash refuses where the guard and the shell could disagree about a heredoc', async () => {
  await inProject(async (ctx) => {
    const refused = [
      'echo x # <<EOF\n# \'\ngh pr list\n# \'\nEOF',
      'echo x # <<E\ncat <<\'X\'\n\'\nX\ngh pr list\n\'\nE',
      'echo $[1<<E]\n# \'\ngh pr list\n# \'\nE]',
      'echo ${x:-<<E}\n# \'\ngh pr list\n# \'\nE}',
      'echo ${x:-${y}<<E}\n# \'\ngh pr list\n# \'\nE}',
      'cat <<EOF\r\nEOF\n\'\n$(gh pr list)\n\'\nEOF\r\n',
      'echo "$(echo x)"\r\ngh pr list',
      'cat <<A\ncat <<B\n\'\nB\nA\ngh pr list',
      'cat <<EOF\n\'\nE\\\nOF\ngh pr create #\'\nEOF',
      'cat <<EOF\nx $(\n\'\nEOF\ngh pr create #\'\n)\nEOF',
      'cat <<EOF\nx `\n\'\nEOF\ngh pr create #\'\n`\nEOF',
    ];
    for (const command of refused) assert.ok(denied(await bash(ctx, command)), command);
    const windows = ['echo \\<<EOF\n# \'\ngh pr list\n# \'\nEOF', 'echo \;gh pr list', 'echo a\\ b', 'echo \\#x', 'echo \\|x'];
    for (const command of windows) assert.ok(denied(await withWin(ctx, command)), command);
    const allowed = ['npm test # run tests (all)', 'git commit -m "x" # done (wip)', 'git commit -m "$(cat <<\'EOF\'\nTidy\n\nCloses #12 (partial)\nEOF\n)"', 'cat <<EOF\nE\\\nOF\nEOF', 'echo "a < b" \'<<x\'', 'echo ${x:-y} ${#x}', 'cat <<EOF\nhello\nEOF\necho done', 'echo \'a\rb\''];
    for (const command of allowed) assert.equal(await bash(ctx, command), undefined, command);
    assert.equal(await withWin(ctx, 'dir C:\\Users\\x'), undefined);
  });
});

test('the splitter reads long inputs in linear time', () => {
  const inputs = [
    ['gh x; ' + '# '.repeat(30000), 'gh'], ['${'.repeat(30000), '${'.repeat(30000)], ['echo ${a}${b}\n'.repeat(5000), 'echo'], ['a # b\n'.repeat(10000), 'a'],
  ];
  for (const [command, first] of inputs) {
    const start = Date.now();
    const found = segments(command, false);
    assert.ok(Date.now() - start < 1000, `${command.slice(0, 20)} took ${Date.now() - start} ms`);
    assert.ok(found.flat().includes(first), command.slice(0, 20));
  }
});

test('an unreadable command is refused with its own message, and a PowerShell line continuation is read', async () => {
  await inProject(async (ctx) => {
    const unreadable = await bash(ctx, 'echo "x');
    assert.match(unreadable.hookSpecificOutput.permissionDecisionReason, /could not read this command with certainty/);
    const host = await bash(ctx, 'gh pr list');
    assert.doesNotMatch(host.hookSpecificOutput.permissionDecisionReason, /certainty/);
    assert.equal(await withWin(ctx, 'Get-ChildItem `\n  -Force', 'darwin', 'PowerShell'), undefined);
    assert.ok(denied(await withWin(ctx, 'Get-ChildItem `\r\n  -Force', 'darwin', 'PowerShell')));
    assert.ok(denied(await withWin(ctx, 'echo `\n gh pr list', 'darwin', 'PowerShell')));
  });
});

// The keychain (the security-gaps plan's Task 10, part two). A backstop to the sandbox's denial
// of ~/Library/Keychains (check 73): only the plain command line is refused.
const KEYCHAIN = /keychain/;
const KEYCHAIN_REFUSED = [
  'security find-generic-password -s gh:github.com -w', 'security find-internet-password -s github.com', 'security dump-keychain',
  'security export -k login.keychain -t all', '/usr/bin/security find-generic-password -w', 'SECURITY Find-Generic-Password -w',
  'security -q find-generic-password -w', 'security$X find-generic-password', 'security find-generic-password$X -w',
  'sudo security dump-keychain -d', 'env A=1 security find-internet-password', 'xargs security find-generic-password -w',
  'sh -c "security find-generic-password -w"', 'x; security dump-keychain', 'true && security find-generic-password -s x -w > out.txt',
  'S=security; $S find-generic-password -w', 'echo find-generic-password | security -i', 'security -qi', 'security -p "> "',
  // security takes the first part of a command's name; a redirect or a variable doesn't hide it.
  'security find -s x -w', 'security find-g -s x -w', 'security find-i -s x', 'security dump', 'security ex -k login.keychain',
  'security 2>/dev/null find-generic-password -s x -w', 'security >out.txt find-generic-password -w', 'C=find-generic-password; security $C -s x -w',
  'echo find-generic-password -s x -w | xargs security', 'find . -name k -exec security {} \\;', 'timeout 5 security find-generic-password -w',
];
for (const cmd of KEYCHAIN_REFUSED) {
  test(`Bash refuses a read of the keychain: ${cmd}`, async () => {
    await withHome(async (home) => {
      const { base, main } = makeProject();
      try {
        const out = await run(base, home, call(main, 'Bash', { command: cmd }), 'darwin');
        assert.ok(denied(out));
        assert.match(out.hookSpecificOutput.permissionDecisionReason, KEYCHAIN);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
  });
}

test('Bash allows the security tool\'s other commands and words that only mention the keychain\'s', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const cmd of ['security list-keychains', 'security find-identity -v -p codesigning', 'security find-certificate -p -c x',
        'security', 'security -h', 'grep -rn "security find-generic-password" docs', 'git commit -m "Refuse security dump-keychain"',
        'grep security notes.md | grep find-generic-password', 'npm audit --security find-generic-password',
        'export LABEL=security', 'TOPIC=security; export TOPIC', 'grep security -ri src/', 'echo security dump-keychain',
        'security unlock-keychain -p "$PW" build.keychain', 'security export-smartcard', 'security 2>/dev/null list-keychains',
        'find . -name k -exec security find-certificate -c {} \\;']) {
        assert.equal(await run(base, home, call(main, 'Bash', { command: cmd }), 'darwin'), undefined, cmd);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

test('PowerShell and Monitor refuse a read of the keychain too', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      for (const tool of ['PowerShell', 'Monitor']) {
        const out = await run(base, home, call(main, tool, { command: 'security find-generic-password -w' }), 'darwin');
        assert.ok(denied(out), tool);
        assert.match(out.hookSpecificOutput.permissionDecisionReason, KEYCHAIN);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});
