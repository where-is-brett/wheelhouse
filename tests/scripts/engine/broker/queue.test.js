// tests/scripts/engine/broker/queue.test.js
// The calls the merge queue may make from its own folder (check 81): reads, merges and re-runs as the broker's list
// allows them, and a queued pull request's text replaced from the sweep's own body file, sent on as standard input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { queueCall, BODY_MOST } from '../../../../scripts/engine/broker/queue.js';
import { tempFolder } from '../../../helpers/homes.js';

const HEAD = 'a'.repeat(40);

function artefacts() {
  const root = tempFolder('wh-queue-artefacts-');
  const runs = path.join(root, 'runs');
  fs.mkdirSync(path.join(runs, 'run1'), { recursive: true });
  const file = path.join(runs, 'run1', 'pr-body-5.md');
  fs.writeFileSync(file, 'Closes #5\n');
  return { root, runs, file };
}

test("a queued pull request's text is replaced from the sweep's own body file, sent on as standard input", () => {
  const { runs, file } = artefacts();
  const got = queueCall({ argv: ['pr', 'edit', '5', '--repo', 'github.com/acme/web', '--body-file', file], repo: 'acme/web', artefacts: runs, ready: { 5: { head: HEAD } } });
  assert.deepEqual(got, { ok: true, argv: ['pr', 'edit', '5', '--body-file', '-', '--repo', 'github.com/acme/web'], stdin: 'Closes #5\n' });
  assert.equal(queueCall({ argv: ['pr', 'edit', '5', `--body-file=${file}`], artefacts: runs, ready: { 5: {} } }).ok, true);
});

test("an edit of a pull request not in the queue, or from any file but the sweep's own, or of anything but the body, is refused", () => {
  const { root, runs, file } = artefacts();
  const ready = { 5: { head: HEAD } };
  const edit = (argv, given = ready) => queueCall({ argv, artefacts: runs, ready: given });
  assert.match(edit(['pr', 'edit', '5', '--body-file', file], {}).refused, /isn't in the merge queue/);
  // Another pull request's name, a file outside the runs, a link to a file, a relative path, standard input.
  const other = path.join(runs, 'run1', 'pr-body-6.md');
  fs.writeFileSync(other, 'x');
  assert.equal(edit(['pr', 'edit', '5', '--body-file', other]).ok, false);
  const outside = path.join(root, 'pr-body-5.md');
  fs.writeFileSync(outside, 'x');
  assert.equal(edit(['pr', 'edit', '5', '--body-file', outside]).ok, false);
  const secret = path.join(root, 'secret');
  fs.writeFileSync(secret, 'key');
  fs.mkdirSync(path.join(runs, 'run2'));
  fs.symlinkSync(secret, path.join(runs, 'run2', 'pr-body-5.md'));
  assert.equal(edit(['pr', 'edit', '5', '--body-file', path.join(runs, 'run2', 'pr-body-5.md')]).ok, false);
  assert.equal(edit(['pr', 'edit', '5', '--body-file', 'run1/pr-body-5.md']).ok, false);
  assert.equal(edit(['pr', 'edit', '5', '--body-file', '-']).ok, false);
  // Too long.
  fs.writeFileSync(file, 'x'.repeat(BODY_MOST + 1));
  assert.equal(edit(['pr', 'edit', '5', '--body-file', file]).ok, false);
  fs.writeFileSync(file, 'Closes #5\n');
  // The title, a body given inline, two files, no number.
  for (const argv of [
    ['pr', 'edit', '5', '--title', 't', '--body-file', file],
    ['pr', 'edit', '5', '--body', 'Closes #5'],
    ['pr', 'edit', '5', '--body-file', file, '--body-file', file],
    ['pr', 'edit', '--body-file', file],
  ]) assert.equal(edit(argv).ok, false, argv.join(' '));
});

test('from the queue, reads, merges and re-runs go on to the list, and nothing else does', () => {
  const pass = (argv) => queueCall({ argv, repo: 'acme/web', artefacts: '/none', ready: {} });
  for (const argv of [
    ['pr', 'view', '5', '--repo', 'github.com/acme/web', '--json', 'body'],
    ['issue', 'view', '5', '--repo', 'github.com/acme/web', '--json', 'body'],
    ['pr', 'merge', '5', '--squash', '--match-head-commit', HEAD],
    ['run', 'rerun', '77', '--failed'],
  ]) assert.deepEqual(pass(argv), { ok: true, argv, stdin: '' }, argv.join(' '));
  for (const argv of [
    ['pr', 'create', '--head', 'b', '--title', 't', '--body', 'b'],
    ['pr', 'comment', '5', '--body', 'hello'],
    ['api', '-X', 'PATCH', 'repos/acme/web/git/refs/heads/b', '-f', 'sha=x'],
    ['repo', 'delete', 'acme/web'],
    ['pr', 'view', 'https://github.com/other/repo/pull/5'],
  ]) assert.equal(pass(argv).ok, false, argv.join(' '));
});
