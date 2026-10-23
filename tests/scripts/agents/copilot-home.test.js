// tests/scripts/agents/copilot-home.test.js
// The Lean kit for Copilot: the skills, agents and instructions copied into a person's ~/.copilot/, built from the
// same playbooks as Claude Code's (design sections 6.4 and 8.2; Part 4 Task 2). The kit is plain text, so these
// tests hold what it says and that the committed copy is exactly what the builder gives.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { buildHome, checkHome, gitBlobHash, writeHome, CLAUDE_TO_COPILOT, HOME_DIR } from '../../../scripts/agents/copilot/home.js';
import tools from '../../../adapters/copilot/tools.js';
import sheet from '../../../adapters/copilot/tool-sheet.js';
import { BOARD_FILE } from '../../../scripts/lib/copilot-numbers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOME_SCRIPT = path.join(ROOT, 'scripts', 'agents', 'copilot', 'home.js');
const NAMES = ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT'];
const CLAUDE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'LS'];
const COMMANDS = ['board', 'briefing', 'settings', 'sources', 'stop'];
const ALL_COPILOT_TOOLS = new Set(Object.values(tools).flatMap((v) => (Array.isArray(v) ? v : [v])));

// Stand-ins for gh, glab and copilot come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

const kit = buildHome({ root: ROOT });
const lf = (text) => text.replaceAll('\r\n', '\n');

// The front matter (key: value lines; a value may be a JSON string or list) and what follows it.
function split(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return { front: null, body: text };
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    assert.ok(kv, `a front matter line: ${line}`);
    front[kv[1]] = kv[2].startsWith('"') || kv[2].startsWith('[') ? JSON.parse(kv[2]) : kv[2];
  }
  return { front, body: m[2] };
}

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

// A copy of the source tree the builder reads, in a folder of the test's own.
function copyOfSources() {
  const root = tempFolder('wh-copilot-home-');
  for (const part of ['skills', 'agents', 'commands']) fs.cpSync(path.join(ROOT, part), path.join(root, part), { recursive: true });
  fs.mkdirSync(path.join(root, 'adapters', 'copilot'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'adapters', 'copilot', 'tool-sheet.md'), path.join(root, 'adapters', 'copilot', 'tool-sheet.md'));
  // Lean's playbooks sit beside the adapter, not in skills/ (ruling P4-30).
  fs.cpSync(path.join(ROOT, 'adapters', 'copilot', 'skills'), path.join(root, 'adapters', 'copilot', 'skills'), { recursive: true });
  return root;
}

// ---- The drift test ----

test('the committed kit is exactly what buildHome gives', () => {
  const dir = path.join(ROOT, HOME_DIR);
  assert.ok(fs.existsSync(dir), 'run npm run copilot-home');
  assert.deepEqual(filesUnder(dir), [...kit.keys()].sort(), 'the same files');
  for (const [file, text] of kit) {
    // A checkout may turn LF into CRLF (Windows); the kit is judged by its text.
    assert.equal(lf(fs.readFileSync(path.join(dir, file), 'utf8')), text, `${file} differs from what buildHome gives; run npm run copilot-home`);
  }
  assert.deepEqual(checkHome({ root: ROOT }), []);
});

