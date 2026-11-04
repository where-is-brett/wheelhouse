// tests/skills/update-lean.test.js
// Updating Wheelhouse at Lean (update design section 12.1, Part 12): the skill the chat follows. The skill is text, so these
// tests hold what it says, and run its blocks in folders and repositories of the test's own: the releases are local
// repositories, and HOME is a temporary folder, so nothing touches the real ~/.copilot and no network is used.
import '../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../helpers/homes.js';
import { buildHome, checkHome } from '../../scripts/agents/copilot/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
const skill = read('adapters/copilot/skills/update-lean/SKILL.md');
const kit = buildHome({ root: ROOT });
const REPO_URL = 'https://github.com/where-is-brett/wheelhouse';
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
const blocks = (text) => [...text.matchAll(/^```([a-z]*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2] }));
function block(marker, lang = 'sh') {
  const found = blocks(skill).filter((b) => b.lang === lang && b.body.split('\n')[0] === `# ${marker}`);
  assert.equal(found.length, 1, `one ${lang} block marked "# ${marker}"`);
  return found[0].body;
}
const sh = (script, { cwd, home }) => spawnSync('sh', ['-c', script], { cwd, env: GIT_ENV(home), encoding: 'utf8' });

// A release of the test's own: the kit as it is on disk, in a repository with the tags given.
function makeRelease(tags, mutate) {
  const dir = tempFolder('wh-update-release-');
  fs.cpSync(path.join(ROOT, 'adapters/copilot/home'), path.join(dir, 'adapters/copilot/home'), { recursive: true });
  mutate?.(dir);
  const home = tempFolder('wh-update-release-home-');
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: GIT_ENV(home), encoding: 'utf8' });
  git('init', '-b', 'main');
  git('add', '-A');
  git('commit', '-m', 'Release');
  for (const tag of tags) git('tag', tag);
  return dir;
}
const withRelease = (text, release) => text.replace(`${REPO_URL}.git`, `file://${release}`);

// ---- The skill itself ----

test('the skill has front matter, then its path comment, and is named update-lean', () => {
  assert.match(skill, /^---\nname: update-lean\ndescription: [^\n]+\n---\n<!-- adapters\/copilot\/skills\/update-lean\/SKILL\.md -->\n/);
});

test('the kit holds the skill as wheelhouse-update, and the committed kit is current', () => {
  const text = kit.get('skills/wheelhouse-update/SKILL.md');
  assert.ok(text, 'the kit has wheelhouse-update');
  assert.match(text, /^---\nname: "wheelhouse-update"\n/);
  assert.ok(kit.get('MANIFEST.txt').includes(' skills/wheelhouse-update/SKILL.md\n'), 'the manifest lists it');
  assert.deepEqual(checkHome({ root: ROOT }), [], 'run npm run copilot-home if this fails');
  assert.ok(fs.existsSync(path.join(ROOT, 'adapters/copilot/home/skills/wheelhouse-update/SKILL.md')));
});

test('every step that runs a command has a Mac block and a PowerShell block', () => {
  for (const marker of ['find-latest', 'clone-release', 'check-and-copy', 'find-old-release']) {
    assert.ok(block(marker, 'sh'), `${marker} for a Mac`);
    assert.ok(block(marker, 'powershell'), `${marker} for Windows`);
  }
  assert.equal(blocks(skill).length, 8);
});

test('the skill follows the six steps of the design, in order', () => {
  const headings = skill.split('\n').filter((l) => l.startsWith('## Step '));
  assert.deepEqual(headings.map((h) => h.replace(/:.*/, '')), ['## Step 1', '## Step 2', '## Step 3', '## Step 4', '## Step 5', '## Step 6']);
});

test('it checks every file before replacing any, keeps the previous release, and leaves the project to Lean\'s change and the click', () => {
  assert.match(skill, /Every file is checked before anything is replaced/);
  assert.match(skill, /git hash-object/);
  assert.match(skill, /MANIFEST\.txt/);
  assert.match(skill, /Leave `~\/\.copilot\/wheelhouse\/<old>\/` where it is, untouched, until the next update/);
  assert.match(skill, /Never remove `<old>` yourself/);
  assert.match(skill, /follow `wheelhouse-lean` for it/);
  assert.match(skill, /the director's click on its card is the approval/);
  assert.match(skill, /reload VS Code's window/i);
});

test('it installs nothing, pushes nothing and never uses gh or glab', () => {
  assert.match(skill, /\*\*You never:\*\* install anything/);
  for (const b of blocks(skill)) assert.doesNotMatch(b.body, /\b(gh|glab|npm|brew|winget|push)\b/, b.body.split('\n')[0]);
});

test('the skill holds no model name and no private project', () => {
  assert.doesNotMatch(skill, /claude|opus|sonnet|haiku|gpt/i);
});

// ---- The blocks, run ----

test('find-latest prints the highest plain release and ignores a labelled one', { skip: !unix && 'a shell script' }, () => {
  const release = makeRelease(['v0.2.9', 'v0.10.0', 'v0.3.1', 'v0.11.0-rc1']);
  const home = tempFolder('wh-update-home-');
  fs.mkdirSync(path.join(home, '.copilot', 'wheelhouse', 'v0.2.9'), { recursive: true });
  const result = sh(withRelease(block('find-latest'), release), { cwd: release, home });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), ['v0.10.0', 'On this computer:', 'v0.2.9']);
});

