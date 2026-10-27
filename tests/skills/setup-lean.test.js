// tests/skills/setup-lean.test.js
// Setting Lean up from one request in the chat, with git alone (design sections 6.4 and 12; Part 4 Task 5): the skill the
// chat follows, the VS Code settings it copies, and the README's one request line. The skill is text, so these tests hold what
// it says, and run the commands it gives, in folders and repositories of the test's own: the release is a local repository
// built from the kit, and HOME is a temporary folder, so nothing touches the real ~/.copilot.
import '../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../helpers/host-stand-ins.js';
import { tempFolder } from '../helpers/homes.js';
import copilot from '../../adapters/copilot/index.js';
import safetyLine from '../../adapters/copilot/safety-line.js';
import { buildHome, checkHome, gitBlobHash } from '../../scripts/agents/copilot/home.js';
import { AGENT_CONTROL } from '../../scripts/lib/agent-control.js';
import { TO_KNOW_MORE } from '../../scripts/lib/calm-words.js';
import { BOARD_FILE, LEAN_RECORD_DIR } from '../../scripts/lib/copilot-numbers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
const skill = read('adapters/copilot/skills/setup-lean/SKILL.md');
const lean = read('adapters/copilot/skills/lean/SKILL.md');
const readme = read('README.md');
const kit = buildHome({ root: ROOT });
const REPO_URL = 'https://github.com/where-is-brett/wheelhouse';

// Stand-ins for gh, glab and copilot come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

const unix = process.platform !== 'win32';
const GIT_ENV = (home) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  GIT_CONFIG_GLOBAL: path.join(home, 'none'),
  GIT_CONFIG_SYSTEM: path.join(home, 'none'),
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
});

// The skill's fenced blocks, as { lang, body } in order.
function blocks(text) {
  return [...text.matchAll(/^```([a-z]*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2] }));
}
// The block in language `lang` whose first line is the comment `# <marker>`.
function block(marker, lang = 'sh') {
  const found = blocks(skill).filter((b) => b.lang === lang && b.body.split('\n')[0] === `# ${marker}`);
  assert.equal(found.length, 1, `one ${lang} block marked "# ${marker}"`);
  return found[0].body;
}
// The skill's section named heading, up to the next `##` heading that is outside a fenced block (the Logbook's own headings are in one).
function section(heading) {
  const lines = skill.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `a section "${heading}"`);
  let fenced = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('```')) fenced = !fenced;
    else if (!fenced && lines[i].startsWith('## ')) { end = i; break; }
  }
  return `\n${lines.slice(start, end).join('\n')}\n`;
}
const sh = (script, { cwd, home }) => spawnSync('sh', ['-c', script], { cwd, env: GIT_ENV(home), encoding: 'utf8' });

// A release of the test's own: a repository holding the kit as it is on disk, tagged, which the block clones from file://.
function makeRelease(tag, mutate) {
  const dir = tempFolder('wh-release-');
  for (const rel of ['adapters/copilot/home', 'adapters/copilot/vscode-settings.json', 'docs/copilot/tested-versions.md']) {
    const from = path.join(ROOT, ...rel.split('/'));
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dir, ...rel.split('/')), { recursive: true });
  }
  mutate?.(dir);
  const home = tempFolder('wh-release-home-');
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: GIT_ENV(home), encoding: 'utf8' });
  git('init', '-b', 'main');
  git('add', '-A');
  git('commit', '-m', 'Release');
  git('tag', tag);
  return dir;
}
// The block with the tag and the repository's address put in, as the chat would.
const fetchBlock = (tag, release) => block('fetch-and-check').replaceAll('<tag>', tag).replace(`${REPO_URL}.git`, `file://${release}`);

