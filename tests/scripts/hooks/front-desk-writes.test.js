// tests/scripts/hooks/front-desk-writes.test.js
// The front desk's write guard: in the chat of a set-up project's own checkout it refuses a write to the product's files;
// in an engine worktree, a job folder, a feature or foreman session, an engine step, a project being set up, a folder
// that isn't set up, or a path outside the project (and `.wheelhouse/` inside it) it does nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  decide, FRONT_DESK_NO_WRITES, ASIDE_NO_WRITES, lockedDocuments, APPROVED_LOCKED, NO_STATUS_LINE, statusLineIn,
} from '../../../scripts/hooks/front-desk-writes.js';
import { sessionRole } from '../../../scripts/lib/role.js';
import { readSeat } from '../../../scripts/lib/first-mate-seat.js';
import { tempFolder } from '../../helpers/homes.js';
import { inHome, keep } from '../../helpers/decisions-world.js';
import { makeEvent } from '../../../scripts/state/events.js';

const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

function project() {
  const folder = fs.realpathSync(tempFolder('wh-fdw-'));
  fs.mkdirSync(path.join(folder, '.git'));
  fs.mkdirSync(path.join(folder, 'src'));
  const worktree = path.join(folder, 'jobs', 'piece');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
  return { folder, worktree };
}
const options = (folder, over = {}) => ({
  env: {}, find: () => ({ project: 'p', record: { folder } }), setUp: () => null, role: () => 'front-desk', ...over,
});
const write = (cwd, file, tool = 'Write') => ({
  tool_name: tool, cwd, session_id: 's1', tool_input: tool === 'NotebookEdit' ? { notebook_path: file } : { file_path: file, content: 'x' },
});

test('a write to a product file in the project\'s own checkout is refused, with what to do instead', () => {
  const { folder } = project();
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    const out = decide(write(folder, path.join(folder, 'notes.js'), tool), options(folder));
    assert.ok(denied(out), tool);
  }
  const out = decide(write(path.join(folder, 'src'), 'a.js'), options(folder));
  assert.ok(denied(out), 'from a subfolder, by a relative path');
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, FRONT_DESK_NO_WRITES('src/a.js'));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /plan or work/);
});

test('the front desk\'s own folder, and files outside the project, are allowed', () => {
  const { folder } = project();
  assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'work', 'x.md')), options(folder)), undefined);
  assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'front-desk.json')), options(folder)), undefined);
  assert.equal(decide(write(folder, path.join(tempFolder('wh-fdw-out-'), 'front-desk.json')), options(folder)), undefined);
  assert.ok(denied(decide(write(folder, path.join(folder, '.wheelhouse', '..', 'notes.js')), options(folder))), 'a path that climbs out of it');
});

test('an engine worktree or job folder inside the project is allowed', () => {
  const { folder, worktree } = project();
  assert.equal(decide(write(worktree, path.join(worktree, 'notes.js')), options(folder)), undefined);
});

test('a feature or foreman session, an engine step, and a project being set up are allowed', () => {
  const { folder } = project();
  const target = path.join(folder, 'notes.js');
  assert.equal(decide(write(folder, target), options(folder, { role: () => 'feature' })), undefined);
  assert.equal(decide(write(folder, target), options(folder, { role: () => 'foreman' })), undefined);
  assert.equal(decide(write(folder, target), options(folder, { setUp: () => ({ folder, run: { startedAt: new Date().toISOString() } }) })), undefined);
  const engine = { WHEELHOUSE_ENGINE_RUN: '1', ARCHON_NODE_EXECUTION: JSON.stringify({ runId: 'r1' }), WORKFLOW_ID: 'r1' };
  assert.equal(decide(write(folder, target), options(folder, { env: engine })), undefined);
});

test('a folder that is not a set-up project, and other tools, are untouched', () => {
  const { folder } = project();
  const target = path.join(folder, 'notes.js');
  assert.equal(decide(write(folder, target), options(folder, { find: () => null })), undefined);
  assert.equal(decide({ tool_name: 'Read', cwd: folder, tool_input: { file_path: target } }, options(folder)), undefined);
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: target } }, options(folder)), undefined);
});

test('a setup run that has been still for hours no longer turns the hook off', () => {
  const { folder } = project();
  const target = path.join(folder, 'notes.js');
  const old = { folder, run: { startedAt: '2026-11-01T00:00:00.000Z', steps: { 1: { doneAt: '2026-11-01T01:00:00.000Z' } } } };
  assert.ok(denied(decide(write(folder, target), options(folder, { setUp: () => old, now: () => Date.parse('2026-11-05T00:00:00.000Z') }))));
  assert.equal(decide(write(folder, target), options(folder, { setUp: () => old, now: () => Date.parse('2026-11-01T01:30:00.000Z') })), undefined);
});

