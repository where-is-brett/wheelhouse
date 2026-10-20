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

test('.env, .env.local and .ENV.local are refused; .env.example is read', async () => {
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
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(main, '.env.example') })), undefined);
      assert.equal(await run(base, home, call(main, 'Read', { file_path: path.join(main, 'a.txt') })), undefined);
      assert.ok(denied(await run(base, home, call(main, 'Glob', { pattern: '**/.env*' }))));
      assert.ok(denied(await run(base, home, call(main, 'Grep', { pattern: 'x', glob: '.env.local' }))));
      assert.equal(await run(base, home, call(main, 'Glob', { pattern: '**/.env.example' })), undefined);
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
      for (const cmd of ['git commit -m "Add the thing"', 'git status && git diff', 'node scripts/x.js --flag', 'cat .env.example', 'ls -la | wc -l',
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
      for (const command of ['pwsh -NoProfile -Command Get-ChildItem', 'pwsh -ExecutionPolicy Bypass -File build.ps1', 'echo -e hi', 'pwsh -File x.ps1']) {
        assert.equal(await run(base, home, call(main, 'Bash', { command }), 'darwin'), undefined, command);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});