// A project of the test's own, on its main version with one commit.
function makeProject(name = 'orders') {
  const home = tempFolder('wh-setup-home-');
  const project = path.join(tempFolder('wh-project-'), name);
  fs.mkdirSync(project);
  const git = (...args) => execFileSync('git', args, { cwd: project, env: GIT_ENV(home), encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(project, 'app.txt'), 'one\n');
  git('add', 'app.txt');
  git('commit', '-m', 'Start');
  return { home, project, git };
}

// ---- The skill itself ----

test('the skill has front matter, then its path comment, and is named setup-lean', () => {
  assert.match(skill, /^---\nname: setup-lean\ndescription: [^\n]+\n---\n<!-- adapters\/copilot\/skills\/setup-lean\/SKILL\.md -->\n/);
  assert.ok(skill.split('\n')[2].length < 1100);
});

test('the kit holds the skill as wheelhouse-setup, built from adapters/copilot/skills/setup-lean and not from skills/setup', () => {
  const text = kit.get('skills/wheelhouse-setup/SKILL.md');
  assert.ok(text, 'the kit has wheelhouse-setup');
  assert.match(text, /^---\nname: "wheelhouse-setup"\ndescription: "[^\n]+"\n---\n<!-- adapters\/copilot\/home\/skills\/wheelhouse-setup\/SKILL\.md \(built from adapters\/copilot\/skills\/setup-lean\/SKILL\.md by npm run copilot-home\) -->\n/);
  assert.ok(!text.includes('{{') && !text.includes('wheelhouse:'));
  assert.doesNotMatch(text, /scripts\/setup\/cli\.js|the host helper/i, 'none of the Node.js setup\'s steps');
  assert.ok(kit.get('MANIFEST.txt').includes(' skills/wheelhouse-setup/SKILL.md\n'), 'the manifest lists it');
  assert.deepEqual(checkHome({ root: ROOT }), [], 'the committed kit is what the build gives');
});

test('the steps come in the order the design gives', () => {
  const heads = [...skill.matchAll(/^## (Step \d)[^\n]*$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6']);
  const at = (h) => skill.indexOf(`\n## ${h}`);
  assert.match(section('Step 1: is git here?'), /git --version/);
  assert.match(section('Step 2: get Wheelhouse and copy the kit'), /MANIFEST\.txt/);
  assert.match(section('Step 3: can Wheelhouse run here?'), /node --version/);
  assert.match(section('Step 4: set up the project'), /\.vscode\/settings\.json/);
  assert.match(section('Step 5: the copy'), /Choose a folder/);
  assert.match(section('Step 6: are these versions tested?'), /tested-versions\.md/);
  for (let i = 1; i < 6; i += 1) assert.ok(at(`Step ${i}`) < at(`Step ${i + 1}`));
});

// ---- Step 1 ----

test('without git the chat stops kindly, before anything else', () => {
  const step = section('Step 1: is git here?');
  assert.match(step, /git --version/);
  assert.match(step, /stop/i);
  assert.match(step, /nothing (has )?changed|changed nothing|nothing was/i);
  assert.match(step, /git-scm\.com/, 'says where git comes from');
  assert.match(step, /never install/i, 'the chat installs nothing');
  assert.ok(skill.indexOf('git --version') < skill.indexOf('git clone'));
});

// ---- Step 2: the clone, the copy and the manifest ----

test('the setup skill checks every copied file against MANIFEST.txt', () => {
  const step = section('Step 2: get Wheelhouse and copy the kit');
  assert.ok(step.includes(`${REPO_URL}.git`), 'the public repository');
  assert.match(step, /~\/\.copilot\/wheelhouse\/<tag>/, 'the clone goes in the tag\'s own folder');
  assert.match(step, /--branch/);
  assert.match(step, /adapters\/copilot\/home/);
  assert.match(step, /MANIFEST\.txt/);
  assert.match(step, /git hash-object/);
  assert.match(step, /skills, agents and instructions|skills, agents, instructions/i);
  assert.match(step, /hooks\//, 'names the folder step 4 handles');
  assert.match(step, /stop/i);
  assert.match(step, /copies? nothing more|copy nothing more/i);
  const sh1 = block('fetch-and-check');
  assert.match(sh1, /git hash-object/);
  assert.match(sh1, /MANIFEST\.txt/);
  assert.match(sh1, /case "\$file" in hooks\/\*\)/, 'hooks/ is left to step 4');
  // Every copied file is hashed after it is copied, and the sources before anything is.
  assert.ok(sh1.indexOf('# before anything is copied') >= 0 && sh1.indexOf('# after each file is copied') > sh1.indexOf('# before anything is copied'));
  const ps = block('fetch-and-check', 'powershell');
  assert.match(ps, /git hash-object/);
  assert.match(ps, /MANIFEST\.txt/);
  assert.match(ps, /hooks\//);
  assert.match(ps, /--branch/);
  assert.ok(ps.includes(`${REPO_URL}.git`));
});

test('the fetch-and-check block clones the tag and copies the kit into the home, every file matching the manifest', { skip: !unix && 'a shell script' }, () => {
  const release = makeRelease('v9.9.9');
  const { home, project } = makeProject();
  const result = sh(fetchBlock('v9.9.9', release), { cwd: project, home });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const manifest = fs.readFileSync(path.join(ROOT, 'adapters/copilot/home/MANIFEST.txt'), 'utf8').trim().split('\n');
  assert.ok(manifest.length >= 14);
  for (const line of manifest) {
    const [hash, file] = line.split(' ');
    const copied = path.join(home, '.copilot', ...file.split('/'));
    // The shell guard and its hook file are step 4's, on a Mac without Node.js (Part 5 Task 8).
    if (file.startsWith('hooks/')) {
      assert.ok(!fs.existsSync(copied), `${file} is left for step 4`);
      continue;
    }
    assert.ok(fs.existsSync(copied), `${file} was copied into the home's .copilot`);
    assert.equal(gitBlobHash(fs.readFileSync(copied)), hash, `${file} matches the manifest`);
  }
  assert.ok(fs.existsSync(path.join(home, '.copilot', 'wheelhouse', 'v9.9.9', 'adapters', 'copilot', 'home', 'MANIFEST.txt')), 'the clone is in the tag\'s folder');
  assert.ok(!fs.existsSync(path.join(home, '.copilot', 'MANIFEST.txt')), 'the manifest itself is not copied');
  // A second run, with the clone there, copies the same again.
  const again = sh(fetchBlock('v9.9.9', release), { cwd: project, home });
  assert.equal(again.status, 0, again.stderr);
});

test('a file that does not match the manifest stops the copy before any file is copied', { skip: !unix && 'a shell script' }, () => {
  const release = makeRelease('v9.9.8', (dir) => {
    fs.appendFileSync(path.join(dir, 'adapters/copilot/home/skills/wheelhouse-lean/SKILL.md'), 'A line the manifest does not know.\n');
  });
  const { home, project } = makeProject();
  const result = sh(fetchBlock('v9.9.8', release), { cwd: project, home });
  assert.notEqual(result.status, 0, 'stops');
  assert.match(result.stdout + result.stderr, /wheelhouse-lean\/SKILL\.md/, 'names the file');
  assert.ok(!fs.existsSync(path.join(home, '.copilot', 'skills')), 'nothing was copied');
  assert.ok(!fs.existsSync(path.join(home, '.copilot', 'agents')));
});

test('a copy that does not match stops at that file and copies nothing more', { skip: !unix && 'a shell script' }, () => {
  // A stand-in cp that damages one file, so the check after the copy is what stops it.
  const release = makeRelease('v9.9.7');
  const { home, project } = makeProject();
  const bin = tempFolder('wh-bin-');
  fs.writeFileSync(path.join(bin, 'cp'), '#!/bin/sh\n/bin/cp "$@"\ncase "$2" in *wheelhouse-board*) printf "damaged" >> "$2" ;; esac\n', { mode: 0o755 });
  const env = { ...GIT_ENV(home), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const result = spawnSync('sh', ['-c', fetchBlock('v9.9.7', release)], { cwd: project, env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /wheelhouse-board\/SKILL\.md/);
  const manifest = fs.readFileSync(path.join(ROOT, 'adapters/copilot/home/MANIFEST.txt'), 'utf8').trim().split('\n').map((l) => l.split(' ')[1]);
  const after = manifest.slice(manifest.indexOf('skills/wheelhouse-board/SKILL.md') + 1);
  assert.ok(after.length > 0);
  for (const file of after) assert.ok(!fs.existsSync(path.join(home, '.copilot', ...file.split('/'))), `${file} comes after the mismatch and was not copied`);
});

test('a hooks/ file in the manifest is left for step 4', { skip: !unix && 'a shell script' }, () => {
  // The kit lists the shell guard and its hook file (Part 5 Task 8).
  assert.match(fs.readFileSync(path.join(ROOT, 'adapters/copilot/home/MANIFEST.txt'), 'utf8'), / hooks\/wheelhouse\.json$/m);
  const release = makeRelease('v9.9.6');
  const { home, project } = makeProject();
  const result = sh(fetchBlock('v9.9.6', release), { cwd: project, home });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(path.join(home, '.copilot', 'hooks')), 'step 2 copies no hook');
  assert.ok(fs.existsSync(path.join(home, '.copilot', 'skills', 'wheelhouse-lean', 'SKILL.md')));
});

test('a clone that is not the tag asked for stops setup', { skip: !unix && 'a shell script' }, () => {
  const release = makeRelease('v9.9.5');
  const { home, project } = makeProject();
  // The tag's folder holds another repository, at no tag.
  const other = path.join(home, '.copilot', 'wheelhouse', 'v9.9.5');
  fs.mkdirSync(other, { recursive: true });
  execFileSync('git', ['init', '-b', 'main', other], { env: GIT_ENV(home) });
  const result = sh(fetchBlock('v9.9.5', release), { cwd: project, home });
  assert.notEqual(result.status, 0);
  assert.ok(!fs.existsSync(path.join(home, '.copilot', 'skills')));
});

// ---- The blocks leave the terminal as it was ----

test('every sh block runs in a subshell and every PowerShell block in a script block of its own, never exit', () => {
  const marked = blocks(skill).filter((b) => /^# [a-z-]+$/.test(b.body.split('\n')[0]));
  assert.equal(marked.length, 9, 'fetch-and-check, ignore-lines, first-commit and copy-remote, each for sh and for PowerShell, and copy-guard for the Mac alone');
  assert.deepEqual(marked.filter((b) => b.body.startsWith('# copy-guard\n')).map((b) => b.lang), ['sh'], 'the shell guard is the Mac\'s (check 69)');
  for (const marker of ['fetch-and-check', 'ignore-lines', 'first-commit', 'copy-remote']) {
    assert.equal(marked.filter((b) => b.body.split('\n')[0] === `# ${marker}`).map((b) => b.lang).sort().join(), 'powershell,sh', `${marker} has a block for each shell`);
  }
  for (const { lang, body } of marked) {
    const lines = body.trimEnd().split('\n');
    if (lang === 'sh') {
      assert.equal(lines[1], '(', `${lines[0]}: opens a subshell`);
      assert.equal(lines.at(-1), ')', `${lines[0]}: closes it`);
    } else {
      assert.equal(lines[1], '& {', `${lines[0]}: opens a script block`);
      assert.equal(lines.at(-1), '}');
      assert.doesNotMatch(body, /\bexit\b|\bcd\b|Set-Location/, `${lines[0]}: the terminal is left alone`);
    }
  }
  assert.match(skill, /leaves the terminal's folder, variables and shell as they were/);
});

test('the blocks run in one persistent shell: the folder is unchanged and the shell is alive after a failure', { skip: !unix && 'a shell script' }, () => {
  const release = makeRelease('v9.9.4');
  const bad = makeRelease('v9.9.3', (dir) => {
    fs.appendFileSync(path.join(dir, 'adapters/copilot/home/skills/wheelhouse-lean/SKILL.md'), 'A line the manifest does not know.\n');
  });
  const { home, project } = makeProject();
  const wholeIgnored = makeProject('ignored');
  fs.writeFileSync(path.join(wholeIgnored.project, '.gitignore'), '.wheelhouse/\n');
  const gone = path.join(tempFolder('wh-drive-'), 'gone');
  // One shell reads the lot, as Copilot's persistent terminal does; each step prints where it ended and its status.
  const probe = (label) => `echo "${label} status=$? pwd=$(pwd -P) args=$#"`;
  const script = [
    `cd '${project}'`,
    'set -- keep me',
    fetchBlock('v9.9.4', release), probe('fetch-ok'),
    fetchBlock('v9.9.3', bad), probe('fetch-bad'),
    `cd '${wholeIgnored.project}'`, block('ignore-lines'), probe('ignore-bad'),
    block('copy-remote').replaceAll('<folder>', gone), probe('copy-bad'),
    `cd '${project}'`, block('ignore-lines'), probe('ignore-ok'),
    block('first-commit'), probe('commit'),
    'echo shell-alive',
  ].join('\n');
  const result = spawnSync('sh', ['-c', script], { env: GIT_ENV(home), encoding: 'utf8' });
  assert.equal(result.status, 0, 'the shell ran to its last line');
  const out = result.stdout;
  assert.match(out, /shell-alive/, 'the shell is still alive after failures');
  const line = (label) => out.split('\n').find((l) => l.startsWith(`${label} `));
  const where = (p) => fs.realpathSync(p);
  assert.equal(line('fetch-ok'), `fetch-ok status=0 pwd=${where(project)} args=2`, 'a good fetch leaves the folder and the arguments as they were');
  assert.match(line('fetch-bad'), new RegExp(`^fetch-bad status=[1-9]\\d* pwd=${where(project).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} args=2$`), 'a failed fetch ends in a status, not in the release folder');
  assert.match(line('ignore-bad'), /status=[1-9]/);
  assert.match(line('ignore-bad'), new RegExp(`pwd=${where(wholeIgnored.project)} `));
  assert.match(out, /The record is ignored/, 'the stop message is shown');
  assert.match(line('copy-bad'), /status=[1-9]/);
  assert.match(out, /That folder isn't there/);
  assert.match(line('ignore-ok'), /status=0/);
  assert.match(line('commit'), /status=0 pwd=\S+ args=2$/);
  // Nothing was written into the release clone.
  const clone = path.join(home, '.copilot', 'wheelhouse', 'v9.9.4');
  assert.equal(execFileSync('git', ['status', '--short'], { cwd: clone, env: GIT_ENV(home), encoding: 'utf8' }), '', 'the release clone is as cloned');
  assert.ok(!fs.existsSync(path.join(clone, '.gitignore')) && !fs.existsSync(path.join(clone, '.vscode')));
  assert.ok(fs.existsSync(path.join(project, '.gitignore')), 'the project\'s own folder got the file');
});

test('setup run again keeps the Logbook the director has, and changes only its tier lines', () => {
  const step = section('Step 4: set up the project');
  assert.match(step, /only if there is none/);
  assert.match(step, /keep it as it is/i);
  assert.match(step, /All stop/);
  assert.match(step, /never turns All stop off/);
  assert.match(step, /waiting to be recorded|Waiting to be recorded/i);
  assert.match(step, /Change only its tier lines/);
  assert.match(step, /only if they differ/);
  assert.match(step, /replace those lines and nothing below them/);
  assert.match(step, /Start in the project's folder/);
  assert.match(step, /not the release clone/);
});

test('no command in the README or the skill passes a bare ~ to git, cp or a copy', () => {
  const commandStart = /^(git|cp|mkdir|cd|Copy-Item|New-Item|Join-Path)\b/;
  const spans = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  for (const [name, text] of [['README.md', readme], ['SKILL.md', skill]]) {
    for (const span of spans(text)) {
      if (commandStart.test(span)) assert.doesNotMatch(span, /(^|\s|")~/, `${name}: "${span}"`);
    }
    // A path the chat is told to copy from or write to, in a code span, is written with $HOME.
    for (const span of spans(text)) assert.doesNotMatch(span, /~\/\.copilot\/wheelhouse\/<tag>\/adapters/, `${name}: "${span}"`);
  }
  for (const { body } of blocks(skill)) {
    for (const line of body.split('\n').filter((l) => !l.trim().startsWith('#'))) assert.doesNotMatch(line, /(^|\s|")~[/\\]/, `a block line: ${line}`);
  }
  // The README's clone line uses $HOME, as the skill's blocks do.
  assert.ok(readme.includes('git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git "$HOME/.copilot/wheelhouse/<tag>"'));
  assert.match(skill, /write the home folder as `\$HOME`/);
});

// ---- Step 3: can Wheelhouse run here? ----

test('step 3 asks the computer four things and says the tier in one sentence', () => {
  const step = section('Step 3: can Wheelhouse run here?');
  for (const command of ['git --version', 'node --version', 'copilot --version', 'git remote get-url origin']) assert.ok(step.includes(command), command);
  assert.ok(step.includes('This computer runs Wheelhouse at Lean: everything stays here, and Copilot builds in your chat'));
  assert.match(step, /Node\.js 22/, 'the version Wheelhouse\'s own program needs');
  assert.match(step, /helper can add more/i, 'if Node.js runs, the helper can add more');
  assert.match(step, /Part 5|later/i);
  assert.match(step, /needs? neither|not needed|Lean needs/i, 'Copilot\'s command line is not needed at Lean');
  assert.match(step, /Linux/);
});

test('the Logbook case is chosen by what is running, and a Mac without Node.js takes the shell guard\'s', () => {
  const step = section('Step 3: can Wheelhouse run here?');
  // Ruling P5-35: a Mac with no Node.js has the kit's shell guard once step 4 puts it in place.
  const guarded = safetyLine({ tier: 'lean', platform: 'darwin', node: false, shellGuard: true });
  assert.ok(step.includes(guarded[3]), 'the skill says what the Logbook says on a Mac with the shell guard');
  assert.ok(lean.includes(`- ${guarded[3]}\n`), 'the playbook holds the shell guard\'s line');
  assert.match(step, /A Mac without Node\.js:\*\* the lines for a Mac where Wheelhouse's shell guard runs/);
  // A Mac where it couldn't, or where Node.js runs: the line safetyLine gives with no shell guard.
  const mac = safetyLine({ tier: 'lean', platform: 'darwin', node: false, shellGuard: false });
  assert.ok(mac.includes('No Wheelhouse guards run on this computer yet'));
  assert.ok(step.includes('No Wheelhouse guards run on this computer yet'), 'the skill says what the Logbook says on a Mac without the guard');
  assert.ok(step.includes('No Wheelhouse guards run on Windows without Node.js, until a way is found'), 'and on Windows');
  assert.match(step, /Mac or Windows without Node\.js|without Node\.js/);
  assert.match(step, /even where Node\.js runs|Node\.js runs[^\n]*until the helper is installed|until the helper is installed/i, 'until the helper is installed the Logbook shows the no-Node.js lines');
  // The lines themselves are the playbook's, copied exactly.
  assert.ok(lean.includes(`- ${mac[3]}\n`), 'the playbook holds the Mac line');
});

// ---- Step 4: the project ----

test('step 4 sets up the project: settings, the record, the Logbook, a first commit', () => {
  const step = section('Step 4: set up the project');
  assert.match(step, /git rev-parse --is-inside-work-tree/);
  assert.ok(step.includes('adapters/copilot/vscode-settings.json'));
  assert.ok(step.includes('.vscode/settings.json'));
  assert.ok(step.includes(`${LEAN_RECORD_DIR}/`), 'the record folder');
  assert.ok(step.includes(BOARD_FILE));
  assert.ok(step.includes('.wheelhouse/record/.gitkeep'));
  assert.match(step, /first commit/i);
  assert.match(step, /Tier: Lean/);
  assert.match(step, /conveniences, not controls/);
  assert.match(step, /`main`/);
});

test('the project\'s settings file is copied when there is none, and merged on a card when there is one', () => {
  const step = section('Step 4: set up the project');
  assert.match(step, /no (settings file|`\.vscode\/settings\.json`)|has none|there is none|isn't one/i);
  assert.match(step, /\*\*Approve\*\*/);
  assert.match(step, /\*\*Not now\*\*/);
  assert.match(step, /merged/i);
  assert.match(step, /only after (the director's click on )?\*\*Approve\*\*|after \*\*Approve\*\*/i);
  assert.match(step, /comments/i, 'a file with comments is edited by text, not rewritten');
  assert.match(step, /never (rewrite|write) [^\n]*whole|line by line/i);
});

test('the ignore lines are the ones the playbook\'s preflight checks, and they work', { skip: !unix && 'a shell script' }, () => {
  // The playbook's own checks, in its words.
  assert.ok(lean.includes('git check-ignore -q .wheelhouse/record/<day>.jsonl'));
  assert.ok(lean.includes('git check-ignore -q .wheelhouse/feature/brief.md'));
  assert.ok(lean.includes('`!.wheelhouse/record/`'));
  const script = block('ignore-lines');
  for (const line of ['.wheelhouse/*', '!.wheelhouse/record/', 'wheelhouse/']) assert.ok(script.includes(`'${line}'`), line);
  const check = (project, home, file) => spawnSync('git', ['check-ignore', '-q', file], { cwd: project, env: GIT_ENV(home) }).status;
  for (const gitignore of [undefined, 'node_modules/\n', 'node_modules/', 'dist/\n.wheelhouse/*\n!.wheelhouse/record/\n']) {
    const { home, project } = makeProject();
    if (gitignore !== undefined) fs.writeFileSync(path.join(project, '.gitignore'), gitignore);
    const result = sh(script, { cwd: project, home });
    assert.equal(result.status, 0, `${JSON.stringify(gitignore)}: ${result.stderr}${result.stdout}`);
    assert.equal(check(project, home, '.wheelhouse/feature/brief.md'), 0, 'the feature folder is ignored');
    assert.equal(check(project, home, 'wheelhouse/board.md'), 0, 'the Logbook is ignored');
    assert.equal(check(project, home, '.wheelhouse/record/2026-10-23.jsonl'), 1, 'the record is not');
    const text = fs.readFileSync(path.join(project, '.gitignore'), 'utf8');
    if (gitignore !== undefined) assert.ok(text.startsWith(gitignore), 'the lines the project had are kept as they were');
    // Run again: nothing is added twice.
    const second = sh(script, { cwd: project, home });
    assert.equal(second.status, 0);
    assert.equal(fs.readFileSync(path.join(project, '.gitignore'), 'utf8'), text, 'a second run adds nothing');
  }
});

test('a project that ignores the whole .wheelhouse folder stops the ignore lines, for a card', { skip: !unix && 'a shell script' }, () => {
  const { home, project } = makeProject();
  fs.writeFileSync(path.join(project, '.gitignore'), '.wheelhouse/\n');
  const result = sh(block('ignore-lines'), { cwd: project, home });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /record is ignored/i);
  assert.equal(fs.readFileSync(path.join(project, '.gitignore'), 'utf8'), '.wheelhouse/\n', 'the project\'s own line is left alone');
  const step = section('Step 4: set up the project');
  assert.match(step, /ignores? (all of|the whole of|the whole) `?\.wheelhouse/i);
  assert.match(step, /card/i);
});

test('the first commit holds the three files and nothing else of the director\'s', { skip: !unix && 'a shell script' }, () => {
  const { home, project, git } = makeProject();
  sh(block('ignore-lines'), { cwd: project, home });
  fs.mkdirSync(path.join(project, '.vscode'));
  fs.writeFileSync(path.join(project, '.vscode', 'settings.json'), '{}\n');
  fs.mkdirSync(path.join(project, '.wheelhouse', 'record'), { recursive: true });
  fs.writeFileSync(path.join(project, '.wheelhouse', 'record', '.gitkeep'), '');
  fs.writeFileSync(path.join(project, 'theirs.txt'), 'the director\'s own work\n');
  git('add', 'theirs.txt');
  fs.writeFileSync(path.join(project, 'app.txt'), 'one\ntwo\n');
  const result = sh(block('first-commit'), { cwd: project, home });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(git('log', '-1', '--format=%s'), 'Set up Wheelhouse at Lean');
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['.gitignore', '.vscode/settings.json', '.wheelhouse/record/.gitkeep']);
  assert.match(git('status', '--short'), /^A {2}theirs\.txt$/m, 'their staged file is still staged');
  assert.match(git('status', '--short'), /M app\.txt$/m, 'their change is still a change');
  assert.equal(git('log', '--format=%an %ae %s', '-1'), 'Test t@example.invalid Set up Wheelhouse at Lean');
});

test('the first commit\'s files, in both shells, are the adapter\'s packaging list', () => {
  const listed = (body) => [...body.matchAll(/'((?:\.gitignore|\.vscode\/settings\.json|\.wheelhouse\/record\/\.gitkeep))'/g)].map((m) => m[1]);
  const fromSh = block('first-commit', 'sh').split('\n').find((l) => l.includes('for p in')).match(/for p in (.*); do/)[1].split(' ');
  assert.deepEqual(fromSh, copilot.packaging.files(), 'the sh block commits what the adapter says setup writes');
  assert.deepEqual(listed(block('first-commit', 'powershell')), copilot.packaging.files(), 'and so does the PowerShell block');
});

test('the PowerShell blocks for the first commit and the copy folder are script blocks that check every git call and leave the terminal alone', () => {
  for (const marker of ['first-commit', 'copy-remote']) {
    const body = block(marker, 'powershell');
    const lines = body.trimEnd().split('\n');
    assert.equal(lines[1], '& {');
    assert.equal(lines.at(-1), '}');
    assert.doesNotMatch(body, /\bexit\b|\bcd\b|Set-Location|~/, `${marker}: no exit, no folder change, no tilde`);
    assert.match(body, /\bthrow\b/);
    // Every native git call is followed by a status check, so a failure stops the block with a message, not silently.
    const calls = lines.filter((l) => /^\s*git (add|commit|init|remote|ls-remote)\b/.test(l)).length;
    const checks = lines.filter((l) => l.includes('$LASTEXITCODE')).length;
    assert.ok(calls >= 2 && checks >= calls, `${marker}: ${calls} git calls, ${checks} checks`);
  }
  const commit = block('first-commit', 'powershell');
  assert.match(commit, /git check-ignore -q/, 'a path the project ignores is left out, as in sh');
  assert.match(commit, /git commit -m 'Set up Wheelhouse at Lean' -- \$Paths/, 'only the named paths are committed');
  assert.match(commit, /\$Paths\.Count -eq 0/, 'with no path to name, nothing is committed (git commit with no paths takes the index)');
  const copy = block('copy-remote', 'powershell');
  assert.match(copy, /git init --bare --initial-branch=main/);
  assert.match(copy, /git remote add wheelhouse-copy/);
  assert.match(copy, /inside the project/);
  assert.match(skill, /a `'` in the path is written `''`/);
});

test('the first commit works in a project with no commit yet, and leaves out a path the project ignores', { skip: !unix && 'a shell script' }, () => {
  const home = tempFolder('wh-setup-home-');
  const project = path.join(tempFolder('wh-project-'), 'fresh');
  fs.mkdirSync(path.join(project, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(project, '.wheelhouse', 'record'), { recursive: true });
  fs.writeFileSync(path.join(project, '.vscode', 'settings.json'), '{}\n');
  fs.writeFileSync(path.join(project, '.wheelhouse', 'record', '.gitkeep'), '');
  fs.writeFileSync(path.join(project, '.gitignore'), '.vscode/\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: project, env: GIT_ENV(home) });
  sh(block('ignore-lines'), { cwd: project, home });
  const result = sh(block('first-commit'), { cwd: project, home });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: project, env: GIT_ENV(home), encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(files, ['.gitignore', '.wheelhouse/record/.gitkeep'], 'the ignored settings file is left out of the commit');
});

test('a checkout setup leaves behind passes the playbook\'s own preflight', { skip: !unix && 'a shell script' }, () => {
  const { home, project, git } = makeProject();
  sh(block('ignore-lines'), { cwd: project, home });
  fs.mkdirSync(path.join(project, '.wheelhouse', 'record'), { recursive: true });
  fs.writeFileSync(path.join(project, '.wheelhouse', 'record', '.gitkeep'), '');
  fs.mkdirSync(path.join(project, 'wheelhouse'));
  fs.writeFileSync(path.join(project, BOARD_FILE), 'Tier: Lean\n');
  fs.mkdirSync(path.join(project, '.wheelhouse', 'feature'));
  fs.writeFileSync(path.join(project, '.wheelhouse', 'feature', 'brief.md'), 'x\n');
  sh(block('first-commit'), { cwd: project, home });
  assert.equal(git('status', '--short'), '', 'git status is empty, so a record line can be written');
  assert.equal(git('ls-files', '.wheelhouse'), '.wheelhouse/record/.gitkeep');
});

test('hooks come from the kit only on a Mac without Node.js, and only when the kit lists them', () => {
  const step = section('Step 4: set up the project');
  assert.match(step, /hooks\/wheelhouse\.json/);
  assert.match(step, /shell guard/);
  assert.match(step, /Mac/);
  assert.match(step, /node --version/);
  assert.match(step, /MANIFEST\.txt/);
  assert.match(step, /does not list|MANIFEST\.txt does not list/i, 'it copies only what the manifest lists');
  assert.match(step, /copy no hook file/i);
  assert.match(step, /no Wheelhouse guard runs here yet/i);
  assert.match(step, /69/, 'check 69');
  // The kit holds the guard and its hook file now (Part 5 Task 8), and the block copies those two and nothing else.
  assert.deepEqual([...kit.keys()].filter((f) => f.startsWith('hooks/')), ['hooks/wheelhouse-lean-guard.sh', 'hooks/wheelhouse.json']);
  assert.deepEqual(block('copy-guard').match(/for file in (.*); do/)[1].split(' '), ['hooks/wheelhouse-lean-guard.sh', 'hooks/wheelhouse.json'], 'the guard first');
  // Step 4 says which board block follows, and that the guard runs (ruling P5-35).
  assert.ok(step.includes('Wheelhouse\'s shell guard now runs on this Mac: it keeps the files that steer agents, and refuses a tool it doesn\'t know'));
  assert.match(step, /the block for a Mac where the shell guard runs/);
  assert.ok(step.indexOf('# copy-guard') < step.indexOf('Write the Logbook'), 'the guard is put in place before the Logbook is written');
});

test('the copy-guard block puts the kit\'s guard in place on a Mac without Node.js, and the guard runs', { skip: process.platform !== 'darwin' && 'the shell guard is for macOS' }, () => {
  const release = makeRelease('v9.9.4');
  const { home, project } = makeProject();
  assert.equal(sh(fetchBlock('v9.9.4', release), { cwd: project, home }).status, 0);
  const noNode = tempFolder('wh-no-node-');
  for (const tool of ['git', 'awk', 'cp', 'mv', 'mkdir', 'rm']) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(found, path.join(noNode, tool));
  }
  const PATH = `${stand.dir}${path.delimiter}${noNode}`;
  const env = { ...GIT_ENV(home), PATH };
  delete env.COPILOT_HOME;
  const copy = block('copy-guard').replaceAll('<tag>', 'v9.9.4');
  const run = (script, extra = {}) => spawnSync('/bin/sh', ['-c', script], { cwd: project, env: { ...env, ...extra }, encoding: 'utf8' });
  assert.equal(run('command -v node').status, 1, 'no node on the PATH');
  const done = run(copy);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.match(done.stdout, /Wheelhouse's shell guard is in place/);
  const hooks = path.join(home, '.copilot', 'hooks');
  assert.deepEqual(fs.readdirSync(hooks).sort(), ['wheelhouse-lean-guard.sh', 'wheelhouse.json']);
  for (const name of ['wheelhouse.json', 'wheelhouse-lean-guard.sh']) assert.equal(fs.readFileSync(path.join(hooks, name), 'utf8'), kit.get(`hooks/${name}`));
  // The hook file's entry runs the guard, which refuses a write to a file that steers an agent.
  const entry = JSON.parse(fs.readFileSync(path.join(hooks, 'wheelhouse.json'), 'utf8')).hooks.preToolUse[0].bash;
  // The guard guards a Lean project: the record folder beside git (ruling P5-56).
  fs.mkdirSync(path.join(project, '.wheelhouse', 'record'), { recursive: true });
  const input = JSON.stringify({ sessionId: 's', timestamp: 0, cwd: project, toolName: 'create', toolArgs: { path: path.join(project, 'AGENTS.md') } });
  const guard = spawnSync('/bin/sh', ['-c', entry], { cwd: project, env, input, encoding: 'utf8' });
  assert.equal(guard.status, 2, guard.stdout + guard.stderr);
  assert.equal(JSON.parse(guard.stdout).permissionDecision, 'deny');
  // Run again, it puts the same files in place.
  assert.equal(run(copy).status, 0);
  // A guard that doesn't match the manifest stops it, and nothing it didn't match is left in the hook folder.
  const bad = makeRelease('v9.9.3', (dir) => fs.appendFileSync(path.join(dir, 'adapters/copilot/home/hooks/wheelhouse-lean-guard.sh'), '# a line the manifest does not know\n'));
  const other = makeProject('other');
  const otherEnv = { ...GIT_ENV(other.home), PATH };
  fs.mkdirSync(path.join(other.home, '.copilot', 'wheelhouse'), { recursive: true });
  execFileSync('git', ['clone', '-q', '--branch', 'v9.9.3', `file://${bad}`, path.join(other.home, '.copilot', 'wheelhouse', 'v9.9.3')], { env: otherEnv });
  const stopped = spawnSync('/bin/sh', ['-c', block('copy-guard').replaceAll('<tag>', 'v9.9.3')], { cwd: other.project, env: otherEnv, encoding: 'utf8' });
  assert.equal(stopped.status, 1);
  assert.match(stopped.stdout, /Does not match MANIFEST\.txt: hooks\/wheelhouse-lean-guard\.sh/);
  assert.deepEqual(fs.readdirSync(path.join(other.home, '.copilot', 'hooks')), []);
  // Where Node.js runs, it copies nothing.
  const withNode = spawnSync('/bin/sh', ['-c', block('copy-guard').replaceAll('<tag>', 'v9.9.3')], { cwd: other.project, env: { ...otherEnv, PATH: `${path.dirname(process.execPath)}${path.delimiter}${PATH}` }, encoding: 'utf8' });
  assert.equal(withNode.status, 1);
  assert.match(withNode.stdout, /Node\.js runs here/);
});

test('the Logbook setup writes has the playbook\'s parts, in the playbook\'s order, and says no copy yet', () => {
  const step = section('Step 4: set up the project');
  const headings = ['Waiting on you', 'Building now', 'Done lately', 'The copy', 'All stop', 'Waiting to be recorded'];
  let at = -1;
  for (const heading of headings) {
    const next = step.indexOf(`## ${heading}\n`);
    assert.ok(next > at, `"## ${heading}" comes in order`);
    at = next;
    assert.ok(lean.includes(`## ${heading}\n`), `the playbook has it too`);
  }
  assert.match(step, /No copy yet/);
  assert.match(step, /wheelhouse-lean/);
  assert.match(step, /exactly/i);
  assert.match(step, /dash/i);
});

// ---- Step 5: the copy ----

test('step 5 asks where the copy goes with a card, and makes a bare repository and the remote', () => {
  const step = section('Step 5: the copy');
  assert.match(step, /\*\*Choose a folder\*\*/);
  assert.match(step, /\*\*Not now\*\*/);
  assert.match(step, /git init --bare/);
  assert.match(step, /git remote add wheelhouse-copy/);
  assert.match(step, /recommend/i);
  assert.match(step, /not in (this|the) project|outside the project/i);
  assert.match(step, /git remote get-url wheelhouse-copy/, 'asked once: setup run again finds the copy');
  assert.match(step, /No copy yet/);
});

test('the copy block makes a bare repository in the chosen folder and adds the remote', { skip: !unix && 'a shell script' }, () => {
  const { home, project, git } = makeProject('orders-app');
  const folder = tempFolder('wh-drive-');
  const result = sh(block('copy-remote').replaceAll('<folder>', folder), { cwd: project, home });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const copy = path.join(folder, 'orders-app.git');
  assert.equal(git('remote', 'get-url', 'wheelhouse-copy'), copy);
  assert.equal(execFileSync('git', ['-C', copy, 'rev-parse', '--is-bare-repository'], { env: GIT_ENV(home), encoding: 'utf8' }).trim(), 'true');
  git('push', 'wheelhouse-copy', 'main');
  assert.equal(execFileSync('git', ['-C', copy, 'rev-parse', 'refs/heads/main'], { env: GIT_ENV(home), encoding: 'utf8' }).trim(), git('rev-parse', 'main'), 'the playbook\'s first push works');
});

test('a folder that is not there stops the copy block and leaves no remote', { skip: !unix && 'a shell script' }, () => {
  const { home, project, git } = makeProject();
  const folder = path.join(tempFolder('wh-drive-'), 'gone', 'deeper');
  const result = sh(block('copy-remote').replaceAll('<folder>', folder), { cwd: project, home });
  assert.notEqual(result.status, 0);
  assert.equal(git('remote'), '', 'no remote was added');
});

// ---- Step 6 ----

test('step 6 compares the person\'s versions with the table, and says plainly when they are not tested', () => {
  const step = section('Step 6: are these versions tested?');
  assert.ok(step.includes('docs/copilot/tested-versions.md'));
  assert.match(step, /code --version/);
  assert.match(step, /passed/);
  assert.match(step, /isn't tested yet|aren't tested yet|not tested yet/i);
  assert.match(step, /VS Code/);
  assert.match(step, /Copilot runtime/);
  assert.match(step, /can't be read|cannot be read|couldn't be read/i, 'a version that can\'t be read counts as not tested');
  assert.match(step, /still works|carry on|doesn't stop/i, 'an untested version does not stop setup');
});

// ---- Cards, the director, and what the chat never does ----

test('every question is a card with the five parts, asked with the clickable-question tool', () => {
  const cards = section('Cards');
  assert.ok(skill.includes('your clickable-question tool'));
  for (const part of [/what this is/i, /why it comes to/i, /options/i, /recommend/i, /what happens meanwhile/i]) assert.match(cards, part);
  assert.match(cards, /Only a click decides|only a click/i);
  assert.match(cards, /put the card in your reply|in your reply/i);
  // Calm's card words (scripts/lib/calm-words.js): Why? is for learning only and never an answer.
  assert.match(cards, /\*\*Why\?\*\*/);
  assert.ok(cards.includes(TO_KNOW_MORE), 'a card\'s last line');
  assert.match(cards, /That is for learning only: it is never an answer/);
  assert.ok(!skill.includes('Explain more'), 'Explain more is not offered');
});

test('the chat never asks for a key or a password, and stops anyone who offers one', () => {
  assert.match(skill, /never ask for a key|never asks? for a (key|password)|You never:[^\n]*(key|password)/i);
  assert.match(skill, /sign-in window/i);
  assert.match(skill, /Don't send that here|do not send/i);
  // A request for a credential is the only place those words may appear.
  for (const line of skill.split('\n').filter((l) => /\b(password|passphrase|token|api key)\b/i.test(l))) {
    assert.match(line, /never|don't|do not|not |window|stop|nothing|no /i, `a line that names a secret: ${line}`);
  }
});

test('the chat explains why Copilot asks before each command, and asks to run nothing that changes the computer beyond the steps', () => {
  assert.match(skill, /asks? (you )?before (each|every) command|asks the director before each command/i);
  assert.match(skill, /You never:/);
  assert.match(skill, /install/i);
});

test('the settings are called conveniences, not controls, and a company\'s win', () => {
  assert.match(skill, /conveniences, not controls/);
  assert.match(skill, /company's? (own )?settings win|own settings win|win over/i);
});

test('the skill speaks plainly, in British English, with dates as the project writes them', () => {
  assert.doesNotMatch(skill, /\b(enhanced|improved|fixed)\b/i);
  assert.doesNotMatch(skill, /\b(opus|sonnet|haiku)\b|Co-Authored-By|Generated with|Claude Code|\bClaude\b/i);
  for (const name of ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT', 'TodoWrite', 'WebFetch', 'WebSearch', 'NotebookRead']) assert.ok(!skill.includes(name), name);
  for (const tool of ['Write', 'Read', 'Edit', 'Bash', 'Grep', 'Glob']) assert.ok(!skill.includes(`\`${tool}\``), tool);
  assert.doesNotMatch(skill, /\b(color|behavior|organization|center|license)\b/i, 'British spellings');
  assert.doesNotMatch(skill, /October 23|23\/10|10\/23/);
  assert.match(skill, /the director/);
  assert.doesNotMatch(skill, /\b(he|she|his|her)\b/i, 'the director is they');
});

test('the skill says what setup leaves behind, so setup can be run again safely', () => {
  const left = section('What setup leaves behind');
  for (const thing of ['~/.copilot/', '.vscode/settings.json', '.gitignore', '.wheelhouse/record/', BOARD_FILE, 'wheelhouse-copy']) assert.ok(left.includes(thing), thing);
  assert.match(left, /again/i);
  assert.match(skill, /carry on later|stop at any card/i);
});

// ---- VS Code's settings ----

const SETTINGS_FILE = 'adapters/copilot/vscode-settings.json';
const research = read('docs/research/copilot-vscode-2026-10.md');
// Each setting the file may hold, with the line of the research it comes from, quoted as the research has it.
const SOURCE_LINES = {
  'chat.tools.global.autoApprove': '**Global "YOLO":** `chat.tools.global.autoApprove` (default `false`; "disables critical security protections")',
  'chat.tools.terminal.enableAutoApprove': '`chat.tools.terminal.enableAutoApprove` toggles rule-based approval.',
  'chat.tools.terminal.blockDetectedFileWrites': '`chat.tools.terminal.blockDetectedFileWrites` default `outsideWorkspace` (Experimental)',
  'chat.tools.edits.autoApprove': '**Edits:** `chat.tools.edits.autoApprove` glob map (e.g. `"**/.env": false`)',
};
const settings = JSON.parse(read(SETTINGS_FILE));

test('the settings file names only documented settings', () => {
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(SOURCE_LINES).sort(), 'every setting has its source line, and the file holds no other');
  for (const [name, quoted] of Object.entries(SOURCE_LINES)) {
    const line = research.split('\n').find((l) => l.includes(quoted));
    assert.ok(line, `${name}: the research has the line "${quoted}"`);
    assert.ok(line.includes(`\`${name}\``), `${name} is named in that line`);
  }
});

test('the settings keep every command asked for, edits outside the project asked for, and nothing approved automatically', () => {
  assert.equal(settings['chat.tools.global.autoApprove'], false, 'no global approval');
  assert.equal(settings['chat.tools.terminal.enableAutoApprove'], false, 'no rule approves a command without asking');
  assert.equal(settings['chat.tools.terminal.blockDetectedFileWrites'], 'outsideWorkspace', 'a command that writes outside the project is blocked');
  const edits = settings['chat.tools.edits.autoApprove'];
  assert.ok(edits && typeof edits === 'object' && !Array.isArray(edits));
  for (const [glob, value] of Object.entries(edits)) assert.equal(value, false, `${glob}: an edit is asked for, never approved`);
  assert.ok('**/.env' in edits);
});

test('edits to every file that steers an agent are asked for', () => {
  const edits = settings['chat.tools.edits.autoApprove'];
  const glob = (pattern) => (pattern.startsWith('**/') ? pattern : `**/${pattern}`);
  for (const pattern of AGENT_CONTROL) assert.ok(glob(pattern) in edits, `${pattern} is asked for as ${glob(pattern)}`);
});

test('the settings file is plain JSON a person\'s editor can merge, ending in one newline', () => {
  const raw = fs.readFileSync(path.join(ROOT, SETTINGS_FILE), 'utf8');
  assert.ok(raw.endsWith('}\n') && !raw.endsWith('\n\n'));
  assert.doesNotMatch(raw, /\r/);
  assert.doesNotMatch(raw, /\b(opus|sonnet|haiku)\b/i);
});

test('the skill\'s settings step copies that file from the release, never from memory', () => {
  const step = section('Step 4: set up the project');
  assert.ok(step.includes('adapters/copilot/vscode-settings.json'));
  assert.match(step, /release clone|clone/i);
});

// ---- The README ----

const pluginVersion = JSON.parse(read('.claude-plugin/plugin.json')).version;
const REQUEST_LINE = `Set up Wheelhouse from ${REPO_URL} at release v${pluginVersion}`;

test('the README gives the one request line', () => {
  const at = readme.indexOf('\n## On GitHub Copilot\n');
  assert.ok(at > 0, 'a section "On GitHub Copilot"');
  const next = readme.indexOf('\n## ', at + 1);
  const text = readme.slice(at, next < 0 ? undefined : next);
  assert.ok(text.includes(REQUEST_LINE), `the line "${REQUEST_LINE}"`);
  assert.equal(readme.split(REQUEST_LINE).length, 2, 'once');
  assert.match(text, /```text\n[^\n]*Set up Wheelhouse from [^\n]*\n```/, 'in a block, ready to paste');
  assert.match(text, /VS Code/);
  assert.match(text, /git/);
  assert.match(text, /Node\.js/);
  assert.match(text, /~\/\.copilot\//);
  assert.match(text, /wheelhouse\/board\.md/);
  assert.match(text, /not for projects with real users|Not for projects with real users/i);
  assert.match(text, /first release|early release/i, 'says plainly that this is an early release');
  assert.match(text, /adapters\/copilot\/skills\/setup-lean\/SKILL\.md/, 'tells the chat where the steps are');
  assert.match(text, /git clone/);
});

test('the request line\'s tag is the plugin\'s version', () => {
  assert.match(pluginVersion, /^\d+\.\d+\.\d+$/);
  const tag = /at release (v[^\s`]+)/.exec(readme)?.[1];
  assert.equal(tag, `v${pluginVersion}`);
});

test('the README keeps its Claude Code install, unchanged in what it says', () => {
  assert.ok(readme.includes('## Install\n'));
  assert.ok(readme.includes('claude plugin install wheelhouse@wheelhouse --scope project'));
  assert.ok(readme.startsWith('<!-- README.md -->\n'));
  assert.doesNotMatch(readme, /\b(enhanced|improved|fixed)\b/i);
});

// ---- No host program ran ----

test('none of gh, glab or copilot ran', () => {
  assert.deepEqual(stand.calls(), []);
});

// Ruling P5-51: the helper's command is the full-path pair the person allows, the same as the Lean playbook's, and
// taking a project off the helper is a card first, as installing it is.
test('the helper\'s section gives its command as the full-path pair, and its removal goes through a card', () => {
  const part = section('Wheelhouse\'s helper, where Node.js runs');
  assert.ok(part.includes('`"<node>" "<root>/scripts/agents/copilot/start-helper.js"`'), 'the full-path pair');
  assert.ok(!part.includes('node "$HOME'), 'not a bare node');
  assert.match(part, /node -p "process\.execPath"/);
  const left = section('What setup leaves behind');
  assert.match(left, /<start> uninstall-plan --remove-state yes\|no/);
  assert.match(left, /<start> uninstall --hash <hash> --remove-state yes\|no/);
  assert.match(left, /git moves back into the folder/);
});
