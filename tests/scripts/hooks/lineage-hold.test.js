// tests/scripts/hooks/lineage-hold.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, HELD } from '../../../scripts/hooks/lineage-hold.js';
import { HALT_TOOLS, READ_TOOLS } from '../../../scripts/hooks/stop-guard.js';
import { hookMain, projectOf } from '../../../scripts/hooks/kit.js';
import { MATCHED, checkLineage, holdFile, main as check } from '../../../scripts/lineage/check.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder } from '../../helpers/homes.js';
import { lineageFixture } from '../../helpers/lineage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'hooks', 'lineage-hold.js');
const CHECK = path.join(ROOT, 'scripts', 'lineage', 'check.js');
const P = 'owner__name';
const PLUGIN = '/plugin/root';

async function withHome(fn) {
  const home = fs.realpathSync.native(tempFolder('wh-hold-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}

// A registered project whose main folder has a .git folder (the hooks read files only).
function makeProject() {
  const main = fs.realpathSync.native(tempFolder('wh-hold-repo-'));
  fs.mkdirSync(path.join(main, '.git'));
  writeProject(P, { folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
  return main;
}

function hold(project = P) {
  fs.mkdirSync(path.dirname(holdFile(project)), { recursive: true });
  fs.writeFileSync(holdFile(project), JSON.stringify({ at: '2026-10-19T00:00:00.000Z', mismatches: [] }));
}

const call = (cwd, tool, toolInput = {}) => ({ cwd, session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput });
const bash = (cwd, command) => call(cwd, 'Bash', { command });
const deps = (home, extra = {}) => ({ dir: path.join(home, 'managed'), pluginRoot: PLUGIN, platform: 'linux', ...extra });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny' && out.hookSpecificOutput.permissionDecisionReason === HELD;

test('while held, Edit, Write and Bash are refused, and reading and halting are not', async () => {
  await withHome(async (home) => {
    const main = makeProject();
    for (const tool of ['Edit', 'Write', 'Bash', 'MultiEdit', 'NotebookEdit', 'PowerShell', 'Agent', 'mcp__github__create_issue']) {
      assert.equal(await decide(call(main, tool), deps(home)), undefined, `${tool} before the hold`);
    }
    hold();
    for (const tool of ['Edit', 'Write', 'Bash', 'MultiEdit', 'NotebookEdit', 'PowerShell', 'Agent', 'mcp__github__create_issue', 'Unknown']) {
      assert.ok(denied(await decide(call(main, tool), deps(home))), tool);
    }
    assert.equal(HELD, 'Wheelhouse is holding edits and commands: the installed skills differ from its manifest');
    for (const tool of READ_TOOLS) assert.equal(await decide(call(main, tool), deps(home)), undefined, tool);
    // As under STOP, work already running can still be halted.
    for (const tool of HALT_TOOLS) assert.equal(await decide(call(main, tool), deps(home)), undefined, tool);
    // In a folder deeper in the project, and when a rewritten .git file hides the project.
    const deeper = path.join(main, 'src');
    fs.mkdirSync(deeper);
    assert.ok(denied(await decide(call(deeper, 'Edit'), deps(home))));
    assert.ok(denied(await decide(call(main, 'Edit'), deps(home, { projectOf: () => null }))), 'placed by its path');
    // A .git file inside the held project that leads to another, unheld project's repository.
    const other = fs.realpathSync.native(tempFolder('wh-hold-other-'));
    fs.mkdirSync(path.join(other, '.git'));
    writeProject('owner__other', { folder: other, remoteUrl: 'https://example.com/owner/other.git', host: 'github', repo: 'owner/other', connection: {} });
    const worktree = path.join(main, '.claude', 'worktrees', 'x');
    fs.mkdirSync(worktree, { recursive: true });
    assert.ok(denied(await decide(call(worktree, 'Edit'), deps(home))), 'an ordinary folder in the project');
    const fake = tempFolder('wh-hold-fake-gitdir-');
    fs.writeFileSync(path.join(fake, 'commondir'), path.join(other, '.git'));
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${fake}\n`);
    assert.equal(projectOf(worktree, { dir: path.join(home, 'managed') })?.project, 'owner__other', 'the repository names the other project');
    assert.ok(denied(await decide(call(worktree, 'Edit'), deps(home))), 'the path still holds it');
    assert.equal(await decide(call(other, 'Edit'), deps(home)), undefined, 'the other project is not held');
    // And the other way round: a folder outside every project whose .git leads into the held one.
    const outside = fs.realpathSync.native(tempFolder('wh-hold-outside-'));
    const intoHeld = tempFolder('wh-hold-into-gitdir-');
    fs.writeFileSync(path.join(intoHeld, 'commondir'), path.join(main, '.git'));
    fs.writeFileSync(path.join(outside, '.git'), `gitdir: ${intoHeld}\n`);
    assert.ok(denied(await decide(call(outside, 'Edit'), deps(home))), 'the repository holds it');
    // A folder that can't be placed is held while any project is.
    assert.ok(denied(await decide(call(path.join(main, 'gone', 'away'), 'Edit'), deps(home, { projectOf: () => null }))));
    fs.rmSync(holdFile(P));
    assert.equal(await decide(call(main, 'Edit'), deps(home)), undefined);
    assert.equal(await decide(call(path.join(main, 'gone'), 'Edit'), deps(home, { projectOf: () => null })), undefined);
  });
});

test('a folder with only .claude/wheelhouse.json and no registration is neither warned nor held', async () => {
  await withHome(async (home) => {
    makeProject();
    hold();
    const own = fs.realpathSync.native(tempFolder('wh-own-repo-'));
    fs.mkdirSync(path.join(own, '.git'));
    fs.mkdirSync(path.join(own, '.claude'));
    fs.writeFileSync(path.join(own, '.claude', 'wheelhouse.json'), JSON.stringify({ v: 1 }));
    for (const tool of ['Edit', 'Write', 'Bash']) assert.equal(await decide(call(own, tool), deps(home)), undefined, tool);
    // Nor does the session start warn there or write a hold of its own.
    const { decide: start } = await import('../../../scripts/hooks/session-start.js');
    assert.equal(await start({ cwd: own, session_id: 's2', hook_event_name: 'SessionStart' }, { dir: path.join(home, 'managed') }), undefined);
    assert.deepEqual(fs.readdirSync(path.join(home, 'projects')), [P]);
  });
});

test('the check command and the runbook are let through; the check only reads, and the next session start clears the hold once the files match', async () => {
  await withHome(async (home) => {
    const main = makeProject();
    hold();
    const script = `${PLUGIN}/scripts/lineage/check.js`;
    for (const ok of [
      `node ${script}`,
      `node ${script} ${main}`,
      `node "${script}" "${main}"`,
      `node '${script}' '${main}'`,
      `node ${script} .`,
      `node\t${script}`,
      // The runbook, as STOP lets it through: each step but STOP needs the director's click.
      `node ${PLUGIN}/scripts/runbook/runbook.js 1`,
      `node ${PLUGIN}/scripts/runbook/runbook.js 3 merge 12`,
    ]) assert.equal(await decide(bash(main, ok), deps(home)), undefined, ok);
    for (const no of [
      `node ${script} && rm -rf x`,
      `node ${script}; rm -rf x`,
      `node ${script} | cat`,
      `node ${script} > out.txt`,
      `node ${script} < in.txt`,
      `node ${script} & rm -rf x`,
      `node ${script} $(rm -rf x)`,
      `node ${script} \`rm -rf x\``,
      `node ${script}\nrm -rf x`,
      `node ${script} ${main} ${main}`,
      `node ${script} --write`,
      `node ${script} ""`,
      'node /other/root/scripts/lineage/check.js',
      `node ${PLUGIN}/scripts/lineage/manifest.js write`,
      `node ${PLUGIN}/scripts/runbook/runbook.js`,
      `node ${PLUGIN}/scripts/runbook/runbook.js 1 && rm -rf x`,
      `nodejs ${script}`,
      `sh -c "node ${script}"`,
    ]) assert.ok(denied(await decide(bash(main, no), deps(home))), no);
    // Only through Bash.
    assert.ok(denied(await decide(call(main, 'PowerShell', { command: `node ${script}` }), deps(home))));

    // The check itself only reads (ruling R145): a copy that still differs says what differs,
    // and the hold file is left as it is.
    const fixture = lineageFixture(main);
    fixture.put({ 'skills/brainstorming/SKILL.md': 'changed\n' });
    const lines = [];
    const write = (text) => lines.push(text);
    const before = fs.readFileSync(holdFile(P), 'utf8');
    assert.equal(check([main], { write, root: fixture.root, claudeHome: fixture.claudeHome }), 1);
    assert.equal(lines.join(''), 'These installed files still differ from Wheelhouse\'s manifest, so edits and commands stay held. Once they match, the hold lifts at the next session start.\n- superpowers: skills/brainstorming\n');
    assert.equal(fs.readFileSync(holdFile(P), 'utf8'), before);
    // Put right, it says so and still changes nothing. The folder defaults to the one it runs
    // in, and a folder inside the project (a feature's worktree) checks the project's installs.
    fixture.restore();
    for (const cwd of [path.join(main, '.git'), main]) {
      lines.length = 0;
      assert.equal(check([], { cwd, write, root: fixture.root, claudeHome: fixture.claudeHome }), 0, cwd);
      assert.equal(lines.join(''), `${MATCHED}\n`);
    }
    assert.equal(MATCHED, 'The installed skills match Wheelhouse\'s manifest. A hold lifts at the next session start, whose check finds them matching; this command changes nothing.');
    assert.equal(fs.readFileSync(holdFile(P), 'utf8'), before);
    assert.ok(denied(await decide(call(main, 'Edit'), deps(home))), 'still held');
    // The next session start's check finds them matching and lifts the hold.
    assert.equal(checkLineage({ project: P, projectDir: main, root: fixture.root, claudeHome: fixture.claudeHome }).ok, true);
    assert.equal(fs.existsSync(holdFile(P)), false);
    assert.equal(await decide(call(main, 'Edit'), deps(home)), undefined);
    // A folder with nothing installed for it, inside or above it: not installed.
    lines.length = 0;
    assert.equal(check([tempFolder('wh-elsewhere-')], { write, root: fixture.root, claudeHome: fixture.claudeHome }), 1);
    assert.match(lines.join(''), /- superpowers: not installed\n$/);
    lines.length = 0;
    assert.equal(check([path.join(main, 'gone')], { write, root: fixture.root, claudeHome: fixture.claudeHome }), 1);
    assert.equal(lines.join(''), 'That folder can\'t be found, so there is nothing to check.\n');
  });
});

test('the check script runs on its own, names what is missing, and writes nothing', async () => {
  await withHome(async (home) => {
    const main = makeProject();
    const claudeHome = tempFolder('wh-claude-none-');
    const result = spawnSync(process.execPath, [CHECK, main], { env: { ...process.env, WHEELHOUSE_HOME: home, CLAUDE_CONFIG_DIR: claudeHome, PATH: '' }, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /^These installed files still differ/);
    assert.match(result.stdout, /- superpowers: not installed\n- mattpocock-skills: not installed\n$/);
    assert.equal(fs.existsSync(holdFile(P)), false, 'the check holds nothing: only a session start does');
  });
});

test('from the managed copy, the check command at the plugin folder Locked recorded is let through', async () => {
  await withHome(async (home) => {
    const main = makeProject();
    hold();
    const dir = path.join(home, 'managed');
    fs.mkdirSync(path.join(dir, 'wheelhouse'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'wheelhouse', 'installed.json'), JSON.stringify({ pluginRoot: '/recorded/root' }));
    const self = path.join(dir, 'wheelhouse', 'scripts', 'hooks', 'lineage-hold.js');
    const managed = { ...deps(home), self, pluginRoot: path.join(dir, 'wheelhouse') };
    assert.equal(await decide(bash(main, 'node /recorded/root/scripts/lineage/check.js'), managed), undefined);
    assert.equal(await decide(bash(main, `node ${dir}/wheelhouse/scripts/lineage/check.js`), managed), undefined);
    assert.ok(denied(await decide(bash(main, 'node /recorded/root/scripts/lineage/check.js'), deps(home))), 'the plugin\'s copy reads no record');
  });
});

const DENY = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Wheelhouse\'s check could not run' } };

test('a hold hook that throws refuses', async () => {
  await withHome(async (home) => {
    const main = makeProject();
    const runScript = (stdin) => spawnSync(process.execPath, [SCRIPT], { input: stdin, env: { ...process.env, WHEELHOUSE_HOME: home }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(runScript('').stdout), DENY);
    assert.deepEqual(JSON.parse(runScript('{not json').stdout), DENY);
    assert.deepEqual(runScript(JSON.stringify(call(main, 'Edit'))).stdout, '', 'not held: nothing to say');
    hold();
    assert.equal(JSON.parse(runScript(JSON.stringify(call(main, 'Edit'))).stdout).hookSpecificOutput.permissionDecisionReason, HELD);
    // A throw inside the decision refuses too.
    const out = [];
    await hookMain(decide, { failClosed: true, event: 'PreToolUse' }, {
      stdin: [Buffer.from(JSON.stringify(call(main, 'Read')))], write: (text) => out.push(text), dir: path.join(home, 'managed'),
      deps: { projectOf: () => { throw new Error('boom'); } }, projectOf: () => null,
    });
    assert.deepEqual(out.map((text) => JSON.parse(text)), [DENY]);
  });
});

test('the check needs nothing from the Wheelhouse home, which a sandboxed command can\'t read', async () => {
  await withHome(async (home) => {
    const main = fs.realpathSync.native(tempFolder('wh-hold-unread-'));
    const fixture = lineageFixture(main);
    fs.writeFileSync(path.join(home, 'projects'), 'not a folder');
    const lines = [];
    assert.equal(check([main], { write: (t) => lines.push(t), root: fixture.root, claudeHome: fixture.claudeHome }), 0);
    assert.equal(lines.join(''), `${MATCHED}\n`);
  });
});
