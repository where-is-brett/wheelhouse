// tests/scripts/install/cli.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeBrief } from '../../../scripts/install/brief.js';
import { cardLines, cloneUpstreams, main, NOT_READ, USAGE } from '../../../scripts/install/cli.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

// Points HOME and XDG_CONFIG_HOME at a scratch folder whose .gitconfig sends `from` to a place that
// holds nothing, for the length of `body`; never the real home.
async function withGlobalRewrite(from, body) {
  const home = tempFolder('wh-gitconfig-home-');
  fs.writeFileSync(path.join(home, '.gitconfig'), `[url "${tempFolder('wh-nowhere-').replace(/\\/g, '/')}"]\n\tinsteadOf = ${from.replace(/\\/g, '/')}\n`);
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = home;
  process.env.USERPROFILE = home;
  try { return await body(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function brief(folder) {
  return {
    v: 1,
    folder,
    host: 'github',
    computers: [{ label: 'The Mac', id: null }],
    answers: { product: 'A made-up stock list for a small bookshop', liveData: false, realUsers: false },
    protection: 'locked',
    connection: 'narrow',
    firstVersion: [
      { kind: 'skill', name: 'ship-brief', path: '.claude/skills/ship-brief' },
      { kind: 'agent', name: 'builder-one', path: '.claude/agents/builder-one.md' },
      { kind: 'agent', name: 'reviewer-one', path: '.claude/agents/reviewer-one.md' },
    ],
    copies: [{ name: 'drafting', path: '.claude/skills/drafting', plugin: 'kit-a' }],
    keep: [],
    inFlight: { behind: 2, dirty: true, onDefault: true, prs: [{ number: 7, branch: 'feature/stock-count' }], worktrees: [] },
    deniedAfterSwitchBack: ['gh pr merge --squash'],
    plugins: { off: [], skillsOff: [] },
    docsToAlign: [],
  };
}

test('the card names the answers and the counts, never a part', () => {
  const folder = path.join(tempFolder('wh-cli-'), 'lantern-shop');
  const text = cardLines(brief(folder)).join('\n');
  assert.match(text, /Locked, with the narrow connection to GitHub/);
  assert.match(text, /3 parts \(1 skill, 2 agents\)/);
  assert.match(text, /2 commits behind, local changes yes, 1 open request, 0 worktrees/);
  for (const name of ['ship-brief', 'builder-one', 'reviewer-one', 'drafting', 'stock-count', 'lantern-shop', 'gh pr merge']) assert.ok(!text.includes(name), name);
});

test('cli brief prints the card, or says no brief has been written', () => withHome(async () => {
  const folder = path.join(tempFolder('wh-cli-'), 'lantern-shop');
  const said = [];
  assert.equal(await main(['brief', folder], { write: (t) => said.push(t) }), 1);
  assert.match(said.join(''), /No brief has been written/);
  writeBrief(brief(folder));
  said.length = 0;
  assert.equal(await main(['brief', folder], { write: (t) => said.push(t) }), 0);
  assert.match(said.join(''), /The install card for this folder/);
}));

test('the upstreams are cloned bare into temporary folders and removed after', async () => {
  const upstream = tempFolder('wh-kit-');
  await g(upstream, 'init', '--quiet', '-b', 'main');
  await g(upstream, 'commit', '--quiet', '--allow-empty', '-m', 'one');
  const { clones, remove } = await cloneUpstreams({ upstreams: [{ name: 'kit-a', repo: upstream }] });
  assert.equal(await g(clones['kit-a'], 'rev-parse', '--is-bare-repository'), 'true');
  remove();
  assert.equal(fs.existsSync(clones['kit-a']), false);
});

test('the upstream clone never reads the director\'s global git config', async () => {
  const upstream = tempFolder('wh-kit-');
  await g(upstream, 'init', '--quiet', '-b', 'main');
  await g(upstream, 'commit', '--quiet', '--allow-empty', '-m', 'one');
  await withGlobalRewrite(upstream, async () => {
    const { clones, remove } = await cloneUpstreams({ upstreams: [{ name: 'kit-a', repo: upstream }] });
    assert.equal(await g(clones['kit-a'], 'log', '--format=%s'), 'one');
    remove();
  });
});

test('cli survey prints scheduled as null and says to pass --scheduled when no list is given', async () => {
  const folder = path.join(tempFolder('wh-cli-'), 'lantern-shop');
  fs.mkdirSync(folder);
  await g(folder, 'init', '--quiet', '-b', 'main');
  await g(folder, 'commit', '--quiet', '--allow-empty', '-m', 'start');
  const options = (out, err) => ({
    write: (t) => out.push(t), warn: (t) => err.push(t), manifest: { upstreams: [] }, clone: async () => ({ clones: {}, remove: () => {} }),
  });
  let out = [];
  let err = [];
  assert.equal(await main(['survey', folder], options(out, err)), 0);
  assert.equal(JSON.parse(out.join('')).scheduled, null);
  assert.equal(err.join(''), NOT_READ);
  assert.match(NOT_READ, /--scheduled/);

  const list = path.join(tempFolder('wh-cli-'), 'scheduled.json');
  fs.writeFileSync(list, JSON.stringify([{ name: 'weekly-stock', folder }]));
  out = [];
  err = [];
  assert.equal(await main(['survey', folder, '--scheduled', list], options(out, err)), 0);
  assert.deepEqual(JSON.parse(out.join('')).scheduled, [{ name: 'weekly-stock' }]);
  assert.equal(err.join(''), '');

  err = [];
  assert.equal(await main(['survey'], options(out, err)), 2);
  assert.match(err.join(''), /--scheduled/);
});

test('the usage says the brief takes each command the survey says Standard would refuse', () => {
  assert.match(USAGE, /deniedAfterSwitchBack/);
  assert.match(USAGE, /`command`/);
  assert.match(USAGE, /brief/);
});

// A project with one skill, `skillName`, under .claude/skills/.
async function projectWithSkill(skillName) {
  const folder = path.join(tempFolder('wh-cli-'), 'lantern-shop');
  const skill = path.join(folder, '.claude', 'skills', skillName);
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), `---\nname: ${skillName}\ndescription: A made-up skill.\n---\n\nDo it.\n`);
  await g(folder, 'init', '--quiet', '-b', 'main');
  await g(folder, 'add', '--all');
  await g(folder, 'commit', '--quiet', '-m', 'start');
  return folder;
}

const KITS = {
  upstreams: [
    { name: 'kit-a', plugin: 'kit-a', repo: 'https://example.invalid/kit-a.git', folders: [{ path: 'skills/drafting' }] },
    { name: 'kit-b', plugin: 'kit-b', repo: 'https://example.invalid/kit-b.git', folders: [{ path: 'skills/charting' }] },
  ],
};

test('cli survey clones only the upstreams whose skill names the project uses', async () => {
  const folder = await projectWithSkill('drafting');
  const asked = [];
  const clone = async (pins) => { asked.push(pins.upstreams.map((u) => u.name)); return { clones: { 'kit-a': folder }, remove: () => {} }; };
  const out = [];
  assert.equal(await main(['survey', folder], { write: (t) => out.push(t), warn: () => {}, manifest: KITS, clone }), 0);
  assert.deepEqual(asked, [['kit-a']]);
});

test('cli survey with no skill name in common clones nothing, so it works offline', async () => {
  const folder = await projectWithSkill('ship-brief');
  const out = [];
  // The real clone: example.invalid can never be reached, so any clone would fail.
  assert.equal(await main(['survey', folder], { write: (t) => out.push(t), warn: () => {}, manifest: KITS }), 0);
  const survey = JSON.parse(out.join(''));
  assert.deepEqual(survey.copies, []);
  assert.deepEqual(survey.skills.map((s) => s.name), ['ship-brief']);
});
