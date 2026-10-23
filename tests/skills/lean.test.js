// tests/skills/lean.test.js
// Lean's playbook (design section 6.4, Part 4 Task 3): the record, the board, building, merging, undo and the copy, with
// git alone. The playbook is text the chat follows, so these tests hold what it says: the record line for each kind,
// the git commands as the brief gives them (and that they work, in a repository of the test's own), the safety lines the
// board starts with, and that the kit built from it names neither a Claude Code tool nor, in its source, Copilot.
import '../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../helpers/host-stand-ins.js';
import { tempFolder } from '../helpers/homes.js';
import safetyLine from '../../adapters/copilot/safety-line.js';
import { buildHome } from '../../scripts/agents/copilot/home.js';
import { AGENT_CONTROL } from '../../scripts/lib/agent-control.js';
import { BOARD_FILE, LEAN_RECORD_DIR, PROOFS, REVIEW_KINDS } from '../../scripts/lib/copilot-numbers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
const playbook = read('adapters/copilot/skills/lean/SKILL.md');
const kit = buildHome({ root: ROOT });
const leanKit = kit.get('skills/wheelhouse-lean/SKILL.md');

// Stand-ins for gh, glab and copilot come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

const KINDS = ['card', 'approval', 'review', 'merge', 'undo', 'stop', 'lift-stop', 'copy'];
const KEYS = ['at', 'kind', 'card', 'choice', 'commit', 'proof', 'by', 'tier'];
const FRONT_DESK_LINE = 'At Lean, follow wheelhouse-lean for the record, the board, building and merging';
const CLAUDE_CODE_TOOL_WORDS = /\b(Write|Read|Edit|Bash) tool\b|Claude Code/;
const TOOL_NAMES = ['AskUserQuestion', 'PushNotification', 'ToolSearch', 'SendMessage', 'CLAUDE_PLUGIN_ROOT', 'TodoWrite', 'WebFetch', 'WebSearch', 'NotebookRead'];

// The record lines the playbook gives, one JSON object a line, as the example for each kind.
function exampleLines() {
  return playbook.split('\n').filter((line) => line.startsWith('{"at"'));
}

