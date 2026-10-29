// tests/scripts/feature/approved.test.js
// The approved document in a feature's worktree (build-loop design, section 13): the work's
// document from the main checkout, copied only when it is the one approved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APPROVED_FILE, approvedDocument, approvedPath, placeApproved } from '../../../scripts/feature/approved.js';
import { briefHash, featurePaths } from '../../../scripts/feature/files.js';
import { tempFolder } from '../../helpers/homes.js';

const DESIGN = '# Sign-in\n\nPeople sign in with an email link. Listings come from the two sites the director named.\n';

function scene({ text = DESIGN, approval } = {}) {
  const checkout = tempFolder('wh-approved-');
  fs.mkdirSync(path.join(checkout, '.wheelhouse', 'work'), { recursive: true });
  fs.writeFileSync(path.join(checkout, '.wheelhouse', 'work', 'sign-in.md'), text);
  const hash = briefHash(DESIGN);
  const views = {
    work: {
      'sign-in': {
        work: { data: { id: 'sign-in', lane: 'feature', doc: { path: '.wheelhouse/work/sign-in.md', hash } } },
        ...(approval === null ? {} : { approval: { hash: approval ?? hash } }),
      },
    },
  };
  const worktree = path.join(checkout, '.claude', 'worktrees', 'sign-in');
  fs.mkdirSync(featurePaths(worktree).dir, { recursive: true });
  return { checkout, views, worktree, hash };
}

test('the approved document is read from the main checkout and checked against the approval\'s hash', () => {
  const { checkout, views, hash } = scene();
  assert.deepEqual(approvedDocument({ checkout, views, work: 'sign-in' }), { text: DESIGN, hash });
  // Work that names no document has none.
  assert.equal(approvedDocument({ checkout, views: { work: { other: { work: { data: { id: 'other' } } } } }, work: 'other' }), null);
  assert.equal(approvedDocument({ checkout, views, work: 'missing' }), null);
});

test('a document changed since its approval, or gone, is not the approved one', () => {
  const changed = scene({ text: `${DESIGN}\nA line added later.\n` });
  assert.match(approvedDocument({ checkout: changed.checkout, views: changed.views, work: 'sign-in' }).problem, /changed/);
  const gone = scene();
  fs.rmSync(path.join(gone.checkout, '.wheelhouse', 'work', 'sign-in.md'));
  assert.match(approvedDocument({ checkout: gone.checkout, views: gone.views, work: 'sign-in' }).problem, /can't be read/);
  // The approval's hash rules over the work event's, when both are there.
  const other = scene({ approval: 'a'.repeat(64) });
  assert.match(approvedDocument({ checkout: other.checkout, views: other.views, work: 'sign-in' }).problem, /changed/);
  // Work that starts with no approval is checked against the work event's own hash.
  const unapproved = scene({ approval: null });
  assert.equal(approvedDocument({ checkout: unapproved.checkout, views: unapproved.views, work: 'sign-in' }).hash, unapproved.hash);
});

test('a document path that leaves the main checkout is refused', () => {
  const { checkout, views } = scene();
  views.work['sign-in'].work.data.doc.path = '../elsewhere.md';
  assert.match(approvedDocument({ checkout, views, work: 'sign-in' }).problem, /outside/);
});

test('placing the document writes it into the feature folder once, and again only when it differs', () => {
  const { worktree } = scene();
  assert.equal(approvedPath(worktree), path.join(featurePaths(worktree).dir, APPROVED_FILE));
  assert.equal(placeApproved(worktree, DESIGN), true);
  assert.equal(fs.readFileSync(approvedPath(worktree), 'utf8'), DESIGN);
  assert.equal(placeApproved(worktree, DESIGN), false);
  fs.writeFileSync(approvedPath(worktree), 'The session changed it.\n');
  assert.equal(placeApproved(worktree, DESIGN), true);
  assert.equal(fs.readFileSync(approvedPath(worktree), 'utf8'), DESIGN);
});

test('placing refuses a feature folder that is a link out of the worktree', { skip: process.platform === 'win32' }, () => {
  const { worktree } = scene();
  const elsewhere = tempFolder('wh-elsewhere-');
  fs.rmSync(featurePaths(worktree).dir, { recursive: true });
  fs.symlinkSync(elsewhere, featurePaths(worktree).dir);
  assert.throws(() => placeApproved(worktree, DESIGN), /feature folder/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});