test('the kit is byte-stable: LF only, sorted, the same on every build', () => {
  const again = buildHome({ root: ROOT });
  assert.deepEqual([...again.entries()], [...kit.entries()]);
  const files = [...kit.keys()];
  assert.deepEqual(files, [...files].sort(), 'the paths come in order');
  for (const [file, text] of kit) {
    assert.ok(!text.includes('\r'), `${file} has a carriage return`);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${file} ends with one newline`);
  }
});

test('the kit holds exactly the files Tasks 2, 3 and 5 build', () => {
  assert.deepEqual([...kit.keys()], [
    'MANIFEST.txt',
    'agents/wheelhouse-builder.agent.md',
    'agents/wheelhouse-foreman.agent.md',
    'agents/wheelhouse-reviewer.agent.md',
    'agents/wheelhouse-tester.agent.md',
    'instructions/wheelhouse.instructions.md',
    'skills/wheelhouse-board/SKILL.md',
    'skills/wheelhouse-briefing/SKILL.md',
    'skills/wheelhouse-front-desk/SKILL.md',
    'skills/wheelhouse-intake/SKILL.md',
    'skills/wheelhouse-lean/SKILL.md',
    'skills/wheelhouse-settings/SKILL.md',
    'skills/wheelhouse-setup/SKILL.md',
    'skills/wheelhouse-sources/SKILL.md',
    'skills/wheelhouse-stop/SKILL.md',
  ]);
  // The hook files come with Part 5 Task 8.
  assert.ok(![...kit.keys()].some((f) => f.startsWith('hooks/')));
});

// ---- The agents ----

test('the reviewer agent\'s tools are reading and searching only', () => {
  const { front } = split(kit.get('agents/wheelhouse-reviewer.agent.md'));
  assert.deepEqual(front.tools, ['view', 'glob', 'rg']);
  // Not the whole of tools.read, which holds more than reading files and searching them.
  assert.ok(tools.read.length > 3);
});

test('every agent\'s tools are Copilot\'s names, and the foreman\'s are what its allowed-tools grant', () => {
  for (const agent of ['builder', 'foreman', 'reviewer', 'tester']) {
    const { front } = split(kit.get(`agents/wheelhouse-${agent}.agent.md`));
    assert.ok(Array.isArray(front.tools) && front.tools.length > 0, `${agent} has tools`);
    for (const tool of front.tools) assert.ok(ALL_COPILOT_TOOLS.has(tool), `${agent}: ${tool} is not a Copilot tool`);
    assert.equal(new Set(front.tools).size, front.tools.length, `${agent} names no tool twice`);
    for (const forbidden of ['task', 'skill', 'sql', 'ask_user']) assert.ok(!front.tools.includes(forbidden), `${agent} has ${forbidden}`);
  }
  // The foreman: `allowed-tools: Bash(node '...wake.js':*)` is Bash, which is the shell on either system (`bash`, `powershell`), and nothing broader.
  assert.match(fs.readFileSync(path.join(ROOT, 'skills', 'foreman', 'SKILL.md'), 'utf8'), /^allowed-tools: Bash\(/m);
  assert.deepEqual(split(kit.get('agents/wheelhouse-foreman.agent.md')).front.tools, [...tools.shell]);
  assert.deepEqual(tools.shell, ['bash', 'powershell']);
  // The tester: Read, Grep, Glob, WebFetch and Bash in the source.
  assert.deepEqual([...split(kit.get('agents/wheelhouse-tester.agent.md')).front.tools].sort(), ['bash', 'glob', 'powershell', 'rg', 'view', 'web_fetch']);
  // No agent may edit but the builder.
  const editing = [...tools.edit];
  for (const agent of ['foreman', 'reviewer', 'tester']) {
    assert.deepEqual(split(kit.get(`agents/wheelhouse-${agent}.agent.md`)).front.tools.filter((t) => editing.includes(t)), [], agent);
  }
  assert.ok(split(kit.get('agents/wheelhouse-builder.agent.md')).front.tools.includes('apply_patch'));
  for (const shell of tools.shell) assert.ok(split(kit.get('agents/wheelhouse-builder.agent.md')).front.tools.includes(shell), `the builder has ${shell}`);
});

test('the agents carry the same prompt text, with Claude Code\'s tool words mapped', () => {
  for (const agent of ['builder', 'reviewer', 'tester']) {
    const source = split(lf(fs.readFileSync(path.join(ROOT, 'agents', `${agent}.md`), 'utf8')));
    const built = split(kit.get(`agents/wheelhouse-${agent}.agent.md`));
    assert.equal(built.front.name, `wheelhouse-${agent}`);
    assert.equal(built.front.description, source.front.description, `${agent}'s description is the source's`);
    // What is left after the mapping is the source's text, line for line, but for the lines the mapping touched.
    const strip = (body) => body.replace(/^\n?<!--[^\n]*-->\n/, '').split('\n');
    const a = strip(source.body);
    const b = strip(built.body);
    assert.equal(a.length, b.length, `${agent}: the same number of lines`);
    const changed = a.filter((line, i) => line !== b[i]);
    for (const line of changed) assert.match(line, /`(Read|Grep|Glob|Bash|WebFetch)`|CLAUDE\.md/, `${agent}: an unmapped change: ${line}`);
    // The report block is byte for byte the source's.
    assert.ok(built.body.includes(source.body.slice(source.body.indexOf('```\nWHEELHOUSE REPORT'))), `${agent}'s report block`);
  }
  assert.deepEqual(CLAUDE_TO_COPILOT, { Read: ['view'], Grep: ['rg'], Glob: ['glob'], Bash: [...tools.shell], WebFetch: ['web_fetch'] });
  assert.match(kit.get('agents/wheelhouse-builder.agent.md'), /\(the rules files, such as `AGENTS\.md` and `\.github\/copilot-instructions\.md`, and any file they point to\)/);
  assert.match(kit.get('agents/wheelhouse-reviewer.agent.md'), /Use `rg` and `glob` to find callers and tests/);
  assert.match(kit.get('agents/wheelhouse-tester.agent.md'), /Use `bash` to run Playwright/);
  assert.match(kit.get('agents/wheelhouse-tester.agent.md'), /Fetch it with `web_fetch`/);
});

test('the foreman agent\'s prompt is the foreman playbook\'s body', () => {
  const source = lf(fs.readFileSync(path.join(ROOT, 'skills', 'foreman', 'SKILL.md'), 'utf8'));
  const body = source.slice(source.indexOf('\n# The foreman'));
  const built = split(kit.get('agents/wheelhouse-foreman.agent.md'));
  assert.equal(built.front.name, 'wheelhouse-foreman');
  assert.ok(built.body.endsWith(body), 'the playbook\'s text, whole');
  assert.ok(!built.body.includes('allowed-tools'));
});

// ---- The skills ----

test('the front desk, intake and command skills are the playbooks under Copilot\'s names', () => {
  for (const [skill, source] of [['front-desk', 'front-desk'], ['intake', 'intake']]) {
    const raw = split(lf(fs.readFileSync(path.join(ROOT, 'skills', source, 'SKILL.md'), 'utf8')));
    const built = split(kit.get(`skills/wheelhouse-${skill}/SKILL.md`));
    assert.deepEqual(Object.keys(built.front), ['name', 'description']);
    assert.equal(built.front.name, `wheelhouse-${skill}`);
    assert.equal(built.front.description, raw.front.description);
    assert.ok(built.front.description.length <= 1024);
    // Skills name each other by Copilot's names: wheelhouse-intake, not wheelhouse:intake.
    assert.ok(!/wheelhouse:/.test(built.body), `${skill} names a skill with a colon`);
  }
  assert.match(kit.get('skills/wheelhouse-front-desk/SKILL.md'), /goes first through `wheelhouse-intake`/);
  assert.match(kit.get('skills/wheelhouse-front-desk/SKILL.md'), /The full board is `\/wheelhouse-board`/);
  for (const command of COMMANDS) {
    const source = split(lf(fs.readFileSync(path.join(ROOT, 'commands', `${command}.md`), 'utf8')));
    const built = split(kit.get(`skills/wheelhouse-${command}/SKILL.md`));
    assert.deepEqual(Object.keys(built.front), ['name', 'description']);
    assert.equal(built.front.name, `wheelhouse-${command}`);
    // The command's description, but for a mention of the pane's build tab, which a chat has none of.
    assert.ok(source.front.description.startsWith(built.front.description), `${command}'s description is the command's`);
    assert.ok(!/build tab/.test(built.front.description));
    assert.ok(built.front.description.length >= 20);
    assert.match(built.body, /wheelhouse-lean/, `${command} points to Lean's playbook`);
    assert.ok(built.body.length < 900, `${command} is short`);
  }
  assert.match(kit.get('skills/wheelhouse-board/SKILL.md'), new RegExp(BOARD_FILE.replace('/', '\\/')));
});