// The playbook's section named heading, up to the next `##` heading, leaving out the fenced examples (the board's own headings are in them).
function section(text, heading) {
  text = text.replace(/^```[\s\S]*?^```$/gm, '');
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `a section "${heading}"`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

// ---- The playbook itself ----

test('no skill under skills/ is Copilot-only: Lean\'s playbooks sit beside the adapter, so Claude Code\'s plugin never loads them', () => {
  const names = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.ok(names.includes('front-desk'), 'the folder read is the plugin\'s skills');
  assert.ok(!names.includes('lean') && !names.includes('setup-lean'), `skills/ holds ${names.join(', ')}`);
  for (const name of names) assert.doesNotMatch(read(`skills/${name}/SKILL.md`).split('\n').slice(0, 5).join('\n'), /^name: (lean|setup-lean)$/m, name);
  assert.ok(fs.existsSync(path.join(ROOT, 'adapters', 'copilot', 'skills', 'lean', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(ROOT, 'adapters', 'copilot', 'skills', 'setup-lean', 'SKILL.md')));
});

test('the playbook has front matter, then its path comment, and is named lean', () => {
  assert.match(playbook, /^---\nname: lean\ndescription: [^\n]+\n---\n<!-- adapters\/copilot\/skills\/lean\/SKILL\.md -->\n/);
  assert.ok(playbook.split('\n')[2].length < 1100);
});

test('Claude Code\'s front desk does not mention Lean or wheelhouse-lean', () => {
  const frontDesk = read('skills/front-desk/SKILL.md');
  assert.doesNotMatch(frontDesk, /wheelhouse-lean/);
  assert.doesNotMatch(frontDesk, /\bLean\b/);
});

test('the kit\'s front desk sends a Lean session to wheelhouse-lean, near its top', () => {
  const frontDesk = kit.get('skills/wheelhouse-front-desk/SKILL.md');
  const at = frontDesk.indexOf(FRONT_DESK_LINE);
  assert.ok(at > 0, 'the line is in the kit\'s front desk');
  assert.ok(at < frontDesk.indexOf('## The command'), 'before the steps that need Node.js');
  assert.equal(frontDesk.split(FRONT_DESK_LINE).length, 2, 'once');
});

// ---- The record ----

test('the record line for each kind has every field', () => {
  const lines = exampleLines();
  assert.equal(lines.length, KINDS.length, 'one example a kind');
  const seen = [];
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.deepEqual(Object.keys(entry), KEYS, `${line}: all eight keys, in order`);
    seen.push(entry.kind);
    assert.match(entry.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, 'UTC ISO 8601');
    for (const key of ['at', 'kind', 'proof', 'by', 'tier']) assert.notEqual(entry[key], null, `${entry.kind}: ${key} is never null`);
    assert.ok(typeof entry.card === 'string' || entry.card === null);
    assert.ok(typeof entry.choice === 'string' || entry.choice === null);
    assert.ok(entry.commit === null || /^[0-9a-f]{12}$/.test(entry.commit), `${entry.kind}: a commit is 12 lowercase hex characters`);
    assert.equal(entry.by, 'chat');
    assert.equal(entry.tier, 'lean');
    // A click's proof is one of the design's PROOFS; a review is not a click, and its proof is the chat review that REVIEW_KINDS names.
    assert.ok(entry.kind === 'review' ? REVIEW_KINDS.includes(entry.proof) : PROOFS.includes(entry.proof));
    assert.equal(entry.proof, entry.kind === 'review' ? 'chat-review' : 'chat-click', `${entry.kind}'s proof`);
  }
  assert.deepEqual([...seen].sort(), [...KINDS].sort(), 'every kind once');
  // The ones that name a commit say which.
  const byKind = Object.fromEntries(lines.map((l) => JSON.parse(l)).map((e) => [e.kind, e]));
  for (const kind of ['approval', 'review', 'merge', 'undo']) assert.ok(byKind[kind].commit, `${kind} names a commit`);
  assert.equal(byKind.approval.choice, 'Approve');
  assert.equal(byKind.approval.card, byKind.merge.card);
  assert.equal(byKind.review.commit, byKind.approval.commit, 'the review and the approval name the same head');
  assert.notEqual(byKind.merge.commit, byKind.approval.commit, 'the merge is its own commit');
});

test('the record is one file a day in the record folder, written on the main version only', () => {
  const record = section(playbook, 'The record');
  assert.ok(record.includes(`${LEAN_RECORD_DIR}/YYYY-MM-DD.jsonl`));
  assert.match(record, /one JSON line/i);
  assert.match(record, /UTC/);
  assert.match(record, /main version is checked out/i);
  assert.match(record, /git rev-parse --short=12/);
  for (const kind of KINDS) assert.ok(record.includes(`\`${kind}\``), `the kind ${kind} is explained`);
});

// ---- The git steps ----

test('merging uses --no-ff and undo uses revert -m 1', () => {
  assert.ok(playbook.includes('git merge --no-ff feature/<slug> -m "<title> (approved <12-character commit>)"'));
  assert.ok(playbook.includes('git revert -m 1 <merge>'));
  assert.ok(playbook.includes('git switch -c feature/<slug>'));
  assert.doesNotMatch(playbook, /git push [^\n]*--force|git reset --hard|git branch -D\b/, 'nothing that rewrites or discards history');
  assert.doesNotMatch(playbook, /git merge (?!--no-ff|--abort)[^\n]*feature/, 'every merge is --no-ff');
});

test('the copy push names wheelhouse-copy', () => {
  assert.ok(playbook.includes('git push wheelhouse-copy main'));
  const copy = section(playbook, 'The copy');
  assert.match(copy, /git init --bare/);
  assert.match(copy, /setup/i);
  assert.match(copy, /fails?/i);
  assert.match(copy, /work is not lost/i);
});

test('the git steps work as written, in a repository of the test\'s own', () => {
  const dir = tempFolder('wh-lean-git-');
  const copy = path.join(tempFolder('wh-lean-copy-'), 'copy.git');
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'none'), GIT_CONFIG_SYSTEM: path.join(dir, 'none'), GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const git = (...args) => execFileSync('git', args, { cwd: project, env, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  fs.mkdirSync(copy, { recursive: true });
  execFileSync('git', ['init', '--bare', copy], { env, encoding: 'utf8' });
  git('remote', 'add', 'wheelhouse-copy', copy);
  fs.writeFileSync(path.join(project, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-m', 'Start');
  // Building: a feature branch, one commit.
  git('switch', '-c', 'feature/export-orders');
  fs.writeFileSync(path.join(project, 'b.txt'), 'two\n');
  git('add', 'b.txt');
  git('commit', '-m', 'Add the export');
  const approved = git('rev-parse', '--short=12', 'feature/export-orders');
  assert.match(approved, /^[0-9a-f]{12}$/);
  // Merging: on main, with a merge commit, the message naming the approved head.
  git('switch', 'main');
  git('merge', '--no-ff', 'feature/export-orders', '-m', `Export orders (approved ${approved})`);
  const merge = git('rev-parse', '--short=12', 'HEAD');
  assert.equal(git('rev-parse', '--short=12', 'HEAD^2'), approved, 'the merge added the approved head (the playbook checks HEAD^2)');
  assert.equal(git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'a merge commit has two parents');
  assert.match(git('log', '-1', '--format=%s'), new RegExp(`\\(approved ${approved}\\)$`));
  // The record: a line appended on main, committed alone.
  const day = '2026-10-23';
  fs.mkdirSync(path.join(project, LEAN_RECORD_DIR), { recursive: true });
  const recordFile = path.join(project, LEAN_RECORD_DIR, `${day}.jsonl`);
  fs.appendFileSync(recordFile, `${JSON.stringify({ at: '2026-10-23T01:20:41Z', kind: 'merge', card: 'merge-export-orders', choice: null, commit: merge, proof: 'chat-click', by: 'chat', tier: 'lean' })}\n`);
  git('add', `${LEAN_RECORD_DIR}/${day}.jsonl`);
  git('commit', '-m', 'Record: merge export-orders');
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n'), [`${LEAN_RECORD_DIR}/${day}.jsonl`]);
  // The copy.
  git('push', 'wheelhouse-copy', 'main');
  assert.equal(execFileSync('git', ['rev-parse', 'main'], { cwd: copy, env, encoding: 'utf8' }).trim(), git('rev-parse', 'main'));
  // Undo: a new commit that reverses the merge; the record's later lines stay.
  git('revert', '-m', '1', merge, '--no-edit');
  assert.ok(!fs.existsSync(path.join(project, 'b.txt')), 'the feature is gone');
  assert.ok(fs.existsSync(recordFile), 'the record stays');
  git('push', 'wheelhouse-copy', 'main');
  assert.equal(execFileSync('git', ['rev-parse', 'main'], { cwd: copy, env, encoding: 'utf8' }).trim(), git('rev-parse', 'main'));
});


// ---- What a feature may carry, and where the folder stays ----

// A repository of the test's own, with git's identity set by the environment and nothing read from the real home.
function repo(name) {
  const dir = tempFolder(`wh-lean-${name}-`);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'none'), GIT_CONFIG_SYSTEM: path.join(dir, 'none'), GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const run = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const make = (rel, ...args) => {
    const cwd = path.join(dir, rel);
    fs.mkdirSync(cwd, { recursive: true });
    return { cwd, git: (...more) => run(cwd, ...args, ...more) };
  };
  return { dir, env, run, make };
}
const commitFile = (r, cwd, file, text, message) => {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), text);
  r.run(cwd, 'add', file);
  r.run(cwd, 'commit', '-m', message);
};

test('a feature is in hand from the branch until the director says it is built, and the chat never switches meanwhile', () => {
  const record = section(playbook, 'The record');
  assert.match(record, /A feature is in hand\*\* from `git switch -c feature\/<slug>`/);
  assert.match(record, /never switch branches, whether the folder looks clean or not/);
  assert.match(record, /shares this folder/);
  assert.match(record, /no feature is in hand/);
  assert.match(record, /Waiting to be recorded/);
  assert.match(record, /own `at` date/);
  // Every line that switches to the main version says why it may: a branch is made at once, the review was clean, the feature was set aside, or it is waiting on the code host.
  const switches = playbook.split('\n').filter((l) => l.includes('git switch main'));
  assert.ok(switches.length >= 3);
  for (const line of switches) assert.match(line, /git switch -c|CLEAN|\*\*Not now\*\*|git fetch origin|origin\/main/, `a switch to main without a reason: ${line}`);
  const reviewing = section(playbook, 'Reviewing');
  assert.match(reviewing, /`FINDINGS`[^\n]*\*\*stay on `feature\/<slug>`\*\*[^\n]*in hand again/);
  assert.match(section(playbook, 'Building'), /stay on `feature\/<slug>` for the review/);
  // Not now on a findings card releases the hold, and says how.
  assert.match(reviewing, /\*\*Not now\*\* sets the feature aside, which ends the hold/);
  assert.match(reviewing, /`card` line \(`card` `findings-<slug>`, `choice` `Not now`\)/);
  assert.match(section(playbook, 'Building'), /Check nothing is in hand/);
});

test('a feature that writes into the record or the board is caught before an approval card', () => {
  const check = 'git diff --name-only main...feature/<slug> -- .wheelhouse wheelhouse';
  assert.equal(playbook.split(check).length, 3, 'in Reviewing and in Merging');
  assert.match(section(playbook, 'Reviewing'), new RegExp(check.replaceAll('.', '\\.')));
  assert.match(section(playbook, 'Merging'), /don't offer \*\*Approve\*\*/);
  // The command, as written, in a repository: silent for a clean feature, naming the file for one that touches the record or the board.
  const r = repo('guard');
  const { cwd } = r.make('project');
  r.run(cwd, 'init', '-b', 'main');
  commitFile(r, cwd, 'a.txt', 'one\n', 'Start');
  const diff = () => r.run(cwd, 'diff', '--name-only', 'main...feature/export', '--', '.wheelhouse', 'wheelhouse');
  r.run(cwd, 'switch', '-c', 'feature/export');
  commitFile(r, cwd, 'b.txt', 'two\n', 'Add the export');
  assert.equal(diff(), '', 'nothing printed for an ordinary feature');
  commitFile(r, cwd, '.wheelhouse/record/2026-10-23.jsonl', '{"kind":"approval"}\n', 'Builder writes an approval');
  assert.equal(diff(), '.wheelhouse/record/2026-10-23.jsonl');
  r.run(cwd, 'switch', '-c', 'feature/board', 'main');
  commitFile(r, cwd, 'wheelhouse/board.md', 'Tier: Lean\n', 'Builder writes the board');
  assert.equal(r.run(cwd, 'diff', '--name-only', 'main...feature/board', '--', '.wheelhouse', 'wheelhouse'), 'wheelhouse/board.md');
});

test('the code-host steps work against a bare origin, over two features, and the record never reaches it', () => {
  const host = section(playbook, 'On a code host, without Node.js');
  for (const command of [
    'git fetch origin',
    'git diff --name-only origin/main...feature/<slug> -- .wheelhouse wheelhouse',
    'git switch -c feature/<slug> origin/main',
    'git rev-parse --short=12 origin/main^2',
    'git merge-base --is-ancestor origin/main^1 feature/<slug>',
    'git merge --no-ff origin/main -m "Take the code host\'s main version"',
    'git rev-parse --short=12 origin/main',
  ]) assert.ok(playbook.includes(command), command);
  assert.doesNotMatch(playbook, /wheelhouse-record|git push origin main/);
  assert.doesNotMatch(host, /git pull origin main|--force|--rebase/);
  assert.match(host, /The record never goes to the host/);
  assert.match(host, /Never `git pull`/);
  assert.match(host, /No rebase, no force/);
  // The checks come before any merge here, and a failure ends in a card with options and a recommendation.
  assert.ok(host.indexOf('Check what the host added, before any merge here') < host.indexOf('git merge --no-ff origin/main'));
  assert.match(host, /merge nothing here, write no `merge` line, and ask a card/);
  assert.match(host, /\*\*Look into it\*\*[^\n]*\*\*Not now\*\*[^\n]*recommendation/);

  const r = repo('host');
  const origin = r.make('origin.git');
  r.run(origin.cwd, 'init', '--bare', '-b', 'main');
  r.run(origin.cwd, 'config', 'receive.advertisePushOptions', 'true');
  const copy = r.make('copy.git');
  r.run(copy.cwd, 'init', '--bare', '-b', 'main');
  const { cwd: mine } = r.make('mine');
  r.run(mine, 'init', '-b', 'main');
  r.run(mine, 'remote', 'add', 'origin', origin.cwd);
  r.run(mine, 'remote', 'add', 'wheelhouse-copy', copy.cwd);
  commitFile(r, mine, 'a.txt', 'one\n', 'Start');
  r.run(mine, 'push', 'origin', 'main');
  const { cwd: hostSide } = r.make('host-side');
  r.run(hostSide, 'init', '-b', 'main');
  r.run(hostSide, 'remote', 'add', 'origin', origin.cwd);
  r.run(hostSide, 'fetch', 'origin');
  r.run(hostSide, 'switch', '-c', 'main', 'origin/main');
  const status = (cwd, ...args) => spawnSync('git', args, { cwd, env: r.env, encoding: 'utf8' });
  const recordFile = `${LEAN_RECORD_DIR}/2026-10-23.jsonl`;
  const onOrigin = () => r.run(origin.cwd, 'ls-tree', '-r', '--name-only', 'main').split('\n');

  // One round of the playbook's flow for a feature; returns what the checks gave.
  function round(slug, file, { hostMerges }) {
    r.run(mine, 'fetch', 'origin');
    r.run(mine, 'switch', 'main');
    r.run(mine, 'switch', '-c', `feature/${slug}`, 'origin/main');
    commitFile(r, mine, file, 'x\n', `Add ${slug}`);
    assert.equal(r.run(mine, 'diff', '--name-only', `origin/main...feature/${slug}`, '--', '.wheelhouse', 'wheelhouse'), '', `${slug}: the feature carries no record`);
    const approved = r.run(mine, 'rev-parse', '--short=12', `feature/${slug}`);
    r.run(mine, 'switch', 'main');
    fs.mkdirSync(path.join(mine, LEAN_RECORD_DIR), { recursive: true });
    fs.appendFileSync(path.join(mine, recordFile), `${JSON.stringify({ kind: 'approval', card: slug })}\n`);
    r.run(mine, 'add', recordFile);
    r.run(mine, 'commit', '-m', `Record: approval ${slug}`);
    r.run(mine, 'push', '-o', 'merge_request.create', '-o', 'merge_request.target=main', '-o', 'merge_request.remove_source_branch', 'origin', `feature/${slug}`);
    hostMerges(slug);
    r.run(mine, 'fetch', 'origin');
    return {
      approved,
      second: status(mine, 'rev-parse', '--short=12', 'origin/main^2'),
      based: status(mine, 'merge-base', '--is-ancestor', 'origin/main^1', `feature/${slug}`),
    };
  }
  const merged = (slug) => {
    r.run(hostSide, 'fetch', 'origin');
    r.run(hostSide, 'merge', '--no-ff', `origin/feature/${slug}`, '-m', `Merge request for ${slug}`);
    r.run(hostSide, 'push', 'origin', 'main');
  };

  // Round one and round two: both merge as approved, and the host's version never holds the record.
  for (const [slug, file] of [['export', 'b.txt'], ['import', 'c.txt']]) {
    const got = round(slug, file, { hostMerges: merged });
    assert.equal(got.second.stdout.trim(), got.approved, `${slug}: the host added the approved head`);
    assert.equal(got.based.status, 0, `${slug}: the host's version hadn't moved past the branch point`);
    assert.notEqual(r.run(mine, 'rev-parse', 'main'), r.run(mine, 'rev-parse', 'origin/main'), 'local main has diverged: no pull');
    r.run(mine, 'switch', 'main');
    r.run(mine, 'merge', '--no-ff', 'origin/main', '-m', 'Take the code host\'s main version');
    const hostMerge = r.run(mine, 'rev-parse', '--short=12', 'origin/main');
    assert.notEqual(hostMerge, r.run(mine, 'rev-parse', '--short=12', 'HEAD'), 'the merge line takes the host\'s merge, not the local one');
    fs.appendFileSync(path.join(mine, recordFile), `${JSON.stringify({ kind: 'merge', commit: hostMerge })}\n`);
    r.run(mine, 'add', recordFile);
    r.run(mine, 'commit', '-m', `Record: merge ${slug}`);
    r.run(mine, 'push', 'wheelhouse-copy', 'main');
    assert.equal(r.run(copy.cwd, 'rev-parse', 'main'), r.run(mine, 'rev-parse', 'HEAD'));
    assert.ok(!onOrigin().some((f) => f.startsWith('.wheelhouse/')), `${slug}: origin's main version holds no record`);
    assert.ok(onOrigin().includes(file));
  }
  assert.deepEqual(r.run(origin.cwd, 'branch', '--list').split('\n').map((s) => s.trim().replace(/^\* /, '')), ['feature/export', 'feature/import', 'main'], 'the record went up on no branch of its own');

  // The counterfactual: a feature branched from the local main version carries the record into its request.
  r.run(mine, 'switch', '-c', 'feature/leak', 'main');
  commitFile(r, mine, 'd.txt', 'x\n', 'Add leak');
  assert.match(r.run(mine, 'diff', '--name-only', 'origin/main...feature/leak', '--', '.wheelhouse', 'wheelhouse'), /\.wheelhouse\/record\//);
  r.run(mine, 'switch', 'main');

  // The host squashes: there is no second parent, and the check fails before anything is merged here.
  const squashed = round('squash', 'e.txt', {
    hostMerges: (slug) => {
      r.run(hostSide, 'fetch', 'origin');
      r.run(hostSide, 'merge', '--squash', `origin/feature/${slug}`);
      r.run(hostSide, 'commit', '-m', `Squashed ${slug}`);
      r.run(hostSide, 'push', 'origin', 'main');
    },
  });
  assert.notEqual(squashed.second.status, 0, 'no second parent to name the approved head');
  assert.notEqual(status(mine, 'merge-base', '--is-ancestor', 'origin/main', 'main').status, 0, 'nothing of the host\'s was merged here');

  // The host's version moves past the branch point before the request merges: the second check fails.
  const moved = round('moved', 'f.txt', {
    hostMerges: (slug) => {
      r.run(hostSide, 'fetch', 'origin');
      r.run(hostSide, 'merge', '--ff-only', 'origin/main');
      commitFile(r, hostSide, 'other.txt', 'someone else\n', 'Someone else\'s change');
      r.run(hostSide, 'merge', '--no-ff', `origin/feature/${slug}`, '-m', `Merge request for ${slug}`);
      r.run(hostSide, 'push', 'origin', 'main');
    },
  });
  assert.equal(moved.second.stdout.trim(), moved.approved, 'the approved head was added');
  assert.notEqual(moved.based.status, 0, 'but the host\'s version had moved past the branch point');
  assert.ok(!onOrigin().some((f) => f.startsWith('.wheelhouse/')));
});

// ---- The final review's fixes (rulings P4-30 and P4-31) ----

const SETTINGS = JSON.parse(read('adapters/copilot/vscode-settings.json'));
// The command the playbook gives between backticks, found by its beginning.
function command(start) {
  const found = [...playbook.matchAll(/`(git [^`\n]+)`/g)].map((m) => m[1]).filter((c) => c.startsWith(start));
  assert.equal(found.length, 1, `one command starting "${start}", found ${found.length}`);
  return found[0];
}
const sh = (cwd, env, script) => spawnSync('sh', ['-c', script], { cwd, env, encoding: 'utf8' });
const recordLine = (kind, extra = {}) => `${JSON.stringify({ at: '2026-10-23T01:00:00Z', kind, card: null, choice: null, commit: null, proof: kind === 'review' ? 'chat-review' : 'chat-click', by: 'chat', tier: 'lean', ...extra })}\n`;

test('the board chooses its block by whether the helper is installed and answering, never by Node.js alone', () => {
  const board = section(playbook, 'The board');
  assert.match(board, /whether Wheelhouse's own helper is installed here and answering/);
  assert.doesNotMatch(playbook, /Node\.js may run/, 'the rule no longer keys off Node.js');
  assert.match(board, /Having Node\.js on the computer doesn't count/);
  assert.match(board, /not used until the helper exists/);
  assert.match(board, /never switch a board to the third block because `node --version` printed a version/);
  assert.ok(playbook.includes('On a Mac or Windows where Wheelhouse\'s helper is installed and answering (not used until the helper exists):'));
  // The third block is the helper's: its guard lines are the ones safetyLine gives where Node.js runs, and it is last.
  const blocks = [...playbook.matchAll(/^```\nTier: Lean\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0], /No Wheelhouse guards run on this computer yet/);
  assert.match(blocks[1], /No Wheelhouse guards run on Windows without Node\.js/);
  assert.match(blocks[2], /STOP is enforced by Wheelhouse's guards/);
  assert.match(playbook, /\| "Node\.js is here, so the board can show the helper's lines" \|/);
});

test('the board is a view: STOP comes from the last committed stop or lift-stop line on the main version', () => {
  const stop = section(playbook, 'STOP');
  assert.match(stop, /The record says, not the board/);
  assert.match(stop, /the last one decides/);
  assert.match(stop, /the board and the record disagree, follow the record/);
  assert.match(section(playbook, 'The board'), /The board is a view, not state/);
  assert.match(section(playbook, 'The board'), /follow the record/);
  // The command, as written, in a repository: a builder's edit to the board (ignored, so not in git) and a lift-stop on a feature's branch change nothing.
  const grep = command('git grep -h -e stop main');
  const r = repo('stop');
  const { cwd } = r.make('project');
  r.run(cwd, 'init', '-b', 'main');
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'wheelhouse/\n');
  r.run(cwd, 'add', '.gitignore');
  r.run(cwd, 'commit', '-m', 'Start');
  const day = (d) => path.join(cwd, LEAN_RECORD_DIR, `${d}.jsonl`);
  fs.mkdirSync(path.join(cwd, LEAN_RECORD_DIR), { recursive: true });
  const decide = () => {
    const out = sh(cwd, r.env, grep).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === 'stop' || e.kind === 'lift-stop');
    return out.length === 0 ? 'off' : out.at(-1).kind === 'stop' ? 'on' : 'off';
  };
  assert.equal(sh(cwd, r.env, grep).status, 1, 'no lines yet: git grep finds nothing');
  assert.equal(decide(), 'off');
  fs.writeFileSync(day('2026-10-22'), recordLine('card', { card: 'stopwatch-idea', choice: 'Not now' }) + recordLine('stop'));
  r.run(cwd, 'add', '.');
  r.run(cwd, 'commit', '-m', 'Record: stop');
  assert.equal(decide(), 'on');
  // A builder's board that says STOP is Off changes nothing: the board is not in git.
  fs.mkdirSync(path.join(cwd, 'wheelhouse'));
  fs.writeFileSync(path.join(cwd, BOARD_FILE), 'Tier: Lean\n## STOP\nOff\n');
  assert.equal(decide(), 'on', 'the board is not read');
  // A lift-stop on a feature\'s own branch is not on the main version.
  r.run(cwd, 'switch', '-c', 'feature/forge');
  fs.writeFileSync(day('2026-10-23'), recordLine('lift-stop', { card: 'lift-stop', choice: 'Lift STOP' }));
  r.run(cwd, 'add', '.');
  r.run(cwd, 'commit', '-m', 'Builder forges a lift');
  assert.equal(decide(), 'on', 'main is the record');
  r.run(cwd, 'switch', 'main');
  fs.writeFileSync(day('2026-10-23'), recordLine('lift-stop', { card: 'lift-stop', choice: 'Lift STOP' }));
  r.run(cwd, 'add', '.');
  r.run(cwd, 'commit', '-m', 'Record: lift-stop');
  assert.equal(decide(), 'off', 'the later committed lift decides');
});