test('a nested repository made inside the project does not turn the hook off, but a linked worktree is its own checkout', () => {
  const { folder } = project();
  const nested = path.join(folder, 'app');
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  assert.ok(denied(decide(write(nested, path.join(nested, 'index.js')), options(folder))));
  assert.ok(denied(decide(write(nested, path.join(folder, 'notes.js')), options(folder))));
});

const bash = (cwd, command) => ({ tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command } });

test('a shell command that writes the product is refused', () => {
  const { folder } = project();
  for (const command of [
    'cat > notes.js <<EOF\nconsole.log(1)\nEOF', 'echo x >> README.md', 'echo x | tee src/a.js', 'sed -i s/a/b/ src/a.js', 'perl -pi -e s/a/b/ src/a.js',
    'cp /tmp/a.js src/a.js', 'mv /tmp/a.js notes.js', 'touch notes.js', 'npm create vite@latest', 'npx create-react-app app', 'git init',
    'cd app && git init', 'node -e "require(\'fs\').writeFileSync(\'a.js\', \'x\')"', 'python3 -c "open(\'a.py\', \'w\').write(\'x\')"',
  ]) {
    const out = decide(bash(folder, command), options(folder));
    assert.ok(denied(out), command);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /plan or work/);
  }
});

test('a shell command that reads, or writes outside the product, passes', () => {
  const { folder } = project();
  for (const command of [
    'ls -la', 'git status', 'npm test 2>&1', 'npm test >/dev/null 2>&1', 'node cli.js card < /tmp/front-desk.json', 'cat <<EOF | node cli.js card\ntouch a\ntee b\nEOF',
    'echo x > /tmp/front-desk.json', `echo x > ${path.join(folder, '.wheelhouse', 'work', 'a.md')}`, 'cat > .wheelhouse/front-desk.json <<EOF\n{}\nEOF',
    'sed -n 1,20p src/a.js', 'git init /tmp/other', 'node cli.js views waiting', 'echo "a > b"', 'grep -r "touch" src',
  ]) assert.equal(decide(bash(folder, command), options(folder)), undefined, command);
  assert.equal(decide(bash(folder, 'echo ${HOME} > "$X"'), options(folder)), undefined, 'a target it can\'t place');
  assert.equal(decide(bash(folder, 'echo (unclosed'), options(folder)), undefined, 'a command it can\'t read');
});

test('the shell check keeps to the same conditions', () => {
  const { folder, worktree } = project();
  assert.equal(decide(bash(worktree, 'touch notes.js'), options(folder)), undefined, 'a linked worktree');
  assert.equal(decide(bash(folder, 'touch notes.js'), options(folder, { role: () => 'feature' })), undefined);
  assert.equal(decide(bash(folder, 'touch notes.js'), options(folder, { find: () => null })), undefined);
});

test('a one-liner that prints to stdout or stderr is not a write', () => {
  const { folder } = project();
  for (const command of ['node -e "process.stdout.write(\'x\')"', 'python3 -c "import sys; sys.stderr.write(\'x\')"']) assert.equal(decide(bash(folder, command), options(folder)), undefined, command);
});

test('PowerShell reads only the path parameters and the first argument as paths', () => {
  const { folder } = project();
  const ps = (command) => ({ tool_name: 'PowerShell', cwd: folder, session_id: 's1', tool_input: { command } });
  assert.equal(decide(ps('New-Item -ItemType Directory -Path .wheelhouse/work'), options(folder)), undefined);
  assert.equal(decide(ps('Get-Date | Out-File .wheelhouse/a.txt -Encoding utf8'), options(folder)), undefined);
  assert.ok(denied(decide(ps('New-Item -ItemType File -Path src/a.js'), options(folder))));
  assert.ok(denied(decide(ps('Set-Content notes.js -Value x'), options(folder))));
  assert.ok(denied(decide(ps('Out-File -FilePath notes.js -Encoding utf8'), options(folder))));
});

test('a heredoc fed to an interpreter is read, and one fed to anything else is not', () => {
  const { folder } = project();
  assert.ok(denied(decide(bash(folder, "python3 - <<'EOF'\nopen('a.py', 'w').write('x')\nEOF"), options(folder))));
  assert.ok(denied(decide(bash(folder, 'node - <<EOF\nrequire("fs").writeFileSync("a.js", "x")\nEOF'), options(folder))));
  assert.ok(denied(decide(bash(folder, 'bash <<EOF\ntouch notes.js\nEOF'), options(folder))));
  assert.equal(decide(bash(folder, "python3 - <<'EOF'\nprint(1)\nEOF"), options(folder)), undefined);
  assert.equal(decide(bash(folder, 'bash <<EOF\nls\nEOF'), options(folder)), undefined);
  assert.equal(decide(bash(folder, 'cat <<EOF | node cli.js card\nwriteFileSync touch a\nEOF'), options(folder)), undefined);
  assert.equal(decide(bash(folder, 'cat > .wheelhouse/f.json <<EOF\nwriteFileSync\nEOF'), options(folder)), undefined);
});

