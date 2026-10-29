// tests/scripts/feature/brief.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBrief, amendBrief, implementLines } from '../../../scripts/feature/brief.js';
import { parseBrief, briefHash } from '../../../scripts/feature/files.js';
import { LANES } from '../../../scripts/lib/build-loop.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pluginRoot = path.join(path.sep, 'plugins', 'wheelhouse');

const FIVE_LINES = [
  'Implement the work described by the user in the spec or tickets.',
  'Use /tdd where possible, at pre-agreed seams.',
  'Run typechecking regularly, single test files regularly, and the full test suite once at the end.',
  'Once done, use /code-review to review the work.',
  'Commit your work to the current branch.',
].join('\n\n');

const fields = (lane = 'feature') => ({
  v: 1,
  work: 'login-page',
  lane,
  version: 1,
  goal: 'Let people sign in',
  done: ['Sign in works', 'A wrong password is refused'],
  appetite: { sessions: 2, tokens: 400000 },
  rulings: [{ id: 'r-1', words: 'Use the existing session store' }],
  routing: { builder: 'model-a', reviewer: 'model-b', reviewerCritical: 'model-c', tester: 'model-d', mechanical: 'model-e' },
  shownFirst: false,
  plan: 'docs/plans/login.md',
  slices: 2,
});

const render = (lane, extra = {}) => renderBrief({ fields: { ...fields(lane), ...extra }, pluginRoot });

// The template files, less their path comment.
const template = (...parts) => fs.readFileSync(path.join(root, 'templates', 'brief', ...parts), 'utf8').replace(/^<!--[^\n]*-->\r?\n(\r?\n)?/, '');
const overrideText = () => template('override.md').trim();

// Everything after the override: the brief's own text.
const afterOverride = (text) => text.slice(text.indexOf(overrideText()) + overrideText().length);

const skillsIn = (text) => [...new Set(text.match(/\b(?:superpowers|mattpocock-skills):[a-z-]+/g) ?? [])].sort();

test('every brief carries the override whole, before any lane text', () => {
  for (const lane of LANES) {
    const text = render(lane);
    const { body } = parseBrief(text);
    assert.ok(body.trimStart().startsWith(overrideText()), `${lane}: the override opens the text after the JSON block`);
    assert.ok(text.indexOf(overrideText()) < text.indexOf('# Your lane'), `${lane}: before the lane section`);
    assert.ok(text.indexOf(overrideText()) < text.indexOf('# The goal'), `${lane}: before the goal`);
  }
});

test('the override opens with Wheelhouse\'s instructions first over another agent setup\'s', () => {
  const sentence = "Where instructions from another agent setup in this project differ from Wheelhouse's, Wheelhouse's come first; follow the project's own rules wherever they don't clash.";
  assert.ok(overrideText().startsWith(`# The Wheelhouse override\n\n${sentence}\n\n`));
  for (const file of ['skills/front-desk/SKILL.md', 'skills/foreman/SKILL.md']) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8').split(sentence).length, 2, `${file}: once`);
  }
});

test('each lane names the skills section 5.1 gives it, and no others', () => {
  const every = ['superpowers:verification-before-completion'];
  const review = ['superpowers:receiving-code-review', 'superpowers:requesting-code-review'];
  const allowed = {
    quick: [...every, 'mattpocock-skills:code-review', 'mattpocock-skills:tdd'],
    small: [...every, ...review, 'superpowers:executing-plans', 'superpowers:test-driven-development', 'superpowers:using-git-worktrees', 'superpowers:writing-plans'],
    feature: [
      ...every, 'superpowers:receiving-code-review',
      'superpowers:dispatching-parallel-agents', 'superpowers:subagent-driven-development', 'superpowers:systematic-debugging',
      'superpowers:test-driven-development', 'superpowers:using-git-worktrees', 'superpowers:writing-plans',
    ],
    bug: [...every, 'mattpocock-skills:code-review', 'mattpocock-skills:tdd', 'superpowers:systematic-debugging'],
  };
  for (const lane of LANES) {
    // The lane's text, with the override (which names skills unprefixed) cut out.
    const named = skillsIn(afterOverride(render(lane)));
    assert.deepEqual(named, [...allowed[lane]].sort(), lane);
  }
  // The lanes' own gaps, spelled out.
  assert.ok(!skillsIn(afterOverride(render('small'))).includes('superpowers:subagent-driven-development'));
  assert.ok(!skillsIn(afterOverride(render('quick'))).includes('superpowers:writing-plans'));
  assert.match(render('small'), /superpowers:using-git-worktrees[\s\S]*superpowers:writing-plans[\s\S]*superpowers:executing-plans/);
  assert.match(render('small'), /ask --kind extra-plan --plan/);
  assert.match(render('feature'), /wheelhouse:tester/);
  assert.match(render('feature'), /600 lines/);
});