test('clone-release clones the tag beside the old one, and stops when the folder is not that release', { skip: !unix && 'a shell script' }, () => {
  const release = makeRelease(['v0.3.0']);
  const home = tempFolder('wh-update-home-');
  fs.mkdirSync(path.join(home, '.copilot', 'wheelhouse', 'v0.2.9'), { recursive: true });
  const run = (tag) => sh(withRelease(block('clone-release'), release).replaceAll('<tag>', tag), { cwd: release, home });
  const ok = run('v0.3.0');
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(fs.existsSync(path.join(home, '.copilot/wheelhouse/v0.3.0/adapters/copilot/home/MANIFEST.txt')));
  assert.ok(fs.existsSync(path.join(home, '.copilot/wheelhouse/v0.2.9')), 'the old release is untouched');
  const missing = run('v9.9.9');
  assert.notEqual(missing.status, 0, 'a tag that is not there stops');
});

// A clone of the release already in place under HOME, as clone-release leaves it.
function placed(tag, mutate) {
  const release = makeRelease([tag], mutate);
  const home = tempFolder('wh-update-home-');
  const dest = path.join(home, '.copilot', 'wheelhouse', tag);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync('git', ['clone', '--depth', '1', '--branch', tag, `file://${release}`, dest], { env: GIT_ENV(home), stdio: 'ignore' });
  return { home, release };
}

test('check-and-copy puts every file in ~/.copilot, each matching its fingerprint', { skip: !unix && 'a shell script' }, () => {
  const { home, release } = placed('v0.3.0');
  const result = sh(block('check-and-copy').replaceAll('<tag>', 'v0.3.0'), { cwd: release, home });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Every file matches MANIFEST\.txt/);
  for (const file of kit.keys()) {
    if (file === 'MANIFEST.txt' || file.startsWith('hooks/')) continue;
    assert.ok(fs.existsSync(path.join(home, '.copilot', file)), file);
  }
  assert.ok(!fs.existsSync(path.join(home, '.copilot/hooks')), 'no hooks where no guard is in place');
});

test('check-and-copy copies the hooks only where the shell guard is already in place', { skip: !unix && 'a shell script' }, () => {
  const { home, release } = placed('v0.3.0');
  fs.mkdirSync(path.join(home, '.copilot/hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.copilot/hooks/wheelhouse-lean-guard.sh'), 'old guard\n');
  const result = sh(block('check-and-copy').replaceAll('<tag>', 'v0.3.0'), { cwd: release, home });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(home, '.copilot/hooks/wheelhouse-lean-guard.sh'), 'utf8'), kit.get('hooks/wheelhouse-lean-guard.sh'));
  assert.ok(fs.existsSync(path.join(home, '.copilot/hooks/wheelhouse.json')));
});

test('check-and-copy: one file that does not match stops it before anything is replaced', { skip: !unix && 'a shell script' }, () => {
  const { home, release } = placed('v0.3.0', (dir) => {
    fs.appendFileSync(path.join(dir, 'adapters/copilot/home/skills/wheelhouse-update/SKILL.md'), 'changed\n');
  });
  // an old kit already in place, which must stay as it was
  const target = path.join(home, '.copilot/skills/wheelhouse-board/SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'old board skill\n');
  const result = sh(block('check-and-copy').replaceAll('<tag>', 'v0.3.0'), { cwd: release, home });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Does not match MANIFEST\.txt: skills\/wheelhouse-update\/SKILL\.md/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old board skill\n', 'the old kit is as it was');
  assert.ok(!fs.existsSync(path.join(home, '.copilot/skills/wheelhouse-update')), 'nothing was copied');
});

test('find-old-release finds the files that name the old folder, and nothing else', { skip: !unix && 'a shell script' }, () => {
  const home = tempFolder('wh-update-home-');
  const project = path.join(tempFolder('wh-update-project-'), 'orders');
  fs.mkdirSync(path.join(project, '.vscode'), { recursive: true });
  fs.mkdirSync(path.join(project, 'wheelhouse'), { recursive: true });
  fs.writeFileSync(path.join(project, '.vscode/settings.json'), '{ "x": "/h/.copilot/wheelhouse/v0.2.9/y" }\n');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'nothing here\n');
  fs.writeFileSync(path.join(project, 'wheelhouse/board.md'), 'start "/h/.copilot/wheelhouse/v0.2.9/s.js"\n');
  const git = (...args) => execFileSync('git', args, { cwd: project, env: GIT_ENV(home), encoding: 'utf8' });
  git('init', '-b', 'main');
  git('add', '.vscode', 'AGENTS.md');
  git('commit', '-m', 'Start');
  const lines = (tag) => sh(block('find-old-release').replaceAll('<old>', tag), { cwd: project, home }).stdout.trim().split('\n').filter(Boolean);
  const found = lines('v0.2.9');
  assert.equal(found.length, 2);
  assert.match(found[0], /^\.vscode\/settings\.json:1:/);
  assert.match(found[1], /^wheelhouse\/board\.md:1:/);
  assert.deepEqual(lines('v0.1.0'), []);
});
