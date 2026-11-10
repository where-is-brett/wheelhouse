// tests/scripts/agents/copilot/home.test.js
// The agents of a Copilot session's clean home (scripts/agents/copilot/home.js): built from today's agents/ and
// skills/foreman, with Copilot's names and tools, from a clean checkout, and the committed copy is what the build gives.
import '../../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../../helpers/homes.js';
import tools from '../../../../adapters/copilot/tools.js';
import {
  CLAUDE_TO_COPILOT, HOME_DIR, SOURCES, buildCleanHome, buildHome, checkHome, cleanCheckout, gitBlobHash, writeHome,
} from '../../../../scripts/agents/copilot/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const HOME_SCRIPT = path.join(ROOT, 'scripts', 'agents', 'copilot', 'home.js');
const CLAUDE_ONLY = ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT'];
const CLAUDE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'LS'];
const ALL_COPILOT_TOOLS = new Set(Object.values(tools).flatMap((v) => (Array.isArray(v) ? v : [v])));
const AGENTS = ['builder', 'foreman', 'reviewer', 'tester'];

const home = buildHome({ root: ROOT });
const lf = (text) => text.replaceAll('\r\n', '\n');

// The front matter (key: value lines; a value may be a JSON string or list) and what follows it.
function split(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'front matter');
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    assert.ok(kv, `a front matter line: ${line}`);
    front[kv[1]] = kv[2].startsWith('"') || kv[2].startsWith('[') ? JSON.parse(kv[2]) : kv[2];
  }
  return { front, body: m[2] };
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

// A copy of the source tree the build reads, in a folder of the test's own.
function copyOfSources() {
  const root = tempFolder('wh-copilot-home-');
  for (const rel of SOURCES) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  }
  return root;
}

// Whether the sources have edits git doesn't hold yet, so a comparison with the commit would say nothing about the build.
const sourcesDirty = () => execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...SOURCES], { encoding: 'utf8' }).trim() !== '';

test('the committed home is exactly what the build gives', () => {
  const dir = path.join(ROOT, HOME_DIR);
  assert.ok(fs.existsSync(dir), 'run npm run copilot-home');
  assert.deepEqual(filesUnder(dir), [...home.keys()].sort(), 'the same files');
  for (const [file, text] of home) assert.equal(lf(fs.readFileSync(path.join(dir, file), 'utf8')), text, `${file} differs from the build; run npm run copilot-home`);
  assert.deepEqual(checkHome({ root: ROOT }), []);
});

test('the home is built from a clean checkout: the commit\'s sources, whatever the working tree holds', { skip: sourcesDirty() && 'the sources have edits not committed yet' }, () => {
  assert.deepEqual([...buildCleanHome({ ref: 'HEAD', repo: ROOT }).entries()], [...home.entries()]);
  // The checkout holds the four sources and nothing else, read from git's own objects.
  const checkout = cleanCheckout({ ref: 'HEAD', repo: ROOT });
  try {
    assert.deepEqual(filesUnder(checkout.root), [...SOURCES].sort());
  } finally {
    checkout.remove();
  }
  assert.ok(!fs.existsSync(checkout.root), 'removed after');
});

test('a clean checkout ignores an edit the working tree holds, and a ref that isn\'t a commit name or lacks a source throws', () => {
  const repo = tempFolder('wh-clean-repo-');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q');
  for (const rel of SOURCES) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(repo, rel));
  }
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'sources');
  const committed = buildHome({ root: repo });
  fs.appendFileSync(path.join(repo, 'agents', 'builder.md'), 'An edit not committed.\n');
  fs.writeFileSync(path.join(repo, 'agents', 'notes.md'), 'A file git does not track.\n');
  assert.notDeepEqual([...buildHome({ root: repo }).entries()], [...committed.entries()], 'the working tree builds differently');
  assert.deepEqual([...buildCleanHome({ ref: 'HEAD', repo }).entries()], [...committed.entries()]);
  assert.throws(() => buildCleanHome({ ref: 'no-such-commit', repo }), /holds no agents\/builder\.md/);
  assert.throws(() => buildCleanHome({ ref: '--upload-pack=x', repo }), /isn't a commit name/);
});