test('the quick brief carries the five lines byte for byte', () => {
  const text = render('quick');
  assert.ok(text.includes(FIVE_LINES), 'the five lines, each its own paragraph');
  assert.equal(implementLines(), FIVE_LINES);
  assert.ok(text.indexOf('mattpocock-skills:tdd') < text.indexOf('mattpocock-skills:code-review'), 'tdd is started before code-review');
  assert.doesNotMatch(text, /implement:(begin|end)/, 'the markers are not in the brief');
  assert.doesNotMatch(afterOverride(text), /superpowers:(writing-plans|executing-plans)/, 'no plan');

  // The installed copy, line endings evened, is accepted; any other text is refused.
  assert.ok(renderBrief({ fields: fields('quick'), pluginRoot, implementText: `${FIVE_LINES}\n` }).includes(FIVE_LINES));
  assert.ok(renderBrief({ fields: fields('quick'), pluginRoot, implementText: `\n${FIVE_LINES.replace(/\n/g, '\r\n')}\r\n` }).includes(FIVE_LINES));
  assert.throws(() => renderBrief({ fields: fields('quick'), pluginRoot, implementText: FIVE_LINES.replace('regularly,', 'often,') }), /\/implement/);
  assert.throws(() => renderBrief({ fields: fields('quick'), pluginRoot, implementText: `${FIVE_LINES}\n\nPush it.` }), /\/implement/);
});