test('every skill and agent name starts wheelhouse-, and a skill\'s name is its folder', () => {
  for (const [file, text] of kit) {
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(file);
    const agent = /^agents\/([^/]+)\.agent\.md$/.exec(file);
    if (!skill && !agent) continue;
    const { front } = split(text);
    const stem = (skill ?? agent)[1];
    assert.ok(stem.startsWith('wheelhouse-'), `${file}`);
    assert.equal(front.name, stem, `${file}'s name is its ${skill ? 'folder' : 'file'}`);
    assert.match(front.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(front.name.length <= 64);
    assert.equal(typeof front.description, 'string');
    assert.ok(front.description.length > 0 && front.description.length <= 1024);
  }
});

// ---- The instructions ----

test('the instructions file holds the tool sheet and says where Wheelhouse does not run', () => {
  const { front, body } = split(kit.get('instructions/wheelhouse.instructions.md'));
  assert.equal(front.name, 'wheelhouse');
  assert.equal(front.applyTo, '**');
  assert.ok(body.includes(sheet), 'the tool sheet, whole');
  assert.ok(body.includes('In VS Code\'s Local harness Wheelhouse doesn\'t run: say so and ask the director to switch the chat to Copilot'));
  assert.ok(body.indexOf(sheet) < body.indexOf('Local harness'));
});

// ---- Every file ----

test('every file starts with its path comment, after front matter', () => {
  for (const [file, text] of kit) {
    if (file === 'MANIFEST.txt') continue;
    const { body } = split(text);
    const first = body.replace(/^\n/, '').split('\n')[0];
    assert.match(first, new RegExp(`^<!-- ${HOME_DIR}/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(built from [^ ]+ by npm run copilot-home\\) -->$`), `${file}: ${first}`);
    // The comment comes straight after the front matter.
    if (text.startsWith('---\n')) assert.ok(/^---\n[\s\S]*?\n---\n<!-- /.test(text), `${file}: the comment follows the front matter`);
  }
});

test('no file in the kit names a Claude Code tool', () => {
  for (const [file, text] of kit) {
    for (const name of NAMES) assert.ok(!text.includes(name), `${file} names ${name}`);
    for (const tool of CLAUDE_TOOLS) assert.ok(!text.includes(`\`${tool}\``), `${file} names \`${tool}\``);
    const { front } = split(text);
    for (const tool of front?.tools ?? []) assert.ok(!CLAUDE_TOOLS.includes(tool) && ALL_COPILOT_TOOLS.has(tool), `${file}: the tool ${tool}`);
    assert.ok(front === null || !('allowed-tools' in front), `${file} keeps Claude Code's allowed-tools`);
  }
});

test('the kit holds no model identifier, attribution line or word the project avoids', () => {
  for (const [file, text] of kit) {
    assert.doesNotMatch(text, /Co-Authored-By|Generated with/i, file);
    assert.doesNotMatch(text, /\b(opus|sonnet|haiku)\b/i, file);
  }
});

// ---- The manifest ----

test('MANIFEST.txt lists every file with its git blob hash', () => {
  const manifest = kit.get('MANIFEST.txt');
  const lines = manifest.trimEnd().split('\n');
  const others = [...kit.keys()].filter((f) => f !== 'MANIFEST.txt');
  assert.deepEqual(lines.map((l) => l.split(' ').slice(1).join(' ')), others, 'one line per file, in order, not the manifest itself');
  const scratch = tempFolder('wh-manifest-');
  for (const line of lines) {
    const m = /^([0-9a-f]{40}) (\S+)$/.exec(line);
    assert.ok(m, line);
    const file = path.join(scratch, m[2]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, kit.get(m[2]));
    assert.equal(gitBlobHash(kit.get(m[2])), m[1], `${m[2]}: the hash in the manifest`);
    // Real git agrees.
    assert.equal(execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim(), m[1], `${m[2]}: git hash-object`);
  }
  assert.equal(gitBlobHash('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(gitBlobHash(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(gitBlobHash('é\n'), execFileSync('git', ['hash-object', '--stdin'], { input: 'é\n', encoding: 'utf8' }).trim(), 'bytes, not characters');
});

// ---- Building, checking and writing ----

// Ruling P5-38: the kit's intake sends a Lean session without a Wheelhouse command to wheelhouse-lean's Intake at Lean,
// as P4-34 does for the front desk; the rest is skills/intake as it stands, under Copilot's names.
const INTAKE_LEAN_LINE = 'At Lean, where no Wheelhouse command runs, follow wheelhouse-lean\'s Intake at Lean in place of each `cli.js` step.';

test('the kit\'s intake carries the Lean line and is otherwise built from skills/intake', () => {
  const built = kit.get('skills/wheelhouse-intake/SKILL.md');
  assert.equal(built.split(INTAKE_LEAN_LINE).length, 2, 'the line is there once');
  const at = built.indexOf(INTAKE_LEAN_LINE);
  assert.ok(at > built.indexOf('## Overview\n'), 'after the overview\'s heading');
  assert.ok(at < built.indexOf('## Every message, in this order\n'), 'before the steps');
  // Without the line, the body is the source's, with skills named as Copilot names them.
  const source = split(lf(fs.readFileSync(path.join(ROOT, 'skills', 'intake', 'SKILL.md'), 'utf8'))).body.replace(/^\n?<!--[^\n]*-->\n/, '');
  const body = split(built).body.replace(/^<!--[^\n]*-->\n/, '');
  assert.equal(body.replace(`\n${INTAKE_LEAN_LINE}\n`, ''), source.replace(/\bwheelhouse:([a-z][a-z-]*)/g, 'wheelhouse-$1'));
  // Claude Code's own intake is not edited.
  assert.ok(!fs.readFileSync(path.join(ROOT, 'skills', 'intake', 'SKILL.md'), 'utf8').includes('wheelhouse-lean'));
});

test('buildHome throws when the intake source has no "## Every message, in this order" heading to put the Lean line before', () => {
  const root = copyOfSources();
  const file = path.join(root, 'skills', 'intake', 'SKILL.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\n## Every message, in this order\n', '\n## Each message\n'));
  assert.throws(() => buildHome({ root }), /## Every message, in this order/);
});

test('the kit\'s board skill names the board\'s Ideas and Rulings parts', () => {
  const board = kit.get('skills/wheelhouse-board/SKILL.md');
  assert.match(board, /"Ideas"/);
  assert.match(board, /"Rulings"/);
});

test('buildHome throws when a source is missing, and never skips one silently', () => {
  const root = copyOfSources();
  fs.rmSync(path.join(root, 'skills', 'intake'), { recursive: true });
  assert.throws(() => buildHome({ root }), /skills[\\/]intake[\\/]SKILL\.md/);
  const root2 = copyOfSources();
  fs.rmSync(path.join(root2, 'commands', 'stop.md'));
  assert.throws(() => buildHome({ root: root2 }), /commands[\\/]stop\.md/);
  const root3 = copyOfSources();
  fs.rmSync(path.join(root3, 'adapters', 'copilot', 'tool-sheet.md'));
  assert.throws(() => buildHome({ root: root3 }), /tool-sheet\.md/);
});

test('buildHome throws when the front desk source has no "## The command" heading to put the Lean line before', () => {
  const root = copyOfSources();
  const file = path.join(root, 'skills', 'front-desk', 'SKILL.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\n## The command\n', '\n## The steps\n'));
  assert.throws(() => buildHome({ root }), /## The command/);
});

test('buildHome refuses a backticked Claude Code tool name it has no mapping for', () => {
  const root = copyOfSources();
  const file = path.join(root, 'agents', 'builder.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Read the task text', 'Use `NotebookRead` on the task text'));
  assert.throws(() => buildHome({ root }), /NotebookRead/);
});

test('with no flag the script prints the paths that differ and exits 1; --write replaces the kit', () => {
  const root = copyOfSources();
  const run = (...args) => spawnSync(process.execPath, [HOME_SCRIPT, '--root', root, ...args], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH } });
  // Nothing written yet: every path differs.
  let result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [...kit.keys()].map((f) => `${HOME_DIR}/${f}`).sort());
  // A stale file and a changed file are named too, after --write.
  result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesUnder(path.join(root, HOME_DIR)), [...kit.keys()].sort());
  assert.equal(fs.readFileSync(path.join(root, HOME_DIR, 'MANIFEST.txt'), 'utf8'), kit.get('MANIFEST.txt'));
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(root, HOME_DIR, 'stale.md'), 'old\n');
  fs.appendFileSync(path.join(root, HOME_DIR, 'skills', 'wheelhouse-stop', 'SKILL.md'), 'edited\n');
  result = run();
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout.trim().split('\n'), [`${HOME_DIR}/skills/wheelhouse-stop/SKILL.md`, `${HOME_DIR}/stale.md`]);
  // --write replaces the folder: the stale file goes.
  assert.equal(run('--write').status, 0);
  assert.ok(!fs.existsSync(path.join(root, HOME_DIR, 'stale.md')));
  assert.equal(run().status, 0);
  assert.deepEqual(writeHome({ root }), [...kit.keys()].sort());
});