test('the home is byte-stable: LF only, sorted, the same on every build', () => {
  assert.deepEqual([...buildHome({ root: ROOT }).entries()], [...home.entries()]);
  const files = [...home.keys()];
  assert.deepEqual(files, [...files].sort(), 'the paths come in order');
  for (const [file, text] of home) {
    assert.ok(!text.includes('\r'), `${file} has a carriage return`);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${file} ends with one newline`);
  }
});

test('the home holds the four agents and their manifest, and no skill, hook or instruction', () => {
  assert.deepEqual([...home.keys()], ['MANIFEST.txt', ...AGENTS.map((a) => `agents/wheelhouse-${a}.agent.md`)]);
});

test('the reviewer\'s tools are reading and searching only', () => {
  assert.deepEqual(split(home.get('agents/wheelhouse-reviewer.agent.md')).front.tools, ['view', 'glob', 'rg']);
  assert.ok(tools.read.length > 3, 'tools.read holds more than reading files and searching them');
});

test('every agent\'s tools are Copilot\'s names, and no agent but the builder may edit', () => {
  for (const agent of AGENTS) {
    const { front } = split(home.get(`agents/wheelhouse-${agent}.agent.md`));
    assert.ok(Array.isArray(front.tools) && front.tools.length > 0, `${agent} has tools`);
    for (const tool of front.tools) assert.ok(ALL_COPILOT_TOOLS.has(tool), `${agent}: ${tool} is not a Copilot tool`);
    assert.equal(new Set(front.tools).size, front.tools.length, `${agent} names no tool twice`);
    for (const forbidden of ['task', 'skill', 'sql', 'ask_user']) assert.ok(!front.tools.includes(forbidden), `${agent} has ${forbidden}`);
    if (agent !== 'builder') assert.deepEqual(front.tools.filter((t) => tools.edit.includes(t)), [], agent);
  }
  assert.deepEqual(split(home.get('agents/wheelhouse-foreman.agent.md')).front.tools, [...tools.shell]);
  assert.deepEqual([...split(home.get('agents/wheelhouse-tester.agent.md')).front.tools].sort(), ['bash', 'glob', 'powershell', 'rg', 'view', 'web_fetch']);
  const builder = split(home.get('agents/wheelhouse-builder.agent.md')).front.tools;
  for (const tool of ['apply_patch', ...tools.shell]) assert.ok(builder.includes(tool), `the builder has ${tool}`);
});

test('the agents carry today\'s prompt text, with Claude Code\'s tool words mapped', () => {
  for (const agent of ['builder', 'reviewer', 'tester']) {
    const source = split(lf(fs.readFileSync(path.join(ROOT, 'agents', `${agent}.md`), 'utf8')));
    const built = split(home.get(`agents/wheelhouse-${agent}.agent.md`));
    assert.equal(built.front.name, `wheelhouse-${agent}`);
    assert.equal(built.front.description, source.front.description);
    const strip = (body) => body.replace(/^\n?<!--[^\n]*-->\n/, '').split('\n');
    const a = strip(source.body);
    const b = strip(built.body);
    assert.equal(a.length, b.length, `${agent}: the same number of lines`);
    for (const line of a.filter((l, i) => l !== b[i])) assert.match(line, /`(Read|Grep|Glob|Bash|WebFetch)`|CLAUDE\.md/, `${agent}: an unmapped change: ${line}`);
    assert.ok(built.body.includes(source.body.slice(source.body.indexOf('```\nWHEELHOUSE REPORT'))), `${agent}'s report block`);
  }
  assert.deepEqual(CLAUDE_TO_COPILOT, { Read: ['view'], Grep: ['rg'], Glob: ['glob'], Bash: [...tools.shell], WebFetch: ['web_fetch'] });
  assert.match(home.get('agents/wheelhouse-builder.agent.md'), /\(the rules files, such as `AGENTS\.md` and `\.github\/copilot-instructions\.md`, and any file they point to\)/);
  assert.match(home.get('agents/wheelhouse-reviewer.agent.md'), /Use `rg` and `glob` to find callers and tests/);
  assert.match(home.get('agents/wheelhouse-tester.agent.md'), /Use `bash` to run Playwright/);
  assert.match(home.get('agents/wheelhouse-tester.agent.md'), /Fetch it with `web_fetch`/);
});

test('the foreman agent\'s prompt is the foreman playbook\'s body', () => {
  const source = lf(fs.readFileSync(path.join(ROOT, 'skills', 'foreman', 'SKILL.md'), 'utf8'));
  const body = source.slice(source.indexOf('\n# The Bosun'));
  const built = split(home.get('agents/wheelhouse-foreman.agent.md'));
  assert.equal(built.front.name, 'wheelhouse-foreman');
  assert.ok(built.body.endsWith(body), 'the playbook\'s text, whole');
  assert.ok(!built.body.includes('allowed-tools'));
});

test('every file starts with its path comment, after front matter, and names the file that built it', () => {
  for (const [file, text] of home) {
    if (file === 'MANIFEST.txt') continue;
    assert.match(text, /^---\n[\s\S]*?\n---\n<!-- /, `${file}: the comment follows the front matter`);
    const first = text.split('\n---\n')[1].split('\n')[0];
    assert.match(first, new RegExp(`^<!-- ${HOME_DIR}/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(built from (agents/[a-z]+\\.md|skills/foreman/SKILL\\.md) by npm run copilot-home\\) -->$`), `${file}: ${first}`);
    const { front } = split(text);
    assert.match(front.name, /^wheelhouse-[a-z]+$/);
    assert.equal(file, `agents/${front.name}.agent.md`);
    assert.ok(front.description.length > 0 && front.description.length <= 1024);
  }
});

test('no file names a Claude Code tool, a model, a personal path or an attribution line', () => {
  for (const [file, text] of home) {
    for (const name of CLAUDE_ONLY) assert.ok(!text.includes(name), `${file} names ${name}`);
    for (const tool of CLAUDE_TOOLS) assert.ok(!text.includes(`\`${tool}\``), `${file} names \`${tool}\``);
    assert.ok(!('allowed-tools' in (file === 'MANIFEST.txt' ? {} : split(text).front)), `${file} keeps allowed-tools`);
    assert.doesNotMatch(text, /Co-Authored-By|Generated with/i, file);
    assert.doesNotMatch(text, /\b(opus|sonnet|haiku|fable)\b/i, file);
    assert.doesNotMatch(text, /\/Users\/|(^|[\s\"'(])\/home\/[a-z]|C:\\Users/, file);
  }
});

test('MANIFEST.txt lists every file with its git blob hash', () => {
  const lines = home.get('MANIFEST.txt').trimEnd().split('\n');
  const others = [...home.keys()].filter((f) => f !== 'MANIFEST.txt');
  assert.deepEqual(lines.map((l) => l.split(' ').slice(1).join(' ')), others, 'one line per file, in order, not the manifest itself');
  const scratch = tempFolder('wh-manifest-');
  for (const line of lines) {
    const m = /^([0-9a-f]{40}) (\S+)$/.exec(line);
    assert.ok(m, line);
    const file = path.join(scratch, m[2].replaceAll('/', '_'));
    fs.writeFileSync(file, home.get(m[2]));
    assert.equal(gitBlobHash(home.get(m[2])), m[1], `${m[2]}: the hash in the manifest`);
    assert.equal(execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim(), m[1], `${m[2]}: git hash-object`);
  }
  assert.equal(gitBlobHash('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(gitBlobHash('é\n'), execFileSync('git', ['hash-object', '--stdin'], { input: 'é\n', encoding: 'utf8' }).trim(), 'bytes, not characters');
});

test('the build throws when a source is missing, or names a tool with no Copilot name, and never skips one', () => {
  const root = copyOfSources();
  fs.rmSync(path.join(root, 'agents', 'tester.md'));
  assert.throws(() => buildHome({ root }), /agents[\\/]tester\.md/);
  const root2 = copyOfSources();
  const file = path.join(root2, 'agents', 'builder.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Read the task text', 'Use `NotebookRead` on the task text'));
  assert.throws(() => buildHome({ root: root2 }), /NotebookRead/);
  const root3 = copyOfSources();
  const foreman = path.join(root3, 'skills', 'foreman', 'SKILL.md');
  fs.writeFileSync(foreman, fs.readFileSync(foreman, 'utf8').replace(/^allowed-tools:.*\n/m, ''));
  assert.throws(() => buildHome({ root: root3 }), /no allowed-tools/);
  const root4 = copyOfSources();
  const reviewer = path.join(root4, 'agents', 'reviewer.md');
  fs.writeFileSync(reviewer, fs.readFileSync(reviewer, 'utf8').replace('tools: Read, Grep, Glob', 'tools: Read, Grep, Glob, Bash'));
  assert.throws(() => buildHome({ root: root4 }), /not the reviewer's reading and searching tools/);
});

test('the script prints the paths that differ and exits 1; --write replaces the home; --root reads a tree as it stands', () => {
  const root = copyOfSources();
  const run = (...args) => spawnSync(process.execPath, [HOME_SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), [...home.keys()].map((f) => `${HOME_DIR}/${f}`).sort());
  result = run('--write');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(filesUnder(path.join(root, HOME_DIR)), [...home.keys()].sort());
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(root, HOME_DIR, 'stale.md'), 'old\n');
  fs.appendFileSync(path.join(root, HOME_DIR, 'agents', 'wheelhouse-tester.agent.md'), 'edited\n');
  result = run();
  assert.equal(result.status, 1);
  assert.deepEqual(result.stdout.trim().split('\n'), [`${HOME_DIR}/agents/wheelhouse-tester.agent.md`, `${HOME_DIR}/stale.md`]);
  assert.equal(run('--write').status, 0);
  assert.ok(!fs.existsSync(path.join(root, HOME_DIR, 'stale.md')));
  assert.deepEqual(writeHome({ root }), [...home.keys()].sort());
});

test('a .gitattributes beside the home keeps its line endings LF, and package.json has the script', () => {
  const lines = lf(fs.readFileSync(path.join(ROOT, 'adapters', 'copilot', '.gitattributes'), 'utf8')).split('\n');
  assert.equal(lines[0], '# adapters/copilot/.gitattributes');
  assert.ok(lines.includes('home/** text eol=lf'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['copilot-home'], 'node scripts/agents/copilot/home.js --write');
});