test('a plan waits for the foreman: the session ends its turn and builds when woken with build', () => {
  // The lane's numbered steps, each on one line.
  const steps = (lane) => afterOverride(render(lane)).split('\n').filter((line) => /^\d+\. /.test(line));
  for (const lane of ['small', 'feature']) {
    const all = steps(lane);
    const plan = all.findIndex((s) => /superpowers:writing-plans/.test(s));
    const wait = all.findIndex((s) => /end your turn without building/.test(s));
    const build = all.findIndex((s) => /superpowers:(executing-plans|subagent-driven-development)/.test(s));
    assert.ok(plan >= 0 && wait === plan + 1 && build === wait + 1, `${lane}: plan, then wait, then build`);
    assert.match(all[wait], /woken with `build`/, lane);
    assert.match(all[wait], /clashes, pace and dependencies/, lane);
    // The plan is recorded before the turn ends (ruling R87).
    assert.match(all[wait], /cli\.js" plan <the plan's path>`, then end your turn/, lane);
    assert.doesNotMatch(all[plan], /go on to building/, `${lane}: the plan step does not send it straight to building`);
    assert.doesNotMatch(afterOverride(render(lane)), /If you are told the foreman is checking/, lane);
  }
  // In the feature lane, each slice's plan waits the same way.
  assert.match(steps('feature').find((s) => /slice n\+1/.test(s)), /woken with `build`/);
  assert.match(steps('feature').find((s) => /slice n\+1/.test(s)), /Once slice n's pull request is open, plan slice n\+1 and record its plan with `node ".*cli\.js" plan /);
  // The quick lane has no plan, and builds at once.
  assert.doesNotMatch(afterOverride(render('quick')), /`build`|end your turn without building/);
});

test("Matt's code-review runs with Wheelhouse's reviewer in the quick and bug lanes", () => {
  for (const lane of ['quick', 'bug']) {
    const rest = afterOverride(render(lane));
    const sentence = rest.split('\n').join(' ').split(/(?<=\.) /).find((s) => /code-review runs as it is written/.test(s));
    assert.ok(sentence, `${lane}: says how code-review's reviewers are dispatched`);
    assert.match(sentence, /`wheelhouse:reviewer`/);
    assert.match(sentence, /`reviewer` role/);
    assert.match(sentence, /`reviewerCritical`/);
    assert.match(sentence, /never as general-purpose subagents/);
  }
});

test('the installed /implement copy, laid out as Matt\'s file is, is accepted', () => {
  // The body after the front matter: a leading blank line, and a blank line between the five paragraphs.
  const installed = `\n${FIVE_LINES}\n`;
  for (const text of [installed, installed.replace(/\n/g, '\r\n')]) {
    for (const lane of ['quick', 'bug']) {
      assert.ok(renderBrief({ fields: fields(lane), pluginRoot, implementText: text }).includes(FIVE_LINES), lane);
    }
  }
  // A lane that does not carry the lines never reads them.
  assert.ok(renderBrief({ fields: fields('small'), pluginRoot, implementText: 'anything' }).includes('Let people sign in'));
});

test("the bug brief starts systematic-debugging and never Matt's diagnosing-bugs", () => {
  for (const lane of LANES) assert.doesNotMatch(render(lane), /diagnosing-bugs/, lane);
  const text = render('bug');
  assert.match(text, /superpowers:systematic-debugging/);
  assert.match(text, /with `ask` that says what is missing/, 'cannot reproduce goes to ask');
  assert.match(text, /`blocked`/, 'works as designed reports blocked');
  assert.match(text, /`partial`/, 'a bigger cause reports partial');
  assert.ok(text.includes(FIVE_LINES), 'a one-step cause carries on with the quick lane loop');
  assert.match(text, /regression test/);
});

test('no brief tells the session to use AskUserQuestion, merge, or wait for a menu', () => {
  for (const lane of LANES) {
    const rest = afterOverride(render(lane));
    for (const line of rest.split('\n')) {
      if (/AskUserQuestion/.test(line)) assert.match(line, /\b[Nn]ever\b/, `${lane}: ${line}`);
      // The conflict rule's own words (merge the default branch into your branch) are the one
      // sanctioned use of "merge"; any other line that mentions it must forbid it.
      if (/\bmerge\b/i.test(line.replace(/[a-z-]+:[a-z-]+/g, '').replace('merge the default branch into your branch', ''))) assert.match(line, /\b[Nn]ever\b|\bdo not\b|\bdon't\b|\bnot\b/, `${lane}: ${line}`);
      if (/\bmenu\b/i.test(line)) assert.match(line, /\b[Nn]o\b|\b[Nn]ever\b|\bnot\b/, `${lane}: ${line}`);
      assert.doesNotMatch(line, /finishing-a-development-branch/, lane);
    }
    assert.match(rest, /AskUserQuestion/, `${lane}: says plainly not to use it`);
    assert.match(rest, /node "[^"]*cli\.js" ask /, `${lane}: how to ask`);
    assert.match(rest, /node "[^"]*cli\.js" open-pr --title/, `${lane}: how to open the pull request`);
    assert.match(rest, /node "[^"]*cli\.js" report/, `${lane}: how to report`);
  }
});

test('every brief tells the session how to dispatch a reviewer: the diff file, the commit and the pull request', () => {
  for (const lane of LANES) {
    const text = afterOverride(render(lane));
    assert.match(text, /before each `wheelhouse:reviewer` dispatch, write the diff under review to `\.wheelhouse\/feature\/review\/<n>\.diff`/i, lane);
    assert.match(text, /full commit hash of the head it reviews/, lane);
    assert.match(text, /pull request number once the feature's pull request is open \(`pr: none` before then\)/, lane);
  }
});

test('every brief has the signed review of the pull request\'s head dispatched once open-pr gives its number, and after each pushed fix (I6)', () => {
  for (const lane of LANES) {
    const text = afterOverride(render(lane));
    const finish = text.slice(text.indexOf('# How to finish'), text.indexOf('# Models by role'));
    const flat = finish.replace(/\s+/g, ' ');
    assert.match(flat, /Once `open-pr` prints the pull request's number \(#n\), dispatch `wheelhouse:reviewer` on its head commit with `pr: n`/, lane);
    assert.match(flat, /fix them, push with `node "[^"]+[\\/]scripts[\\/]feature[\\/]cli\.js" push` \(when it says the host's branch has moved on, bring it in with `node "[^"]+[\\/]scripts[\\/]feature[\\/]cli\.js" pull`, then push again\), and dispatch `wheelhouse:reviewer` again on the new head with `pr: n`/, lane);
    // The gate's update is brought in with the helper's pull: the session has no key to pull with (I1).
    assert.match(flat, /`review-needed`: the gate brought the branch up to date and the review didn't carry over\), bring the host's branch in with `node "[^"]+[\\/]scripts[\\/]feature[\\/]cli\.js" pull`, then dispatch/, lane);
    assert.doesNotMatch(flat, /pull the branch/, lane);
    assert.match(flat, /`open-pr` refuses until the report passes\. It pushes your branch through the host helper, then opens the pull request from it\./, lane);
    assert.match(flat, /signed review/, lane);
    // Each lane's own finish names the same steps, in order: the report, open-pr, then the reviewer on the head.
    const laneText = text.slice(text.indexOf('# Your lane'), text.indexOf('# Rules in every lane')).replace(/\s+/g, ' ');
    const finishing = laneText.slice(laneText.lastIndexOf('How to finish'));
    const at = (needle) => finishing.indexOf(needle);
    assert.ok(at('How to finish') >= 0, `${lane}: its last step points to How to finish`);
    for (const [a, b] of [['`report`', '`open-pr`'], ['`open-pr`', '`wheelhouse:reviewer`']]) {
      assert.ok(at(a) >= 0 && at(b) > at(a), `${lane}: ${a} before ${b}: ${finishing}`);
    }
    assert.match(finishing, /`pr: n`/, lane);
  }
});

test('the report is brought up to date before each open-pr, never at a close no wake reaches (M3)', () => {
  for (const lane of LANES) {
    const text = afterOverride(render(lane));
    assert.doesNotMatch(text, /At the feature's close/, lane);
    assert.match(text.replace(/\s+/g, ' '), /Before each `open-pr`, bring `report\.md` up to date/, lane);
  }
  // The override's own finish names the report and the signed review too, its rule and quotes unchanged.
  const rule4 = overrideText().split(/^(?=\*\*\d\. )/m).find((s) => s.startsWith('**4. '));
  assert.match(rule4.replace(/\s+/g, ' '), /To finish, write the report and run `report`, open the pull request through the host helper \(`open-pr`\), have Wheelhouse's Lookout review its head, then own it until it merges\./);
  assert.match(rule4, /^> Overrides `writing-plans`: "link it for your human partner"$/m);
  assert.match(rule4, /^> Overrides `finishing-a-development-branch`: "1\. Merge back to <base-branch> locally"$/m);
});

test('the commands carry the real plugin root', () => {
  const text = render('small');
  assert.ok(text.includes(`node "${path.join(pluginRoot, 'scripts', 'feature', 'cli.js')}" ask`));
  assert.doesNotMatch(text, /\{\{|\}\}/, 'no placeholder is left');
  assert.throws(() => renderBrief({ fields: fields(), pluginRoot: 'a"b' }), /plugin root/);
  assert.throws(() => renderBrief({ fields: fields(), pluginRoot: '' }), /plugin root/);
});

test('the brief names the subagent roles and no model: the models and efforts come with each wake', () => {
  const whole = render('feature');
  // An older brief's routing is still read (its JSON block keeps it), and the text names none of it.
  const text = whole.slice(whole.indexOf('\n```\n') + 5);
  for (const model of ['model-a', 'model-b', 'model-c', 'model-d', 'model-e']) assert.ok(!text.includes(model), model);
  for (const role of ['builder', 'mechanical', 'builderCritical', 'reviewer', 'reviewerCritical', 'tester']) assert.match(text, new RegExp(`^- ${role} \\(`, 'm'), role);
  assert.match(text, /wheelhouse:builder/);
  assert.match(text, /wheelhouse:reviewer/);
  assert.match(text, /wheelhouse:tester/);
  assert.match(text, /come with each wake/);
  assert.match(text, /holds the same lines as its `column`/);
  assert.match(text, /`effort`/);
  const none = renderBrief({ fields: { ...fields('quick'), routing: {} }, pluginRoot });
  assert.ok(!/model-/.test(none), 'a new brief carries no models at all');
  assert.equal(none.slice(none.indexOf('# Models by role')), render('quick').slice(render('quick').indexOf('# Models by role')));

  // No model name sits in a template.
  for (const file of ['brief.md', 'override.md', 'lanes/quick.md', 'lanes/small.md', 'lanes/feature.md', 'lanes/bug.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'templates', 'brief', file), 'utf8'), /\b(opus|sonnet|haiku|fable|gpt|claude-\d)/i, file);
  }
});

test('the goal, the done contract, the appetite and the rulings are in the brief', () => {
  const text = render('small');
  assert.match(text, /Let people sign in/);
  assert.match(text, /1\. Sign in works\n2\. A wrong password is refused/);
  assert.match(text, /turn each line into a test before any code/i);
  assert.match(text, /2 sessions/);
  assert.match(text, /400000 tokens/);
  assert.match(text, /r-1: Use the existing session store/);
  assert.match(text, /docs\/plans\/login\.md/);
  const none = renderBrief({ fields: { ...fields('small'), rulings: [], plan: undefined, slices: undefined }, pluginRoot });
  assert.match(none, /No rulings apply/);
  // The JSON block is valid and unchanged by rendering.
  assert.deepEqual(parseBrief(text).fields, fields('small'));
  assert.throws(() => renderBrief({ fields: { ...fields(), lane: 'huge' }, pluginRoot }), /can't be read/);
});

test('a brief for work from a ready-made change says to read the change and the document first, and how the pull request begins', () => {
  const from = { sha: 'c'.repeat(40), ref: 'refs/wheelhouse/from/login-page' };
  const plain = render('feature');
  assert.doesNotMatch(plain, /ready-made change/);
  assert.doesNotMatch(plain, /Carries on/);

  const text = render('feature', { from });
  assert.deepEqual(parseBrief(text).fields.from, from);
  const said = 'This work starts from a ready-made change: your branch `feature/login-page` begins where that change stands. '
    + "Before anything else, read the change (`git diff origin/HEAD...HEAD`) and the work's document, and carry the work on from there. "
    + 'Push only through `open-pr` and `push`, which push your own branch; never push to the change\'s own branch.';
  assert.ok(text.includes(`\n${said}\n`), text);
  assert.doesNotMatch(text, /Carries on/);
  // It comes before the goal, so the session reads it first.
  assert.ok(text.indexOf(said) < text.indexOf('# The goal'));

  const carried = render('feature', { from: { ...from, request: 7 } });
  assert.ok(carried.includes(`\n${said} Begin your report's words, which become the pull request's body, with "Carries on #7."\n`), carried);

  for (const bad of [{ ...from, sha: 'short' }, { ...from, ref: 'refs/heads/x' }, { ...from, ref: 'refs/wheelhouse/from/another' }, { ...from, request: 0 }, { ...from, extra: 1 }]) {
    assert.throws(() => render('feature', { from: bad }), /can't be read/, JSON.stringify(bad));
  }
});

test('a brief for work with an approved document names it as the spec, to read first, in every lane', () => {
  for (const lane of LANES) {
    const plain = render(lane);
    assert.doesNotMatch(plain, /approved\.md/, `${lane}: no document, no section`);
    const text = render(lane, { approved: 'a'.repeat(64) });
    assert.equal(parseBrief(text).fields.approved, 'a'.repeat(64));
    const section = text.slice(text.indexOf('# What was asked for'), text.indexOf('# The goal'));
    assert.ok(text.indexOf('# What was asked for') > -1 && text.indexOf('# What was asked for') < text.indexOf('# The goal'), `${lane}: before the goal`);
    assert.match(section, /`\.wheelhouse\/feature\/approved\.md`/);
    assert.match(section, /it is the spec/i);
    assert.match(section, /Read it whole before anything else/);
    assert.match(section, /plan, your tasks and your questions follow it/);
    // The override still opens the text.
    assert.ok(parseBrief(text).body.trimStart().startsWith(overrideText()));
  }
});

test('an amended brief says what changed and has a new hash', () => {
  const original = render('feature');
  const now = '2026-10-19T03:04:05.000Z';
  const amended = amendBrief(original, { change: 'The director wants sign in by email only', now });
  const { fields: after, body } = parseBrief(amended);
  assert.equal(after.version, 2);
  assert.deepEqual({ ...after, version: 1 }, parseBrief(original).fields);
  // The override stays first and whole; the section follows it, before the work and the goal.
  assert.ok(body.trimStart().startsWith(overrideText()), 'the override still opens the text');
  const afterTheOverride = body.trimStart().slice(overrideText().length);
  assert.match(afterTheOverride, /^\n\n# What changed\n\n- 19 October 2026 \(version 2\): The director wants sign in by email only\n\n# The work\n/);
  assert.ok(body.indexOf('# What changed') < body.indexOf('# The goal'));
  assert.equal(body.match(/# What changed/g).length, 1);
  assert.notEqual(briefHash(amended), briefHash(original));

  // A second amendment adds to the same section, newest first, still after the override.
  const again = amendBrief(amended, { change: 'Drop the second slice', now: '2026-10-20T00:00:00Z' });
  const second = parseBrief(again);
  assert.equal(second.fields.version, 3);
  assert.ok(second.body.trimStart().startsWith(overrideText()));
  assert.equal(second.body.match(/# What changed/g).length, 1);
  assert.ok(second.body.trimStart().slice(overrideText().length).startsWith('\n\n# What changed\n\n- 20 October 2026 (version 3): Drop the second slice\n- 19 October 2026 (version 2): The director wants sign in by email only\n\n# The work\n'));
  assert.ok(second.body.indexOf('# What changed') < second.body.indexOf('# The goal'));
  assert.ok(second.body.includes(overrideText()), 'the override is still whole');
  assert.equal(second.body.slice(second.body.indexOf('# The work')), body.slice(body.indexOf('# The work')), 'the rest of the text is unchanged');

  assert.throws(() => amendBrief('not a brief', { change: 'x', now }), /can't be read/);
  assert.throws(() => amendBrief(original, { change: '', now }), /change/);
  assert.throws(() => amendBrief(original, { change: 'x', now: 'yesterday' }), /time/);
});

// --- Build commands on Windows (design section 12.2) ---

const CLI = `node "${path.join(pluginRoot, 'scripts', 'feature', 'cli.js')}"`;
const ASK_WORDS = `Before your first build command, ask for every one you will need at once with \`${CLI} ask --kind build-command --command "<command>" …\`, then end your turn. A refused command means the grant has ended: ask again.`;
const RUNNER = "'C:/Users/me/.wheelhouse/windows/low-node/node.exe' 'C:/plugins/wheelhouse/scripts/windows/guarded.js'";
const GUARDED_WORDS = `Run every build command through \`${RUNNER}\`, for example \`${RUNNER} npm test\`, except local git. Local git (\`git status\`, \`git add\`, \`git commit\` and the rest) doesn't go through it, and nor does a command that fetches new code: each is asked for like any build command. Before your first one, ask for every one you will need at once with \`${CLI} ask --kind build-command --command "<command>" …\`, then end your turn; once granted, run it directly, not through the runner. If the runner says it isn't at low integrity, stop using it, and ask for every build command you will need in the same way.`;
const windows = (windowsBuilds, lane = 'small') => renderBrief({ fields: fields(lane), pluginRoot, windowsBuilds });

test('a Windows brief at ask tells the session to ask for its build commands at once', () => {
  for (const lane of LANES) {
    const text = windows({ level: 'ask', guardedCommand: null }, lane);
    assert.ok(text.includes(ASK_WORDS), lane);
    // Not now holds the feature: the session ends its turn and waits.
    assert.match(text, /On \*\*Not now\*\* the feature waits[^\n]*end your turn and wait/);
    assert.ok(!text.includes('Run every build command through'), lane);
    assert.doesNotMatch(text, /\{\{|\}\}|<!--/, 'no placeholder or marker is left');
    assert.equal(text.split(ASK_WORDS).length, 2, 'said once');
  }
  // A level that can't be read, or Guarded with no runner to name, is Ask.
  for (const odd of [{ level: 'bogus' }, {}, 'ask', { level: 'guarded', guardedCommand: null }, { level: 'guarded', guardedCommand: 'a`b' }, { level: 'guarded', guardedCommand: 'a\nb' }]) {
    const text = windows(odd);
    assert.ok(text.includes(ASK_WORDS), JSON.stringify(odd));
    assert.ok(!text.includes('Run every build command through'), JSON.stringify(odd));
  }
});

test('a Windows brief at guarded gives the runner\'s exact command', () => {
  const text = windows({ level: 'guarded', guardedCommand: RUNNER });
  assert.ok(text.includes(GUARDED_WORDS), text);
  assert.ok(!text.includes('Before your first build command'));
  assert.doesNotMatch(text, /\{\{|\}\}|<!--/);
  // The runner's command is put in as it is, never filled again.
  const odd = windows({ level: 'guarded', guardedCommand: 'run {{cli}}' });
  assert.ok(odd.includes('`run {{cli}} npm test`'));
});

test('the brief says nothing new off Windows', () => {
  const off = render('small');
  assert.equal(windows(null), off);
  assert.equal(windows(undefined), off);
  assert.ok(!off.includes('build-command') && !off.includes('Build commands on Windows'));
  assert.doesNotMatch(off, /<!--/);
});

// Unattended can be turned off mid-feature, and the waker reads the level at every run.
const REFUSED_WORDS = ASK_WORDS.replace('Before your first build command', 'If a build command is refused');

test('a Windows brief at unattended says to ask for build commands if one is refused', () => {
  for (const lane of LANES) {
    for (const guardedCommand of [null, RUNNER]) {
      const text = windows({ level: 'unattended', guardedCommand }, lane);
      assert.ok(text.includes(REFUSED_WORDS), lane);
      assert.equal(text.split('Build commands on Windows').length, 2, 'one paragraph');
      assert.ok(!text.includes('Before your first build command'), lane);
      assert.ok(!text.includes('Run every build command through'), lane);
      assert.match(text, /On \*\*Not now\*\* the feature waits/);
      assert.doesNotMatch(text, /\{\{|\}\}|<!--/);
    }
  }
});

const SESSION_WORDS = 'Here a build command is allowed only by a click in this session itself, so no card can grant one. Before your first build command, ask once with the `ask` below, naming the commands and telling the director to open this session (login-page) and click Allow there when it asks; then end your turn. When woken, run them, and never ask again for a command you have asked about.';

test('a Windows brief at watcher Shape 2 says to ask the director once to click Allow in the session, at every level', () => {
  for (const level of ['ask', 'unattended', 'guarded', 'bogus']) {
    const text = windows({ level, guardedCommand: RUNNER, shape: 2 });
    assert.ok(text.includes(SESSION_WORDS), level);
    assert.ok(!text.includes('--kind build-command'), `${level}: no card grants here`);
    assert.ok(!text.includes('the grant has ended: ask again'), `${level}: never asks again`);
    assert.ok(!text.includes('Run every build command through'), level);
    assert.equal(text.split('Build commands on Windows').length, 2, 'one paragraph');
    assert.doesNotMatch(text, /\{\{|\}\}|<!--/);
  }
  // Shape 1, or no shape given, keeps the card.
  assert.ok(windows({ level: 'ask', guardedCommand: null, shape: 1 }).includes(ASK_WORDS));
  assert.ok(!windows({ level: 'ask', guardedCommand: null, shape: 1 }).includes(SESSION_WORDS));
});

test('every brief says how to test when the whole suite runs longer than one command may', () => {
  const text = fs.readFileSync(new URL('../../../templates/brief/brief.md', import.meta.url), 'utf8');
  assert.match(text, /\*\*Long test runs\.\*\* One command runs for at most ten minutes, .* the pull request's checks run all of it/);
});