// ---- The seat decides who is the front desk ----

const seatOf = (session) => ({ session, pid: null, pidStart: null, folder: '/x', since: new Date().toISOString(), seenAt: new Date().toISOString() });
function withSeat(holder, fn) {
  const home = fs.realpathSync(tempFolder('wh-fdw-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    fs.mkdirSync(path.join(home, 'projects', 'p'), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', 'p', 'first-mate.json'), JSON.stringify(seatOf(holder)));
    return fn();
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}
// The role comes from the real seat, with no role recorded for the session.
const bySeat = (folder) => options(folder, { role: (given) => sessionRole({ ...given, seat: readSeat('p') }) });

test('the holder may not write the product\'s files', () => {
  const { folder } = project();
  withSeat('s1', () => {
    const out = decide(write(folder, path.join(folder, 'src', 'a.js')), bySeat(folder));
    assert.ok(denied(out));
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, FRONT_DESK_NO_WRITES('src/a.js'));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /worktree/);
  });
});

test('a main-folder aside may not write the product\'s files', () => {
  const { folder } = project();
  withSeat('other', () => {
    const out = decide(write(folder, path.join(folder, 'src', 'a.js')), bySeat(folder));
    assert.ok(denied(out));
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, ASIDE_NO_WRITES('src/a.js'));
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /worktree/);
  });
});

test('a worktree aside may write in its worktree', () => {
  const { folder, worktree } = project();
  withSeat('other', () => {
    assert.equal(decide(write(worktree, path.join(worktree, 'a.js')), bySeat(folder)), undefined);
    assert.equal(decide(write(worktree, path.join(folder, 'src', 'a.js')), bySeat(folder)), undefined, 'it is not the First Mate, and stands in a worktree');
  });
});

test('an aside\'s own .wheelhouse notes stay allowed', () => {
  const { folder } = project();
  withSeat('other', () => {
    assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'work', 'x.md')), bySeat(folder)), undefined);
  });
});

test('the holder\'s write refreshes the seat', () => {
  const { folder } = project();
  withSeat('s1', () => {
    const file = path.join(process.env.WHEELHOUSE_HOME, 'projects', 'p', 'first-mate.json');
    const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify({ ...seatOf('s1'), seenAt: old }));
    decide(write(folder, path.join(folder, 'src', 'a.js')), bySeat(folder));
    assert.ok(Date.parse(JSON.parse(fs.readFileSync(file, 'utf8')).seenAt) > Date.parse(old));
  });
});

// ---- Approved documents are locked ----

const HASH = 'a'.repeat(64);
const lockedAt = (folder) => () => [{ work: 'w1', file: path.join(folder, '.wheelhouse', 'work', 'w1.md'), hash: HASH }];
const bash2 = (cwd, command) => ({ tool_name: 'Bash', cwd, session_id: 's1', tool_input: { command } });

test('an approved document cannot be written by a file tool or the shell, but its change file can', () => {
  const { folder } = project();
  const file = path.join(folder, '.wheelhouse', 'work', 'w1.md');
  const opts = options(folder, { locked: lockedAt(folder) });
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    const out = decide(write(folder, file, tool), opts);
    assert.ok(denied(out), tool);
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, APPROVED_LOCKED('w1', '.wheelhouse/work/w1.md'));
  }
  assert.ok(denied(decide(bash2(folder, `sed -i 's/a/b/' ${file}`), opts)), 'sed -i');
  assert.ok(denied(decide(bash2(folder, `echo hi > ${file}`), opts)), 'redirect');
  assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'work', 'w1.change.md')), opts), undefined);
  assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'work', 'w2.md')), opts), undefined, 'a new brief');
});

test('a document with nothing locked, and a hook that cannot read the record, allow the write', () => {
  const { folder } = project();
  const file = path.join(folder, '.wheelhouse', 'work', 'w1.md');
  assert.equal(decide(write(folder, file), options(folder, { locked: () => [] })), undefined);
  assert.equal(decide(write(folder, file), options(folder, { locked: () => { throw new Error('unreadable'); } })), undefined);
});

