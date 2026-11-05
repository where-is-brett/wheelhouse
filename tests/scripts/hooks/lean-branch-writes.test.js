// tests/scripts/hooks/lean-branch-writes.test.js
// At Lean, no product file is written unless the project's folder is on a feature's own copy. The hook reads files only: a
// `.git` folder (or a linked worktree's `.git` file) with a HEAD is enough, so no git runs.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import { decide, leanRootOf, branchOf, LEAN_NO_MAIN_WRITES } from '../../../scripts/hooks/lean-branch-writes.js';

const base = fs.realpathSync.native(tempFolder('wh-branch-writes-'));
const put = (file, text = 'x\n') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// A Lean project on `head` (the text of .git/HEAD).
function project(name, head) {
  const dir = path.join(base, name);
  put(path.join(dir, '.git', 'HEAD'), head);
  put(path.join(dir, '.wheelhouse', 'record', '.gitkeep'), '');
  put(path.join(dir, 'src', 'app.js'));
  return dir;
}
const MAIN = project('on-main', 'ref: refs/heads/main\n');
const DETACHED = project('detached', '0123456789abcdef0123456789abcdef01234567\n');
const FEATURE = project('on-feature', 'ref: refs/heads/feature/greeting\n');

const edit = (cwd, file, tool = 'Edit') => ({ tool_name: tool, cwd, tool_input: { file_path: file } });
const bash = (cwd, command, tool = 'Bash') => ({ tool_name: tool, cwd, tool_input: { command } });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

test('a product file is refused on the main version and on a detached HEAD', () => {
  for (const dir of [MAIN, DETACHED]) {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      const out = decide(edit(dir, path.join(dir, 'src', 'app.js'), tool));
      assert.ok(denied(out), `${path.basename(dir)} ${tool}`);
      assert.equal(out.hookSpecificOutput.permissionDecisionReason, LEAN_NO_MAIN_WRITES);
    }
    assert.ok(denied(decide(edit(dir, 'src/new.test.js', 'Write'))), 'a new file, by a relative path');
    assert.ok(denied(decide(edit(dir, path.join(dir, 'README.md'), 'Write'))), 'a file at the top');
  }
});

test('a feature\'s own copy may be written, by any tool', () => {
  assert.equal(decide(edit(FEATURE, path.join(FEATURE, 'src', 'app.js'))), undefined);
  assert.equal(decide(bash(FEATURE, 'echo hi > src/app.js')), undefined);
});

test('the Wheelhouse files, git\'s folder and the files setup makes are left alone on the main version', () => {
  for (const file of ['.wheelhouse/record/2026-11-06.jsonl', '.wheelhouse/feature/brief.md', 'wheelhouse/board.md', '.git/info/exclude', '.gitignore', '.vscode/settings.json', '.github/copilot-instructions.md']) {
    assert.equal(decide(edit(MAIN, path.join(MAIN, file), 'Write')), undefined, file);
  }
  assert.ok(denied(decide(edit(MAIN, path.join(MAIN, 'wheelhouse', 'other.md'), 'Write'))), 'only the Logbook of that folder');
  assert.equal(decide(bash(MAIN, 'mkdir -p wheelhouse')), undefined, 'the Logbook\'s folder itself, made again by setup');
  assert.match(LEAN_NO_MAIN_WRITES, /Record the change through Intake \(the brief and its card\), and do not make a branch yourself/);
  assert.doesNotMatch(LEAN_NO_MAIN_WRITES, /feature's own copy/);
  assert.ok(denied(decide(edit(MAIN, path.join(MAIN, '.wheelhouse-not', 'x'), 'Write'))), 'a folder whose name only starts the same');
});

test('a shell command that writes a product file is refused on the main version; reads and the record are not', () => {
  assert.ok(denied(decide(bash(MAIN, 'echo hi > src/app.js'))));
  assert.ok(denied(decide(bash(MAIN, 'sed -i s/a/b/ src/app.js'))));
  assert.ok(denied(decide(bash(MAIN, 'cp /dev/null src/app.js'))));
  assert.ok(denied(decide(bash(MAIN, 'echo x > src/app.js', 'PowerShell'))));
  assert.equal(decide(bash(MAIN, 'git status --short')), undefined);
  assert.equal(decide(bash(MAIN, 'cat src/app.js')), undefined);
  assert.equal(decide(bash(MAIN, 'cat >> .wheelhouse/record/2026-11-06.jsonl')), undefined);
  assert.equal(decide(bash(MAIN, 'echo x > /tmp/elsewhere.txt')), undefined, 'outside the project');
});

test('a write outside every Lean project is left alone', () => {
  const plain = path.join(base, 'plain');
  put(path.join(plain, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  put(path.join(plain, 'a.js'));
  assert.equal(decide(edit(plain, path.join(plain, 'a.js'))), undefined, 'no record folder, so not Lean');
  assert.equal(decide(edit(MAIN, path.join(base, 'elsewhere.txt'))), undefined);
});

test('a linked worktree is read through its .git file', () => {
  const real = path.join(base, 'store', 'wt-main');
  put(path.join(real, 'HEAD'), 'ref: refs/heads/main\n');
  const wt = path.join(base, 'wt-project');
  put(path.join(wt, '.git'), `gitdir: ${real}\n`);
  put(path.join(wt, '.wheelhouse', 'record', '.gitkeep'), '');
  put(path.join(wt, 'a.js'));
  assert.equal(branchOf(wt), 'main');
  assert.ok(denied(decide(edit(wt, path.join(wt, 'a.js')))));
  put(path.join(real, 'HEAD'), 'ref: refs/heads/feature/x\n');
  assert.equal(decide(edit(wt, path.join(wt, 'a.js'))), undefined);
  assert.equal(leanRootOf(path.join(wt, 'deep', 'er')), wt);
});

test('it fails open: HEAD missing or unreadable, a command it cannot parse, a malformed input', () => {
  const noHead = path.join(base, 'no-head');
  put(path.join(noHead, '.git', 'config'), '');
  put(path.join(noHead, '.wheelhouse', 'record', '.gitkeep'), '');
  assert.equal(branchOf(noHead), null);
  assert.equal(decide(edit(noHead, path.join(noHead, 'a.js'))), undefined);
  assert.equal(decide(bash(MAIN, 'echo $(date) > src/app.js')), undefined, 'a command it cannot read');
  assert.equal(decide(undefined), undefined);
  assert.equal(decide({ tool_name: 'Edit', cwd: 'relative', tool_input: { file_path: 'a' } }), undefined);
  assert.equal(decide({ tool_name: 'Edit', cwd: MAIN, tool_input: {} }), undefined);
  assert.equal(decide({ tool_name: 'Read', cwd: MAIN, tool_input: { file_path: path.join(MAIN, 'src', 'app.js') } }), undefined);
});
