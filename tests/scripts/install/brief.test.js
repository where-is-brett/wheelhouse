// tests/scripts/install/brief.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { briefDir, readBrief, writeBrief } from '../../../scripts/install/brief.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

function goodBrief(folder) {
  return {
    v: 1,
    folder,
    host: 'github',
    computers: [{ label: 'The Mac', id: '0a1b2c3d' }, { label: 'A Windows computer', id: null }],
    answers: { product: 'A made-up stock list for a small bookshop', liveData: true, realUsers: false },
    protection: 'standard',
    connection: 'narrow',
    firstVersion: [
      { kind: 'skill', name: 'ship-brief', path: '.claude/skills/ship-brief' },
      { kind: 'agent', name: 'builder-one', path: '.claude/agents/builder-one.md' },
      { kind: 'agent', name: 'reviewer-one', path: '.claude/agents/reviewer-one.md' },
    ],
    copies: [{ name: 'drafting', path: '.claude/skills/drafting', plugin: 'kit-a' }],
    keep: [{ name: 'reviewing', path: '.claude/skills/reviewing', why: 'same name, own content' }],
    inFlight: { behind: 0, dirty: false, prs: [{ number: 7, branch: 'feature/stock-count' }], worktrees: [{ path: path.join(folder, '..', 'wt'), branch: null, dirty: true }] },
    deniedAfterSwitchBack: ['gh pr merge --squash'],
    plugins: { off: [{ id: 'chart-kit@synced', why: 'not used by this project' }], skillsOff: [{ name: 'letter-writer', why: 'personal letters' }] },
    docsToAlign: [{ file: 'README.md', line: 3 }],
  };
}

const projectFolder = () => path.join(tempFolder('wh-brief-'), 'lantern-shop');

test('a brief is written outside the repository and read back as it was', () => withHome((home) => {
  const folder = projectFolder();
  assert.equal(readBrief(folder), null);
  const brief = goodBrief(folder);
  writeBrief(brief);
  const dir = briefDir(folder);
  assert.ok(dir.startsWith(path.join(home, 'install') + path.sep));
  assert.match(path.basename(dir), /^lantern-shop-[0-9a-f]{8}$/);
  assert.ok(fs.existsSync(path.join(dir, 'brief.json')));
  assert.deepEqual(readBrief(folder), brief);
  // Two projects with the same folder name never share a brief.
  assert.notEqual(briefDir(projectFolder()), dir);
}));

test('a brief with a missing or mistyped key is refused, naming the key', () => withHome(() => {
  const folder = projectFolder();
  const cases = [
    [(b) => { delete b.answers.liveData; }, /answers\.liveData/],
    [(b) => { b.inFlight.behind = '2'; }, /inFlight\.behind/],
    [(b) => { b.firstVersion[1].kind = 'macro'; }, /firstVersion\[1\]\.kind/],
    [(b) => { delete b.protection; }, /protection/],
    [(b) => { b.computers[0].id = 'the-mac'; }, /computers\[0\]\.id/],
    [(b) => { b.plugins.skillsOff = {}; }, /plugins\.skillsOff/],
    [(b) => { b.docsToAlign[0].line = 0; }, /docsToAlign\[0\]\.line/],
    [(b) => { b.v = 2; }, /\bv\b/],
    [(b) => { b.extra = true; }, /extra/],
    [(b) => { b.protection = 'locked'; b.connection = 'quick'; }, /connection/],
  ];
  const file = path.join(briefDir(folder), 'brief.json');
  for (const [change, named] of cases) {
    const brief = goodBrief(folder);
    change(brief);
    assert.throws(() => writeBrief(brief), named);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(brief));
    assert.throws(() => readBrief(folder), named);
  }
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => readBrief(folder), /brief\.json/);
}));

test('a brief for another folder is refused', () => withHome(() => {
  const folder = projectFolder();
  const other = projectFolder();
  writeBrief(goodBrief(other));
  const file = path.join(briefDir(folder), 'brief.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(briefDir(other), 'brief.json'), file);
  assert.throws(() => readBrief(folder), /another folder/);
}));