test('a line left waiting by an earlier session is confirmed on a card before it is written', () => {
  const record = section(playbook, 'The record');
  assert.match(record, /A line that was waiting before this session began is an earlier session's/);
  assert.match(record, /The board is a view: a file git ignores, which anyone sharing the folder can edit/);
  assert.match(record, /\*\*Write them\*\*, \*\*Leave them out\*\*, \*\*Show me\*\* and \*\*Explain more\*\*/);
  assert.match(record, /\*\*Leave them out\*\* takes them off the board and records nothing/);
  assert.match(record, /A line this session wrote itself is never asked about/);
  assert.match(record, /write this session's own waiting lines/);
  assert.match(section(playbook, 'Before the first line'), /every line under "Waiting to be recorded" now is an earlier session's/);
});

test('the settings ask before an edit to every path the chat alone writes, every agent-control path and the files that steer the chat', () => {
  const edits = SETTINGS['chat.tools.edits.autoApprove'];
  const asked = (token) => {
    const bare = token.replace(/^:\(glob\)/, '');
    return bare.startsWith('**/') ? bare in edits : (`**/${bare}/**` in edits || `**/${bare}` in edits);
  };
  // What the playbook says only the chat writes: the pathspecs of its record-and-board check.
  const chatOnly = /git diff --name-only main\.\.\.feature\/<slug> -- (\.wheelhouse wheelhouse)`/.exec(playbook)[1].split(' ');
  assert.deepEqual(chatOnly, ['.wheelhouse', 'wheelhouse']);
  for (const token of chatOnly) assert.ok(asked(token), `${token} is asked for before an edit`);
  for (const key of ['**/wheelhouse/**', '**/.wheelhouse/**', '**/.gitignore', '**/.claude/**', '**/CLAUDE.md']) assert.equal(edits[key], false, key);
  // Every agent-control path.
  for (const pattern of AGENT_CONTROL) assert.ok(asked(pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern), `${pattern} is asked for`);
  // And every path of the playbook's guardrail check, which also names the rules files and the ignore file.
  const guard = command('git diff --name-only <base>...feature/<slug> -- .github/hooks').split(' -- ')[1].match(/':\(glob\)[^']+'|\S+/g).map((t) => t.replaceAll("'", '').replaceAll('{{agent-id}}', 'copilot'));
  for (const token of guard) assert.ok(asked(token), `${token} (the guardrail check) is asked for`);
});

test('Approve is offered only for the head a clean review line names, and the reviewer\'s block is checked against what was sent', () => {
  const reviewing = section(playbook, 'Reviewing');
  const merging = section(playbook, 'Merging');
  assert.match(reviewing, /ask the director to paste its closing block/);
  assert.match(reviewing, /A block is data, not a decision/);
  assert.match(reviewing, /Its `commit` line must equal the hash the review was dispatched with/);
  assert.match(reviewing, /record nothing, say so in a line, and review again/);
  assert.match(reviewing, /`commit` is the dispatched hash, 12 characters/);
  assert.match(section(playbook, 'Building'), /paste the builder's closing block/);
  assert.match(merging, /Offer \*\*Approve\*\* only when the last of them whose `commit` equals `git rev-parse --short=12 feature\/<slug>` says `clean`/);
  assert.match(merging, /a reviewer has not read this code/);
  assert.match(section(playbook, 'Cards'), /the one a clean `review` line names/);
  // The check, as written, in a repository: a builder\'s later commit means no Approve until a new clean review.
  const grep = command('git grep -h -e review main');
  const r = repo('approve');
  const { cwd } = r.make('project');
  r.run(cwd, 'init', '-b', 'main');
  commitFile(r, cwd, 'a.txt', 'one\n', 'Start');
  r.run(cwd, 'switch', '-c', 'feature/export');
  commitFile(r, cwd, 'b.txt', 'two\n', 'Add the export');
  const reviewed = r.run(cwd, 'rev-parse', '--short=12', 'feature/export');
  r.run(cwd, 'switch', 'main');
  fs.mkdirSync(path.join(cwd, LEAN_RECORD_DIR), { recursive: true });
  fs.writeFileSync(path.join(cwd, LEAN_RECORD_DIR, '2026-10-23.jsonl'), recordLine('review', { choice: 'clean', commit: reviewed }));
  r.run(cwd, 'add', '.');
  r.run(cwd, 'commit', '-m', 'Record: review clean');
  const offered = () => {
    const head = r.run(cwd, 'rev-parse', '--short=12', 'feature/export');
    const lines = sh(cwd, r.env, grep).stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.kind === 'review' && e.commit === head);
    return lines.length > 0 && lines.at(-1).choice === 'clean';
  };
  assert.equal(offered(), true, 'the head is the one a reviewer read');
  r.run(cwd, 'switch', 'feature/export');
  commitFile(r, cwd, 'c.txt', 'three\n', 'The builder commits again after the review');
  r.run(cwd, 'switch', 'main');
  assert.equal(offered(), false, 'new code: no Approve');
  fs.appendFileSync(path.join(cwd, LEAN_RECORD_DIR, '2026-10-23.jsonl'), recordLine('review', { choice: 'findings', commit: r.run(cwd, 'rev-parse', '--short=12', 'feature/export') }));
  r.run(cwd, 'commit', '-am', 'Record: review findings');
  assert.equal(offered(), false, 'a review with findings is not a clean one');
});

test('a change to a file that steers the agents is said plainly on the card, and the reviewer reads the rules from the main version', () => {
  const guard = section(playbook, 'Guardrail changes');
  assert.match(guard, /This change alters what steers the agents or VS Code/);
  assert.match(guard, /`guardrail-<slug>`/);
  assert.match(guard, /The reviewer reads the project's rules from the main version, not from the feature/);
  assert.match(guard, /`git show <base>:<path>`/);
  assert.match(guard, /\.wheelhouse\/feature\/review\/<n>-main\/<path>/);
  assert.match(section(playbook, 'Reviewing'), /read the project's rules from \.wheelhouse\/feature\/review\/1-main\//);
  assert.match(section(playbook, 'Merging'), /\*\*The guardrail check\*\*/);
  // The list is the agent-control list, path for path, in the words git takes.
  const cmd = command('git diff --name-only <base>...feature/<slug> -- .github/hooks');
  const tokens = cmd.split(' -- ')[1].match(/':\(glob\)[^']+'|\S+/g).map((t) => t.replaceAll("'", ''));
  const want = AGENT_CONTROL.map((pattern) => {
    const token = pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern;
    return (token.startsWith('**/') ? `:(glob)${token}` : token).replaceAll('copilot', '{{agent-id}}');
  });
  for (const w of want) assert.ok(tokens.includes(w), `the guardrail check lacks ${w}`);
  for (const extra of ['.gitignore', '.claude', ':(glob)**/CLAUDE.md']) assert.ok(tokens.includes(extra), extra);
  assert.ok(!/copilot/i.test(cmd), 'the source says {{agent-id}}, and the kit fills it');
  assert.ok(leanKit.includes('.github/copilot-instructions.md') && leanKit.includes('com.github.copilot') && !leanKit.includes('{{'));
  // The plan names the step.
  const plan = read('docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md');
  const task3 = plan.slice(plan.indexOf('### Task 3: Lean\'s playbook'), plan.indexOf('### Task 4: Lean\'s record'));
  assert.match(task3, /Guardrail changes \(design section 6\.5\)/);
  // The command, as written (the kit's words), in a repository: nothing for an ordinary feature, the file for each that steers an agent.
  const run = (base, slug) => cmd.replace('{{agent-id}}', 'copilot').replaceAll('{{agent-id}}', 'copilot').replace('<base>', base).replace('<slug>', slug);
  const r = repo('guardrail');
  const { cwd } = r.make('project');
  r.run(cwd, 'init', '-b', 'main');
  commitFile(r, cwd, 'src/a.txt', 'one\n', 'Start');
  const steers = ['.vscode/settings.json', 'packages/app/AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md', '.github/agents/x.agent.md', '.github/copilot/y.md',
    '.github/hooks/z.json', '.github/mcp.json', '.gitignore', '.gitattributes', 'CLAUDE.md', '.claude/settings.json', 'plugin.json', 'com.github.copilot/c.json', '.cursor/rules/r.mdc'];
  const quiet = ['docs/readme.md', '.github/workflows/ci.yml', 'src/vscode-notes.md', 'notes/agents.txt'];
  r.run(cwd, 'switch', '-c', 'feature/ordinary');
  for (const f of quiet) commitFile(r, cwd, f, 'x\n', `Add ${f}`);
  assert.equal(sh(cwd, r.env, run('main', 'ordinary')).stdout, '', 'an ordinary feature prints nothing');
  r.run(cwd, 'switch', '-c', 'feature/steering', 'main');
  for (const f of steers) commitFile(r, cwd, f, 'x\n', `Add ${f}`);
  const got = sh(cwd, r.env, run('main', 'steering'));
  assert.equal(got.status, 0, got.stderr);
  assert.deepEqual(got.stdout.split('\n').filter(Boolean).sort(), [...steers].sort(), 'each file that steers an agent prints');
});

test('on a code host the approved commit is what is pushed, and Undo is the host\'s step, recorded once the host has the revert', () => {
  const host = section(playbook, 'On a code host, without Node.js');
  assert.doesNotMatch(playbook, /remove_source_branch origin feature\/<slug>/, 'the branch as it stands is never pushed');
  assert.match(host, /push exactly the approved commit to the host, never the branch as it stands/);
  assert.match(host, /its first 12 characters must be the approved ones\. If they are not, the head has moved, so write nothing, push nothing and review again/);
  assert.match(host, /\*\*Undo on a code host is the host's step\.\*\*/);
  assert.match(host, /Write no `undo` line yet/);
  assert.match(host, /Only when both hold, and so the host's main has the revert/);
  assert.match(section(playbook, 'Undo'), /On a code host this is the host's step/);
  const pushFeature = command('git push -o merge_request.create -o merge_request.target=main -o merge_request.remove_source_branch origin <full approved hash>');
  const pushUndo = command('git push -o merge_request.create -o merge_request.target=main -o merge_request.remove_source_branch origin <full revert hash>');

  const r = repo('hostundo');
  const origin = r.make('origin.git');
  r.run(origin.cwd, 'init', '--bare', '-b', 'main');
  r.run(origin.cwd, 'config', 'receive.advertisePushOptions', 'true');
  const { cwd: mine } = r.make('mine');
  r.run(mine, 'init', '-b', 'main');
  r.run(mine, 'remote', 'add', 'origin', origin.cwd);
  commitFile(r, mine, 'a.txt', 'one\n', 'Start');
  r.run(mine, 'push', 'origin', 'main');
  const { cwd: hostSide } = r.make('host-side');
  r.run(hostSide, 'init', '-b', 'main');
  r.run(hostSide, 'remote', 'add', 'origin', origin.cwd);
  r.run(hostSide, 'fetch', 'origin');
  r.run(hostSide, 'switch', '-c', 'main', 'origin/main');
  const onOrigin = () => r.run(origin.cwd, 'ls-tree', '-r', '--name-only', 'main').split('\n');
  const hostMerges = (branch) => {
    r.run(hostSide, 'fetch', 'origin');
    r.run(hostSide, 'merge', '--no-ff', `origin/${branch}`, '-m', `Merge request for ${branch}`);
    r.run(hostSide, 'push', 'origin', 'main');
  };

  // M1: the feature is approved at one head; the builder commits again before the push; the host gets the approved commit.
  r.run(mine, 'fetch', 'origin');
  r.run(mine, 'switch', '-c', 'feature/export', 'origin/main');
  commitFile(r, mine, 'b.txt', 'two\n', 'Add the export');
  const full = r.run(mine, 'rev-parse', 'feature/export');
  const approved = full.slice(0, 12);
  commitFile(r, mine, 'sneak.txt', 'unreviewed\n', 'The builder commits again');
  r.run(mine, 'switch', 'main');
  assert.notEqual(r.run(mine, 'rev-parse', '--short=12', 'feature/export'), approved, 'the head moved after the approval, so the playbook pushes nothing');
  const pushed = sh(mine, r.env, pushFeature.replace('<full approved hash>', full).replace('<slug>', 'export'));
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(r.run(origin.cwd, 'rev-parse', 'refs/heads/feature/export'), full, 'exactly the approved commit is on the host');
  assert.ok(!r.run(origin.cwd, 'ls-tree', '-r', '--name-only', 'feature/export').includes('sneak.txt'), 'the later commit did not go up');
  hostMerges('feature/export');
  r.run(mine, 'fetch', 'origin');
  assert.equal(r.run(mine, 'rev-parse', '--short=12', 'origin/main^2'), approved);
  r.run(mine, 'merge', '--no-ff', 'origin/main', '-m', 'Take the code host\'s main version');
  assert.ok(onOrigin().includes('b.txt'));

  // M2: the undo is a new request on the host. Until the host merges it, the host's main still has the feature.
  const hostMerge = r.run(mine, 'rev-parse', 'origin/main');
  r.run(mine, 'fetch', 'origin');
  r.run(mine, 'switch', '-c', 'feature/undo-export', 'origin/main');
  r.run(mine, 'revert', '-m', '1', hostMerge, '--no-edit');
  const revert = r.run(mine, 'rev-parse', 'HEAD');
  r.run(mine, 'switch', 'main');
  const undoPush = sh(mine, r.env, pushUndo.replace('<full revert hash>', revert).replace('<slug>', 'export'));
  assert.equal(undoPush.status, 0, undoPush.stderr);
  assert.equal(r.run(origin.cwd, 'rev-parse', 'refs/heads/feature/undo-export'), revert);
  assert.ok(onOrigin().includes('b.txt'), 'before the host merges the revert, the host\'s main still has the feature: no undo line yet');
  hostMerges('feature/undo-export');
  r.run(mine, 'fetch', 'origin');
  assert.equal(r.run(mine, 'rev-parse', '--short=12', 'origin/main^2'), revert.slice(0, 12), 'the host added the revert');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main^1', 'feature/undo-export'], { cwd: mine, env: r.env }).status, 0);
  assert.ok(!onOrigin().includes('b.txt'), 'now the host\'s main has the revert: the undo line may be written');
  r.run(mine, 'merge', '--no-ff', 'origin/main', '-m', 'Take the code host\'s main version');
  assert.ok(!fs.existsSync(path.join(mine, 'b.txt')), 'and the local main version has it too');
});

test('Lean checks the project was set up before it acts, and points to setup when it was not', () => {
  const before = section(playbook, 'Before the first line');
  const first = before.split('\n').find((l) => l.startsWith('1. '));
  assert.match(first, /Wheelhouse is set up in this project/);
  assert.match(first, /`\.wheelhouse\/record`/);
  assert.match(first, /`wheelhouse\/board\.md`/);
  assert.match(first, /change nothing and say plainly: "Wheelhouse isn't set up in this project yet\./);
  assert.match(first, /`wheelhouse:setup`/);
  assert.match(first, /Then stop\./);
  const text = kit.get('skills/wheelhouse-lean/SKILL.md');
  assert.match(text, /Ask me to set up Wheelhouse \(`wheelhouse-setup`\)/, 'in the kit the skill is named as the kit names it');
  assert.ok(kit.has('skills/wheelhouse-setup/SKILL.md'));
});

// ---- STOP ----

test('STOP is said to be unenforced', () => {
  const stop = section(playbook, 'STOP');
  assert.match(stop, /nothing here makes me stop|nothing enforces/i);
  assert.match(stop, /once (in|per) (a )?session/i);
  assert.match(stop, /VS Code's stop button/);
  assert.match(stop, /`stop`/);
  assert.match(stop, /`lift-stop`/);
  assert.match(stop, /Lift STOP/);
});

// ---- The project key ----

test('the key is never asked for in the chat', () => {
  // The push names the approved commit's full hash, not the branch (M1); the options are the host's.
  assert.ok(playbook.includes('git push -o merge_request.create -o merge_request.target=main -o merge_request.remove_source_branch origin <full approved hash>:refs/heads/feature/<slug>'));
  const host = section(playbook, 'On a code host, without Node.js');
  assert.match(host, /never typed into the chat/i);
  assert.match(host, /sign-in window/);
  assert.match(host, /once/);
  assert.doesNotMatch(playbook, /(paste|type|send|give me|tell me|enter) (me )?(the|your|a) (project )?(key|token|password)/i);
  assert.doesNotMatch(playbook, /ask (them|the director) for (the|a|their) (project )?(key|token|password)/i);
});

// ---- The board ----

test('the board is the file the design names, rewritten whole, and starts with the tier and the safety lines', () => {
  const board = section(playbook, 'The board');
  assert.ok(board.includes(BOARD_FILE));
  assert.match(board, /rewrite/i);
  assert.match(board, /first line/i);
  assert.ok(playbook.includes('```\nTier: Lean\n- Nothing is held off'), 'the board starts with the tier, then the safety lines');
  assert.equal(playbook.split('\nTier: Lean\n').length, 4, 'one block for each case');
});

test('every safety line safetyLine gives for Lean is in the playbook exactly, for each case it names', () => {
  const cases = [
    { name: 'a Mac without Node.js', options: { platform: 'darwin', node: false } },
    { name: 'Windows without Node.js', options: { platform: 'win32', node: false } },
    { name: 'a computer where Node.js may run', options: { platform: 'darwin', node: true } },
  ];
  // The source says "{{agent}}" where the line names the product, so the source stays free of its name (the kit says it).
  const inSource = (line) => line.replaceAll('Copilot', '{{agent}}');
  for (const { name, options } of cases) {
    const lines = safetyLine({ tier: 'lean', shellGuard: false, addOn: false, ...options });
    assert.ok(lines.length >= 7, name);
    for (const line of lines) {
      assert.ok(playbook.includes(`- ${inSource(line)}\n`), `${name}: the playbook lacks "${line}"`);
      assert.ok(leanKit.includes(`- ${line}\n`), `${name}: the kit lacks "${line}"`);
    }
  }
  // Windows with Node.js says what the Mac does.
  assert.deepEqual(safetyLine({ tier: 'lean', platform: 'win32', node: true }), safetyLine({ tier: 'lean', platform: 'darwin', node: true }));
});

test('the playbook names a case for the board by what the computer allows, not by guessing', () => {
  const board = section(playbook, 'The board');
  assert.match(board, /Mac/);
  assert.match(board, /Windows/);
  assert.match(board, /Node\.js/);
  assert.match(board, /no add-on|add-on/);
});

// ---- Words ----

test('no Claude Code tool is named, nor Copilot in the source, nor a model name', () => {
  for (const name of TOOL_NAMES) assert.ok(!playbook.includes(name), `names ${name}`);
  assert.doesNotMatch(playbook, CLAUDE_CODE_TOOL_WORDS);
  // The source sits under adapters/copilot/, so its path comment names the folder; the text itself stays in general words.
  assert.doesNotMatch(playbook.replace(/^<!--[^\n]*-->\n/m, ''), /copilot/i, 'the source stays in general words');
  assert.doesNotMatch(playbook, /\b(ask_user|askQuestions|apply_patch)\b/);
  for (const tool of ['Write', 'Read', 'Edit', 'Bash', 'Grep', 'Glob']) assert.ok(!playbook.includes(`\`${tool}\``), `names \`${tool}\``);
  assert.doesNotMatch(playbook, /\b(opus|sonnet|haiku)\b|Co-Authored-By|Generated with/i);
  assert.doesNotMatch(playbook, /\b(enhanced|improved|fixed)\b/i);
  assert.ok(playbook.includes('your clickable-question tool'), 'cards use the general word');
});

test('the playbook speaks in plain words to the director and names the options on a card', () => {
  const cards = section(playbook, 'Cards');
  for (const option of ['Approve', 'Not now', 'Explain more', 'Show me']) assert.ok(cards.includes(`**${option}**`), option);
  assert.match(cards, /12 characters/);
  assert.match(cards, /what this is/i);
  assert.match(cards, /recommend/i);
  assert.match(cards, /meanwhile|what happens/i);
});

test('the playbook states the dates in the form the project uses', () => {
  assert.match(playbook, /23 October 2026/);
  assert.doesNotMatch(playbook, /October 23|23\/10|10\/23/);
});

// ---- The kit's Lean path ----

test('the Lean path of the kit names no Claude Code tool and no Claude Code', () => {
  const files = ['lean', 'board', 'stop', 'sources', 'settings', 'briefing'].map((n) => `skills/wheelhouse-${n}/SKILL.md`);
  for (const file of files) {
    assert.ok(kit.has(file), file);
    assert.doesNotMatch(kit.get(file), CLAUDE_CODE_TOOL_WORDS, file);
  }
});

test('the kit holds the playbook as wheelhouse-lean, with the product named where the source says {{agent}}', () => {
  const text = kit.get('skills/wheelhouse-lean/SKILL.md');
  assert.match(text, /^---\nname: "wheelhouse-lean"\ndescription: "[^\n]+"\n---\n<!-- adapters\/copilot\/home\/skills\/wheelhouse-lean\/SKILL\.md \(built from adapters\/copilot\/skills\/lean\/SKILL\.md by npm run copilot-home\) -->\n/);
  assert.ok(!text.includes('{{'), 'no token is left');
  assert.ok(text.includes('Copilot\'s command prompts aren\'t a control'));
  assert.ok(!text.includes('wheelhouse:'), 'skills are named with a hyphen');
});

test('the kit\'s sources and settings skills send the chat to wheelhouse-lean, and say plainly what Lean has none of', () => {
  const sources = kit.get('skills/wheelhouse-sources/SKILL.md');
  const settings = kit.get('skills/wheelhouse-settings/SKILL.md');
  assert.match(sources, /wheelhouse-lean/);
  assert.match(sources, /no weekly check|nothing checks the sources/i, 'Lean has no weekly check, and the skill says so');
  assert.match(settings, /wheelhouse-lean/);
  assert.match(settings, /section "Settings"/);
  for (const heading of ['The board', 'Settings', 'Sources', 'The briefing', 'STOP']) assert.ok(section(playbook, heading), heading);
  for (const command of ['board', 'briefing', 'stop']) assert.match(kit.get(`skills/wheelhouse-${command}/SKILL.md`), /wheelhouse-lean/, command);
});

test('the builder and the reviewer the playbook names are in the kit', () => {
  assert.ok(playbook.includes('wheelhouse-builder'));
  assert.ok(playbook.includes('wheelhouse-reviewer'));
  assert.ok(kit.has('agents/wheelhouse-builder.agent.md'));
  assert.ok(kit.has('agents/wheelhouse-reviewer.agent.md'));
});

test('buildHome throws when the Lean playbook is missing, and builds nothing from a token it does not know', () => {
  const root = tempFolder('wh-lean-home-');
  for (const part of ['skills', 'agents', 'commands']) fs.cpSync(path.join(ROOT, part), path.join(root, part), { recursive: true });
  fs.mkdirSync(path.join(root, 'adapters', 'copilot'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'adapters', 'copilot', 'tool-sheet.md'), path.join(root, 'adapters', 'copilot', 'tool-sheet.md'));
  fs.cpSync(path.join(ROOT, 'adapters', 'copilot', 'skills'), path.join(root, 'adapters', 'copilot', 'skills'), { recursive: true });
  assert.doesNotThrow(() => buildHome({ root }));
  const file = path.join(root, 'adapters', 'copilot', 'skills', 'lean', 'SKILL.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('{{agent}}', '{{somebody}}'));
  assert.throws(() => buildHome({ root }), /somebody/);
  fs.rmSync(path.join(root, 'adapters', 'copilot', 'skills', 'lean'), { recursive: true });
  assert.throws(() => buildHome({ root }), /skills[\\/]lean[\\/]SKILL\.md/);
});

// ---- No host program ran ----

test('none of gh, glab or copilot ran', () => {
  assert.deepEqual(stand.calls(), []);
});
