// tests/scripts/hooks/stop.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { decide as guard, READ_TOOLS, HALT_TOOLS, NOTIFY_TOOLS, DENIED, SANDBOX_NEEDED } from '../../../scripts/hooks/stop-guard.js';
import { decide as word, CONTEXT } from '../../../scripts/hooks/stop-word.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stopState, setStop, liftStop } from '../../../scripts/lib/stop.js';
import { bypassDir } from '../../../scripts/lib/paths.js';

const temp = (prefix) => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

async function withHome(fn) {
  const home = temp('wh-stop-home-');
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

// A registered project with one commit, in a temporary folder.
function makeProject() {
  const base = temp('wh-stop-repo-');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'a.txt'), 'a');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'first');
  writeProject('owner__name', {
    folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  });
  return { base, main };
}

const PLUGIN = '/plugin/root';
const deps = (base) => ({ event: 'PreToolUse', dir: path.join(base, 'managed'), pluginRoot: PLUGIN });
const call = (cwd, tool, extra = {}) => ({
  cwd, session_id: 'sess-1', hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: tool, tool_input: {}, ...extra,
});
const bash = (cwd, command) => call(cwd, 'Bash', { tool_input: { command } });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

test('under STOP, Edit, Write, Bash, Agent and mcp__ tools are refused; Read and Grep are not', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      for (const tool of ['Edit', 'Write', 'MultiEdit', 'Bash', 'Agent', 'Task', 'mcp__github__create_issue', 'SendMessage', 'Unknown']) {
        const out = await guard(call(main, tool), deps(base));
        assert.ok(denied(out), tool);
        assert.equal(out.hookSpecificOutput.permissionDecisionReason, DENIED);
      }
      assert.equal(DENIED, 'STOP is on: only reading, reporting and the runbook carry on');
      for (const tool of READ_TOOLS) assert.equal(await guard(call(main, tool), deps(base)), undefined, tool);
      liftStop();
      assert.equal(await guard(call(main, 'Edit'), deps(base)), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('under STOP, the runbook command is let through and the same words with another path are not', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const run = `${PLUGIN}/scripts/runbook/runbook.js`;
      for (const ok of [
        `node ${run} lift-stop`,
        `node "${run}" status --json`,
        `node '${run}' status`,
      ]) assert.equal(await guard(bash(main, ok), deps(base)), undefined, ok);
      for (const bad of [
        'node /elsewhere/scripts/runbook/runbook.js status',
        `node ${PLUGIN}-x/scripts/runbook/runbook.js status`,
        `node ${run}`,
        `node ${run} status; rm -rf x`,
        `node ${run} status && ls`,
        `node ${run} status | cat`,
        `node ${run} status > out`,
        `node ${run} status < in`,
        `node ${run} status \`id\``,
        `node ${run} $(id)`,
        `node ${run} status\nls`,
        `node ${run} status &`,
        `bash ${run} status`,
        `node /other/x.js ${run} status`,
      ]) assert.ok(denied(await guard(bash(main, bad), deps(base))), bad);
      assert.ok(denied(await guard(call(main, 'Bash', { tool_input: {} }), deps(base))));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('under STOP, a feature session may read an answer and check its report, and may not ask or open a pull request', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const cli = `${PLUGIN}/scripts/feature/cli.js`;
      for (const ok of [
        `node ${cli} answer q-login-page-1`,
        `node "${cli}" answer q-login-page-12`,
        `node '${cli}' answer "q-login-page-1"`,
        `node ${cli} report`,
        `node "${cli}" report`,
      ]) assert.equal(await guard(bash(main, ok), deps(base)), undefined, ok);
      for (const bad of [
        `node ${cli} ask --what x --why y --option a=b --option c=d --recommend a --level 2`,
        `node ${cli} open-pr --title x`,
        `node ${cli}`,
        `node ${cli} answer`,
        `node ${cli} answer q-login-page-1 extra`,
        `node ${cli} answer ../x`,
        `node ${cli} answer --help`,
        `node ${cli} report extra`,
        `node ${cli} report --out x`,
        `node ${cli} report; rm -rf x`,
        `node ${cli} report && ls`,
        `node ${cli} report | cat`,
        `node ${cli} report > out`,
        `node ${cli} answer $(id)`,
        `node ${cli} answer q-login-page-1\nls`,
        `node ${cli} answer q-login-page-1 &`,
        `node /elsewhere/scripts/feature/cli.js report`,
        `node ${PLUGIN}-x/scripts/feature/cli.js report`,
        `bash ${cli} report`,
        `node /other/x.js ${cli} report`,
        `node ${PLUGIN}/scripts/feature/files.js report`,
      ]) assert.ok(denied(await guard(bash(main, bad), deps(base))), bad);
      // The same words are no runbook command, and the runbook's are no feature command.
      assert.ok(denied(await guard(bash(main, `node ${PLUGIN}/scripts/runbook/runbook.js`), deps(base))));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('under STOP, the front desk\'s reading commands run by their exact words, and its writing ones do not', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const cli = `${PLUGIN}/scripts/frontdesk/cli.js`;
      for (const ok of [
        `node ${cli} cards`,
        `node "${cli}" cards`,
        `node '${cli}' again 3`,
        `node "${cli}" again 12`,
        ...['rulebook', 'waiting', 'ideas', 'glossary', 'settings', 'levels', 'work'].map((name) => `node "${cli}" views ${name}`),
        `node "${cli}" explain merge`,
        `node "${cli}" explain pull request`,
        `node "${cli}" explain "pull request"`,
        `node "${cli}" explain the-done-contract`,
        `node "${cli}" similar`,
        // The request's words as plain arguments, quoted or not: nothing a shell would expand.
        `node "${cli}" similar export the orders to a spreadsheet`,
        `node "${cli}" similar "Could we export the orders, as a spreadsheet?"`,
        `node "${cli}" similar "can't sign in on the phone"`,
        `node "${cli}" preview 7`,
      ]) assert.equal(await guard(bash(main, ok), deps(base)), undefined, ok);
      for (const bad of [
        `node ${cli}`,
        `node "${cli}" card`,
        `node "${cli}" record ruling`,
        `node "${cli}" record idea`,
        `node "${cli}" cards extra`,
        `node "${cli}" cards --all`,
        `node "${cli}" again`,
        `node "${cli}" again 0`,
        `node "${cli}" again 03`,
        `node "${cli}" again -1`,
        `node "${cli}" again 1 2`,
        `node "${cli}" again x`,
        `node "${cli}" views`,
        `node "${cli}" views secrets`,
        `node "${cli}" views rulebook extra`,
        // The delegation review writes its proposals, so it waits for STOP to be lifted.
        `node "${cli}" review`,
        `node "${cli}" explain`,
        `node "${cli}" explain --help`,
        `node "${cli}" explain ../x`,
        `node "${cli}" explain ${'word '.repeat(6).trim()}`,
        `node "${cli}" similar "$HOME"`,
        `node "${cli}" similar export *`,
        `node "${cli}" similar "a {b}"`,
        `node "${cli}" similar --help`,
        `node "${cli}" similar ~/notes`,
        `node "${cli}" similar fix #12 now`,
        `node "${cli}" similar "a [b]"`,
        `node "${cli}" preview`,
        `node "${cli}" preview x`,
        `node "${cli}" preview 7 8`,
        `node "${cli}" cards; rm -rf x`,
        `node "${cli}" cards && ls`,
        `echo hi | node "${cli}" similar`,
        `node "${cli}" similar < request.txt`,
        `node "${cli}" cards > out`,
        `node "${cli}" views $(id)`,
        `node "${cli}" cards\nls`,
        `node "${cli}" cards &`,
        'node /elsewhere/scripts/frontdesk/cli.js cards',
        `node ${PLUGIN}-x/scripts/frontdesk/cli.js cards`,
        `bash ${cli} cards`,
        `node /other/x.js ${cli} cards`,
        `node ${PLUGIN}/scripts/frontdesk/glossary.js cards`,
      ]) assert.ok(denied(await guard(bash(main, bad), deps(base))), bad);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('under STOP, the foreman may read a wake and record it done, and nothing more of its commands', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const wake = `${PLUGIN}/scripts/foreman/wake.js`;
      const act = `${PLUGIN}/scripts/foreman/act.js`;
      const file = `${main}/.wheelhouse/foreman/wakes/2026-10-19T09-00-00-000Z.json`;
      for (const ok of [
        `node '${wake}' read ${file}`,
        `node '${wake}' read '${file}'`,
        `node "${wake}" read .wheelhouse/foreman/wakes/one.json`,
        `node '${wake}' done ${file} --acted`,
        `node '${wake}' done ${file} --idle`,
      ]) assert.equal(await guard(bash(main, ok), deps(base)), undefined, ok);
      for (const bad of [
        `node '${wake}' measures`,
        `node '${wake}' read`,
        `node '${wake}' read ${file} ${file}`,
        `node '${wake}' read --help`,
        `node '${wake}' read ${main}/notes.txt`,
        `node '${wake}' done ${file}`,
        `node '${wake}' done ${file} --busy`,
        `node '${wake}' done ${file} --acted --idle`,
        `node '${wake}' read ${file}; rm -rf x`,
        `node '${wake}' read ${file} && node '${act}' merge x`,
        `node '${wake}' read $(id).json`,
        `node '${act}' merge x`,
        `node '${act}' close x`,
        `node /elsewhere/scripts/foreman/wake.js read ${file}`,
      ]) assert.ok(denied(await guard(bash(main, bad), deps(base))), bad);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('under STOP, uninstall\'s plan and status run in a project, and its apply does not (rulings R90, R91)', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const cli = `${PLUGIN}/scripts/setup/cli.js`;
      for (const ok of [`node ${cli} uninstall plan`, `node '${cli}' uninstall status`, `node "${cli}" uninstall plan`]) {
        assert.equal(await guard(bash(main, ok), deps(base)), undefined, ok);
      }
      for (const bad of [
        `node ${cli} uninstall apply ${'a'.repeat(64)}`,
        `node ${cli} uninstall apply`,
        `node ${cli} uninstall`,
        `node ${cli} uninstall plan now`,
        `node ${cli} uninstall status ${'a'.repeat(64)}`,
        `node ${cli} uninstall plan; rm -rf x`,
        `node ${cli} uninstall status && node ${cli} uninstall apply ${'a'.repeat(64)}`,
        `node /elsewhere/scripts/setup/cli.js uninstall plan`,
      ]) assert.ok(denied(await guard(bash(main, bad), deps(base))), bad);
    } finally {
      liftStop();
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('under STOP, a worktree whose .git file was rewritten is still held by its main folder', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const tree = path.join(main, 'trees', 'one');
      fs.mkdirSync(tree, { recursive: true });
      fs.writeFileSync(path.join(tree, '.git'), 'gitdir: /nowhere/at/all\n');
      setStop({ by: 'prompt' });
      assert.ok(denied(await guard(call(tree, 'Write'), deps(base))));
      // Outside every project, nothing is guarded.
      const stranger = temp('wh-stop-stranger-');
      try {
        assert.equal(await guard(call(stranger, 'Write'), deps(base)), undefined);
      } finally {
        fs.rmSync(stranger, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('stop, Stop., /stop and STOP! set STOP; "stop the build after this" does not', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const d = { event: 'UserPromptSubmit', dir: path.join(base, 'managed') };
      for (const prompt of ['stop', ' Stop. ', '/stop', 'STOP!', '/STOP.']) {
        liftStop();
        const out = await word({ cwd: main, prompt }, d);
        assert.equal(stopState().on, true, prompt);
        assert.equal(stopState().by, 'prompt');
        assert.deepEqual(out, { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: CONTEXT } });
      }
      assert.equal(CONTEXT, 'STOP is on. Say in one or two lines what was in progress; lifting it is a card for the director.');
      liftStop();
      for (const prompt of ['stop the build after this', 'please stop', 'stopping', 'stop stop', '', 'stop?']) {
        assert.equal(await word({ cwd: main, prompt }, d), undefined, prompt);
        assert.equal(stopState().on, false, prompt);
      }
      // A worktree with a rewritten .git file still counts, by its folder.
      const tree = path.join(main, 'trees', 'one');
      fs.mkdirSync(tree, { recursive: true });
      fs.writeFileSync(path.join(tree, '.git'), 'gitdir: /nowhere\n');
      await word({ cwd: tree, prompt: 'stop' }, d);
      assert.equal(stopState().on, true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('a call in bypass mode marks the session; the next call in another mode clears it', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const marker = path.join(bypassDir(), 'sess-1');
      assert.equal(await guard(call(main, 'Read', { permission_mode: 'bypassPermissions' }), deps(base)), undefined);
      assert.equal(fs.existsSync(marker), true);
      await guard(call(main, 'Read', { permission_mode: 'acceptEdits' }), deps(base));
      assert.equal(fs.existsSync(marker), false);
      await guard(call(main, 'Read', { permission_mode: 'bypassPermissions' }), deps(base));
      await guard(call(main, 'Read', { permission_mode: undefined }), deps(base));
      assert.equal(fs.existsSync(marker), false);
      // The mark is made before the STOP check.
      setStop({ by: 'prompt' });
      assert.ok(denied(await guard(call(main, 'Edit', { permission_mode: 'bypassPermissions' }), deps(base))));
      assert.equal(fs.existsSync(marker), true);
      // SessionEnd clears it and answers nothing.
      const end = await guard({ cwd: main, session_id: 'sess-1', hook_event_name: 'SessionEnd', reason: 'other' }, { ...deps(base), event: 'SessionEnd' });
      assert.equal(end, undefined);
      assert.equal(fs.existsSync(marker), false);
      // A bad session id throws, so the guard denies through hookMain.
      await assert.rejects(async () => guard(call(main, 'Read', { session_id: '../x', permission_mode: 'bypassPermissions' }), deps(base)));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('outside a Wheelhouse project neither hook does anything', async () => {
  await withHome(async () => {
    const stranger = temp('wh-stop-out-');
    try {
      setStop({ by: 'helper' });
      assert.equal(await guard(call(stranger, 'Write', { permission_mode: 'bypassPermissions' }), deps(stranger)), undefined);
      assert.equal(fs.existsSync(path.join(bypassDir(), 'sess-1')), false);
      liftStop();
      assert.equal(await word({ cwd: stranger, prompt: 'stop' }, { event: 'UserPromptSubmit', dir: path.join(stranger, 'm') }), undefined);
      assert.equal(stopState().on, false);
    } finally {
      fs.rmSync(stranger, { recursive: true, force: true });
    }
  });
});

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'hooks', 'stop-guard.js');

test('backslashes: refused unquoted off Windows, literal in single quotes, folded only on Windows', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const run = `${PLUGIN}/scripts/runbook/runbook.js`;
      const sibling = 'node /plugin\\root/scripts/runbook/runbook.js status';
      const ask = async (command, platform) => guard(bash(main, command), { ...deps(base), platform });
      // The sibling-path case: bash would run /pluginroot/..., so it is refused.
      assert.ok(denied(await ask(sibling, 'linux')));
      assert.ok(denied(await ask(sibling, 'darwin')));
      // Single quotes: the backslash is literal, so this is a different path.
      assert.ok(denied(await ask("node '/plugin\\root/scripts/runbook/runbook.js' status", 'linux')));
      // Double quotes: an escape pair is refused; a lone backslash stays literal (a different path).
      for (const esc of ['\\"', '\\$', '\\`', '\\\\']) {
        assert.ok(denied(await ask(`node "${run}${esc}" status`, 'linux')), esc);
      }
      assert.ok(denied(await ask(`node "/plugin\\root/scripts/runbook/runbook.js" status`, 'linux')));
      // On Windows the backslash folds to a slash, quoted or not.
      const win = run.replaceAll('/', '\\');
      assert.equal(await ask(`node "${win}" status`, 'win32'), undefined);
      assert.equal(await ask(`node '${win}' status`, 'win32'), undefined);
      assert.equal(await ask(`node ${win} status`, 'win32'), undefined);
      assert.ok(denied(await ask(`node ${win}x status`, 'win32')));
      // The escape pairs stay refused on Windows too.
      assert.ok(denied(await ask(`node "${run}\\"" status`, 'win32')));
      assert.equal(await ask(`node ${run} status`, 'linux'), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the runbook command splits on space and tab only; other whitespace is refused', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      const run = `${PLUGIN}/scripts/runbook/runbook.js`;
      assert.equal(await guard(bash(main, `node\t${run}\tstatus`), deps(base)), undefined);
      for (const space of ['\u00a0', '\u2028', '\u3000', '\u2003', '\f', '\v']) {
        assert.ok(denied(await guard(bash(main, `node ${run}${space}status`), deps(base))), JSON.stringify(space));
        assert.ok(denied(await guard(bash(main, `node${space}${run} status`), deps(base))), JSON.stringify(space));
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('TaskStop and KillShell are let through under STOP; they are not reading tools', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      assert.deepEqual(HALT_TOOLS, ['TaskStop', 'KillShell']);
      for (const tool of HALT_TOOLS) {
        assert.ok(!READ_TOOLS.includes(tool));
        assert.equal(await guard(call(main, tool), deps(base)), undefined, tool);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('Claude Code\'s notification tool is let through under STOP, by its exact name, and nothing else new', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      setStop({ by: 'prompt' });
      assert.deepEqual(NOTIFY_TOOLS, ['PushNotification']);
      // Not a reading tool, so the lineage hold, which shares READ_TOOLS, still holds it.
      assert.ok(!READ_TOOLS.includes('PushNotification') && !HALT_TOOLS.includes('PushNotification'));
      assert.equal(await guard(call(main, 'PushNotification', { tool_input: { message: 'STOP is on', status: 'proactive' } }), deps(base)), undefined);
      // Near names and other tools that send or reach outside are still refused.
      for (const tool of ['pushnotification', 'PushNotification ', 'Notification', 'PushNotifications', 'SendMessage', 'RemoteTrigger', 'mcp__slack__send_message', 'Bash']) {
        const out = await guard(call(main, tool, { tool_input: { message: 'x', command: 'ls' } }), deps(base));
        assert.ok(denied(out), JSON.stringify(tool));
        assert.equal(out.hookSpecificOutput.permissionDecisionReason, DENIED);
      }
      // A Bash command naming it is a command like any other.
      assert.ok(denied(await guard(bash(main, 'PushNotification'), deps(base))));
      // Outside STOP it passes, as every tool does.
      liftStop();
      assert.equal(await guard(call(main, 'PushNotification'), deps(base)), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('in a Locked project without the sandbox, the notification tool is not held to the sandbox, and Bash still is', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const d = { ...deps(base), dir: lockProject(base, main) };
      setStop({ by: 'prompt' });
      assert.equal(await guard(call(main, 'PushNotification'), d), undefined);
      const out = await guard(call(main, 'Bash', { tool_input: { command: 'ls' } }), d);
      assert.equal(out.hookSpecificOutput.permissionDecisionReason, SANDBOX_NEEDED);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('bypass is marked and cleared for a rewritten-.git worktree by its main folder', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const tree = path.join(main, 'trees', 'one');
      fs.mkdirSync(tree, { recursive: true });
      fs.writeFileSync(path.join(tree, '.git'), 'gitdir: /nowhere/at/all\n');
      const marker = path.join(bypassDir(), 'sess-1');
      await guard(call(tree, 'Read', { permission_mode: 'bypassPermissions' }), deps(base));
      assert.equal(fs.existsSync(marker), true);
      await guard(call(tree, 'Read', { permission_mode: 'default' }), deps(base));
      assert.equal(fs.existsSync(marker), false);
      await guard(call(tree, 'Read', { permission_mode: 'bypassPermissions' }), deps(base));
      await guard({ cwd: tree, session_id: 'sess-1', hook_event_name: 'SessionEnd' }, { ...deps(base), event: 'SessionEnd' });
      assert.equal(fs.existsSync(marker), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('stop-word takes the slash forms, repeated marks and zero-width characters', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const d = { event: 'UserPromptSubmit', dir: path.join(base, 'managed') };
      for (const prompt of ['/wheelhouse:stop', '/stop now', '/Wheelhouse:STOP please', 'STOP!!', 'stop..', 'stop!.!', '\u200bstop', '\ufeffStop\u200b.', 'st\u200bop']) {
        liftStop();
        assert.ok(await word({ cwd: main, prompt }, d), prompt);
        assert.equal(stopState().on, true, prompt);
      }
      liftStop();
      for (const prompt of ['/stopping', '/wheelhouse:stopwatch', 'stop, then go', '/stop\nmore', '/other:stop']) {
        assert.equal(await word({ cwd: main, prompt }, d), undefined, prompt);
        assert.equal(stopState().on, false, prompt);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('commands/stop.md does not claim STOP is on', () => {
  const text = fs.readFileSync(path.join(ROOT, 'commands', 'stop.md'), 'utf8');
  assert.match(text, /one or two lines/);
  assert.match(text, /only if the hook/);
  assert.doesNotMatch(text, /^STOP is on\./m);
});

function runScript(home, stdin) {
  const result = spawnSync(process.execPath, [SCRIPT], { input: stdin, env: { ...process.env, WHEELHOUSE_HOME: home }, encoding: 'utf8' });
  return { code: result.status, out: result.stdout };
}
const DENY = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Wheelhouse\'s check could not run' } };

test('the stop-guard script denies on empty or bad input, and is silent when SessionEnd fails', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      assert.deepEqual(JSON.parse(runScript(home, '').out), DENY);
      assert.deepEqual(JSON.parse(runScript(home, '{not json').out), DENY);
      const end = runScript(home, JSON.stringify({ cwd: main, session_id: '../bad', hook_event_name: 'SessionEnd' }));
      assert.deepEqual(end, { code: 0, out: '' });
      const bad = runScript(home, JSON.stringify({ cwd: main, session_id: '../bad', hook_event_name: 'PreToolUse', tool_name: 'Read', permission_mode: 'default' }));
      assert.deepEqual(JSON.parse(bad.out), DENY);
      const fine = runScript(home, JSON.stringify({ cwd: main, session_id: 'ok-1', hook_event_name: 'PreToolUse', tool_name: 'Read', permission_mode: 'default' }));
      assert.deepEqual(fine, { code: 0, out: '' });
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

// A Locked project: the managed folder lists it; the project's settings say whether the sandbox is on.
function lockProject(base, main) {
  const dir = path.join(base, 'managed');
  fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'wheelhouse', 'locked-projects.json'), JSON.stringify([main]));
  return dir;
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

test('in a Locked project, Bash and PowerShell are refused unless the sandbox is on in the project\'s settings', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const dir = lockProject(base, main);
      const d = { ...deps(base), dir };
      const REASON = 'Locked needs the sandbox on in this project\'s settings';
      const settings = path.join(main, '.claude', 'settings.json');
      const local = path.join(main, '.claude', 'settings.local.json');
      const refused = async (tool = 'Bash') => {
        const out = await guard(call(main, tool, { tool_input: { command: 'ls' } }), d);
        return denied(out) && out.hookSpecificOutput.permissionDecisionReason === REASON;
      };
      // No settings at all.
      assert.ok(await refused());
      assert.ok(await refused('PowerShell'));
      // Unreadable, false, or a non-true value.
      writeJson(settings, '{ nope');
      assert.ok(await refused());
      writeJson(settings, { sandbox: { enabled: false } });
      assert.ok(await refused());
      writeJson(settings, { sandbox: { enabled: 'true' } });
      assert.ok(await refused());
      // On.
      writeJson(settings, { sandbox: { enabled: true } });
      assert.equal(await guard(call(main, 'Bash', { tool_input: { command: 'ls' } }), d), undefined);
      assert.equal(await guard(call(main, 'PowerShell', { tool_input: { command: 'ls' } }), d), undefined);
      // The local file wins when it sets the key; silent about it leaves the shared value.
      writeJson(local, { sandbox: { enabled: false } });
      assert.ok(await refused());
      writeJson(local, { sandbox: {} });
      assert.equal(await guard(call(main, 'Bash', { tool_input: { command: 'ls' } }), d), undefined);
      writeJson(settings, { sandbox: { enabled: false } });
      writeJson(local, { sandbox: { enabled: true } });
      assert.equal(await guard(call(main, 'Bash', { tool_input: { command: 'ls' } }), d), undefined);
      // Other tools are not held to it, and a project that is not Locked is not either.
      writeJson(local, { sandbox: { enabled: false } });
      assert.equal(await guard(call(main, 'Read'), d), undefined);
      assert.equal(await guard(call(main, 'Bash', { tool_input: { command: 'ls' } }), { ...deps(base), dir: path.join(base, 'elsewhere') }), undefined);
      // A sub-folder reads the worktree root's settings.
      const sub = path.join(main, 'src');
      fs.mkdirSync(sub);
      writeJson(local, { sandbox: { enabled: true } });
      assert.equal(await guard(call(sub, 'Bash', { tool_input: { command: 'ls' } }), d), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the sandbox check also covers a worktree whose .git points nowhere but lies inside a Locked project', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const dir = lockProject(base, main);
      const tree = path.join(main, 'trees', 'one');
      fs.mkdirSync(tree, { recursive: true });
      fs.writeFileSync(path.join(tree, '.git'), 'gitdir: /nowhere/at/all\n');
      const out = await guard(call(tree, 'Bash', { tool_input: { command: 'ls' } }), { ...deps(base), dir });
      assert.ok(denied(out));
      assert.equal(out.hookSpecificOutput.permissionDecisionReason, 'Locked needs the sandbox on in this project\'s settings');
      writeJson(path.join(tree, '.claude', 'settings.json'), { sandbox: { enabled: true } });
      assert.equal(await guard(call(tree, 'Bash', { tool_input: { command: 'ls' } }), { ...deps(base), dir }), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the managed copy lets the plugin\'s runbook through under STOP, by the root recorded at install', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const dir = lockProject(base, main);
      writeJson(path.join(dir, 'wheelhouse', 'installed.json'), { version: '0', at: 'x', pluginRoot: '/real/plugin' });
      setStop({ by: 'prompt' });
      const own = path.join(dir, 'wheelhouse');
      const managedSelf = path.join(own, 'scripts', 'hooks', 'stop-guard.js');
      const pluginSelf = '/plugin/root/scripts/hooks/stop-guard.js';
      const ask = (command, extra) => guard(bash(main, command), { ...deps(base), dir, pluginRoot: extra.pluginRoot, self: extra.self });
      const managed = { pluginRoot: own, self: managedSelf };
      writeJson(path.join(main, '.claude', 'settings.json'), { sandbox: { enabled: true } });
      assert.equal(await ask('node /real/plugin/scripts/runbook/runbook.js status', managed), undefined);
      assert.equal(await ask(`node ${own}/scripts/runbook/runbook.js status`, managed), undefined);
      assert.ok(denied(await ask('node /other/plugin/scripts/runbook/runbook.js status', managed)));
      // The plugin's copy does not take the recorded root.
      const plugin = { pluginRoot: '/plugin/root', self: pluginSelf };
      assert.ok(denied(await ask('node /real/plugin/scripts/runbook/runbook.js status', plugin)));
      assert.equal(await ask('node /plugin/root/scripts/runbook/runbook.js status', plugin), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