test('a status line written into a design under .wheelhouse/work is refused', () => {
  const { folder } = project();
  const file = path.join(folder, '.wheelhouse', 'work', 'x.md');
  const opts = options(folder);
  const out = decide({ tool_name: 'Write', cwd: folder, session_id: 's1', tool_input: { file_path: file, content: "# D\n\nStatus: draft, waiting for the director's approval\n" } }, opts);
  assert.ok(denied(out));
  assert.equal(out.hookSpecificOutput.permissionDecisionReason, NO_STATUS_LINE);
  const edit = decide({ tool_name: 'Edit', cwd: folder, session_id: 's1', tool_input: { file_path: file, old_string: 'a', new_string: "**Status:** approved by the director's click" } }, opts);
  assert.ok(denied(edit));
  const multi = decide({ tool_name: 'MultiEdit', cwd: folder, session_id: 's1', tool_input: { file_path: file, edits: [{ old_string: 'a', new_string: '> Status: pending' }] } }, opts);
  assert.ok(denied(multi));
  assert.equal(decide({ tool_name: 'Write', cwd: folder, session_id: 's1', tool_input: { file_path: file, content: '# Design\n\nIt does a thing.\n' } }, opts), undefined);
  const outside = path.join(tempFolder('wh-fdw-out-'), 'x.md');
  assert.equal(decide({ tool_name: 'Write', cwd: folder, session_id: 's1', tool_input: { file_path: outside, content: 'Status: draft' } }, opts), undefined);
});

test('statusLineIn reads status lines and not prose', () => {
  assert.ok(statusLineIn('Status: Awaiting review'));
  assert.ok(statusLineIn('- status: changed since the click'));
  assert.ok(statusLineIn('## Status: proposed'));
  assert.ok(!statusLineIn('The status: unknown to us'));
  assert.ok(!statusLineIn('Status codes are listed below'));
});

test('lockedDocuments lists open approved work with its path and approval hash', () => {
  const folder = path.join(path.sep, 'proj');
  const entry = (over = {}) => ({ work: { at: '2026-11-09T00:00:00Z', data: { doc: { path: '.wheelhouse/work/a.md' } } }, approval: { hash: HASH }, ...over });
  const views = {
    work: {
      a: entry(),
      abs: entry({ work: { data: { doc: { path: path.join(path.sep, 'else', 'abs.md') } } } }),
      none: entry({ approval: undefined }),
      done: entry(),
    },
    features: {},
    reports: {},
  };
  const endedViews = { ...views, reports: { done: { at: '2026-11-09T01:00:00Z', data: { outcome: 'merged' } } } };
  const listed = lockedDocuments(views, folder);
  assert.deepEqual(listed.find((l) => l.work === 'a'), { work: 'a', file: path.join(folder, '.wheelhouse', 'work', 'a.md'), hash: HASH });
  assert.equal(listed.find((l) => l.work === 'abs').file, path.join(path.sep, 'else', 'abs.md'));
  assert.equal(listed.find((l) => l.work === 'none'), undefined);
  assert.equal(lockedDocuments(endedViews, folder).find((l) => l.work === 'done'), undefined);
  assert.ok(listed.find((l) => l.work === 'done'));
});

test('the default lock reads the real record: an approved document is refused, and allowed once the work is reported', async () => {
  const { folder } = project();
  const P = 'owner__lock-demo';
  const rel = '.wheelhouse/work/w-lock.md';
  const text = '# Design\n\nIt does a thing.\n';
  fs.mkdirSync(path.join(folder, '.wheelhouse', 'work'), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), text);
  const hash = 'b'.repeat(64);
  const at = (n) => () => new Date(Date.UTC(2026, 10, 9, 1, 0, n));
  await inHome(async () => {
    keep(makeEvent({ kind: 'work', data: { id: 'w-lock', title: 'Lock', lane: 'small', doc: { path: rel, hash }, visible: true, dependsOn: [] }, now: at(0) }), P);
    keep(makeEvent({
      kind: 'action',
      data: { action: 'approve-work', work: 'w-lock', lane: 'small', hash, shownFirst: false, question: 'Approve w-lock?', label: 'Approve' },
      now: at(1),
    }), P);
    const opts = { env: {}, find: () => ({ project: P, record: { folder } }), setUp: () => null, role: () => 'front-desk' };
    const out = decide(write(folder, path.join(folder, rel)), opts);
    assert.ok(denied(out), 'refused while approved and open');
    assert.equal(out.hookSpecificOutput.permissionDecisionReason, APPROVED_LOCKED('w-lock', rel));
    assert.equal(decide(write(folder, path.join(folder, '.wheelhouse', 'work', 'w-lock.change.md')), opts), undefined);
    keep(makeEvent({ kind: 'report', data: { work: 'w-lock', outcome: 'merged', summary: 'Done.', rulings: [], pr: 1 }, now: at(5) }), P);
    assert.equal(decide(write(folder, path.join(folder, rel)), opts), undefined, 'allowed once the work is reported');
  });
});