test('a .gitattributes beside the kit keeps its line endings LF', () => {
  const file = path.join(ROOT, 'adapters', 'copilot', '.gitattributes');
  assert.ok(fs.existsSync(file), 'adapters/copilot/.gitattributes exists');
  const lines = lf(fs.readFileSync(file, 'utf8')).split('\n');
  assert.equal(lines[0], '# adapters/copilot/.gitattributes');
  assert.ok(lines.includes('home/** text eol=lf'));
  // It sits outside the kit, so the kit and its manifest don't list it.
  assert.ok(![...kit.keys()].some((f) => f.includes('gitattributes')));
});

test('package.json has the copilot-home script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['copilot-home'], 'node scripts/agents/copilot/home.js --write');
});

// ---- No host program ran ----

test('none of gh, glab or copilot ran, and the real home was never touched', () => {
  assert.deepEqual(stand.calls(), []);
  const home = process.env.WHEELHOUSE_HOME;
  assert.ok(home);
  assert.ok(fs.realpathSync(home).startsWith(fs.realpathSync(os.tmpdir())), 'the test\'s home is a temporary folder');
  assert.notEqual(path.resolve(home), path.join(os.homedir(), '.wheelhouse'));
  assert.ok(!fs.existsSync(path.join(home, '.copilot')));
});
