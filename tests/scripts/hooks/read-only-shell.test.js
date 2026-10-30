// tests/scripts/hooks/read-only-shell.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READ_ONLY_STEPS, readOnlyStep, shellWrite } from '../../../scripts/hooks/read-only-shell.js';
import { REVIEW_STEPS } from '../../../scripts/engine/routes.js';

const step = (path, extra = {}) => ({ WHEELHOUSE_ENGINE_RUN: '1', WORKFLOW_ID: 'run-1', ARCHON_NODE_EXECUTION: JSON.stringify({ runId: 'run-1', path, invocation: 1, attempt: 1 }), ...extra });

test('the steps that read only are the helper\'s signed reviews, the slice lane\'s task review and its tester, and the lesson', () => {
  for (const id of REVIEW_STEPS) assert.ok(READ_ONLY_STEPS.includes(id), id);
  assert.ok(READ_ONLY_STEPS.includes('task-review'));
  assert.ok(READ_ONLY_STEPS.includes('tester'));
  assert.ok(READ_ONLY_STEPS.includes('lesson'));
});

test('a step is known as one that reads only from the engine\'s own record of the node it runs, nested in a loop or not', () => {
  assert.equal(readOnlyStep(step('review-standards')), 'review-standards');
  assert.equal(readOnlyStep(step('review.review-spec')), 'review-spec');
  assert.equal(readOnlyStep(step(['build', 'task-review'])), 'task-review');
  assert.equal(readOnlyStep(step('implement')), null);
  assert.equal(readOnlyStep(step('review.fix')), null);
  // Not an engine step, or no record of the node: not a step that reads only.
  assert.equal(readOnlyStep({ ...step('review-spec'), WHEELHOUSE_ENGINE_RUN: undefined }), null);
  assert.equal(readOnlyStep({ WHEELHOUSE_ENGINE_RUN: '1' }), null);
  assert.equal(readOnlyStep({ WHEELHOUSE_ENGINE_RUN: '1', ARCHON_NODE_EXECUTION: '{' }), null);
  assert.equal(readOnlyStep({}), null);
});

test('a reading command passes: git\'s reading commands, the file readers, searches and pipes of them', () => {
  for (const command of [
    'git diff main...HEAD', 'git -C sub log --oneline -5', 'git show HEAD:src/a.js', 'git status --short', 'git diff --stat 2>&1 | head -50',
    'cat src/a.js', 'sed -n 1,80p src/a.js', 'sed -n \'10,$p\' a.js', 'grep -rn "TODO" src', 'rg -n foo src | wc -l', 'ls -la',
    'find src -name "*.test.js"', 'head -20 a.js; tail -5 b.js', 'cd src && ls', 'sort a.txt | uniq -c', 'wc -l a.js 2>/dev/null',
    'diff a.js b.js || true', 'file src/a.js', 'git cat-file -p HEAD:a', 'echo done', '(cd src; ls) | head', 'git diff HEAD...abc123', 'git log --format=%s -3 && git diff HEAD~1 --name-only', 'jq .name package.json',
  ]) assert.equal(shellWrite(command), null, command);
});

test('a command that writes, or might, is named: redirects to a file, editors in place, git\'s writing commands, any other program', () => {
  for (const command of [
    'echo x > a.txt', 'echo x >> a.txt', 'cat a >| b', 'git diff &> out.txt', 'ls 2> err.txt', 'cat a | tee b',
    'touch a.txt', 'rm -rf src', 'mv a b', 'cp a b', 'mkdir x', 'chmod +x a', 'ln -s a b',
    'git commit -am x', 'git add .', 'git checkout -- a.js', 'git stash', 'git reset --hard', 'git apply p.diff', 'git -c alias.x=!sh x',
    'git diff --output=d.txt', 'git grep -Ovim foo', 'sed -i s/a/b/ a.js', 'sed -n w\\ out a.js', 'sed -f s.sed a.js',
    'find . -name x -delete', 'find . -exec rm {} ;', 'find . -fprint out', 'sort -o a a', 'sort --output=a a', 'uniq a b', 'rg --pre sh x',
    'node -e "require(\'fs\').writeFileSync(\'a\',\'\')"', 'npm test', 'python3 x.py', 'sh -c "touch a"', 'bash x.sh', 'awk \'{print > "f"}\' a',
    'xargs rm < list', 'env touch a', 'FOO=1 touch a', 'echo $(touch a)', 'echo `touch a`', 'perl -pi -e s/a/b/ a', 'dd of=a', 'curl -o a x',
    'cat <<EOF > a.txt\nhi\nEOF', 'echo "unclosed', 'git diff $(git merge-base a HEAD) a', 'sort --compress-program=sh a', 'sort -T /tmp a', 'sort --temporary-directory=x a', 'file -C -m x', 'file --compile -m x', 'git cat-file --filters HEAD:a', 'diff <(ls) b', '(ls) | touch a',
  ]) assert.ok(typeof shellWrite(command) === 'string' && shellWrite(command) !== '', command);
});
