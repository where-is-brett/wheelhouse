// tests/scripts/measures/baseline.test.js
// The baseline from the private note: the first version's cost per merged pull request, as the
// director gives the note's figures at the front desk. `cli.js baseline` asks the helper, which
// reads the figures back on a card; only the director's signed click on that card writes
// <wheelhouseHome()>/measures/baseline.json, and the figures go nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { noteBaseline, readBaseline } from '../../../scripts/measures/baseline.js';
import { main } from '../../../scripts/measures/cli.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { decide } from '../../../scripts/hooks/prompt-record.js';
import { decide as cardCheck } from '../../../scripts/hooks/card-check.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { BASELINE_WAIT_MS } from '../../../scripts/lib/setup-numbers.js';
import { readPending, holdsFigures, CARRIES_BASELINE } from '../../../scripts/lib/measures-clicks.js';
import { sendPending, pendingDir } from '../../../scripts/hooks/pending.js';
import { makeSigningKey, enrol } from '../../../scripts/state/signing.js';
import { makeEvent, writeEvent, listEvents, carriesBaseline } from '../../../scripts/state/events.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { LOCAL_PATHS } from '../../helpers/git-fixture.js';

const T0 = new Date('2026-10-19T03:00:00.000Z');
// Made-up figures, each distinctive enough to search a home for.
const COUNTED = 'Counted by the zebra-lantern tally of every builder session in the note, at list prices';
const FIGURES = { usd: 4127.35, merges: 37, from: '2026-08-03', to: '2026-09-28', counted: COUNTED };
const ARGS = ['baseline', '--usd', '4127.35', '--merges', '37', '--from', '2026-08-03', '--to', '2026-09-28', '--counted', COUNTED];
// 4127.35 / 37 is 111.55.
const MARKS = ['4127.35', 'zebra-lantern', '111.55'];

// Runs the command with a client, and gives back its exit code and what it wrote.
async function run(argv, client) {
  let out = '';
  let err = '';
  const code = await main(argv, { client, out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
}

// The director answering a card with one label, as Claude Code gives the prompt record a click.
function answered(cards, cwd) {
  const answers = Object.fromEntries(cards.map(([card, label]) => [card.question, label]));
  return {
    cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: cards.map(([card]) => card), answers },
    tool_response: { answers },
  };
}

// A helper client for the prompt record that keeps every request and takes it.
function spy() {
  const calls = [];
  const take = (name) => async (body) => { calls.push([name, body]); return { ok: true }; };
  return {
    calls,
    prState: take('prState'),
    state: { write: take('state.write'), record: take('state.record') },
    profile: { record: take('profile.record') },
  };
}

// Every file under `dir`, as full paths.
function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const git = (cwd, args) => {
  const got = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(got.status, 0, got.stderr);
  return got.stdout.trim();
};

// Runs fn with a scratch home, this computer's signing key enrolled and a helper started on it,
// whose clock reads T0 until fn moves it with `setClock`.
async function withHelper(fn) {
  const home = shortHome();
  let clock = T0;
  await as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-19T00:00:00.000Z' });
    const helper = await startHelper({ address: testAddress(home), adapterFor: async () => ({}), envFor: async () => ({}), now: () => clock });
    try {
      await fn({ home, client: helperClient({ address: helper.address }), setClock: (at) => { clock = at; } });
    } finally {
      await helper.close();
    }
  });
}

test('the note\'s cost and count give the cost per merge, with how the note counted', () => {
  const baseline = noteBaseline({ ...FIGURES, now: () => T0 });
  assert.deepEqual(baseline, {
    usdPerMerge: 4127.35 / 37,
    merges: 37,
    from: '2026-08-03',
    to: '2026-09-28',
    method: 'note',
    counted: COUNTED,
    recordedAt: '2026-10-19T03:00:00.000Z',
  });
  assert.equal(Math.round(baseline.usdPerMerge * 100) / 100, 111.55);
  // One day is a period too, and the account of how it counted is kept on one line.
  const oneDay = noteBaseline({ ...FIGURES, from: '2026-09-01', to: '2026-09-01', counted: '  Every session,\n at list prices.  ', now: () => T0 });
  assert.equal(oneDay.counted, 'Every session, at list prices.');
});

test('a missing figure, a zero count or dates the wrong way round are refused', async () => {
  const refused = (over, pattern) => assert.throws(() => noteBaseline({ ...FIGURES, ...over, now: () => T0 }), pattern);
  refused({ usd: undefined }, /cost/);
  refused({ usd: Number.NaN }, /cost/);
  refused({ usd: -1 }, /cost/);
  refused({ usd: 0 }, /cost/);
  refused({ merges: undefined }, /merged/);
  refused({ merges: 0 }, /merged/);
  refused({ merges: -3 }, /merged/);
  refused({ merges: 2.5 }, /merged/);
  refused({ from: undefined }, /from/);
  refused({ to: '28 September 2026' }, /to/);
  refused({ from: '2026-02-30' }, /from/);
  refused({ from: '2026-09-29', to: '2026-09-28' }, /after/);
  refused({ counted: undefined }, /counted/);
  refused({ counted: '   ' }, /counted/);
  // The refusal never repeats a figure.
  try {
    noteBaseline({ ...FIGURES, from: '2026-09-29', now: () => T0 });
  } catch (error) {
    for (const mark of [...MARKS, '2026-09-29', '2026-09-28']) assert.ok(!error.message.includes(mark), error.message);
  }

  // The command refuses before it asks the helper anything, and says so in one line without the figures.
  const asked = [];
  const client = { measures: { baseline: async (body) => { asked.push(body); return { ok: true, hash: 'a'.repeat(64), card: {} }; } } };
  const swap = (flag, value) => ARGS.map((a, i) => (ARGS[i - 1] === flag ? value : a));
  for (const argv of [swap('--merges', '0'), swap('--usd', 'lots'), swap('--from', '2026-10-01'), ARGS.slice(0, -2), [...ARGS, '--usd', '1'], [...ARGS, '--extra', 'x'], ['baseline'], ['other']]) {
    const got = await run(argv, client);
    assert.equal(got.code, 1, argv.join(' '));
    assert.equal(got.out, '');
    assert.match(got.err, /^[^\n]+\n$/, argv.join(' '));
    for (const mark of MARKS) assert.ok(!got.err.includes(mark), got.err);
  }
  assert.deepEqual(asked, [], 'nothing was asked for a wrong form or a refused figure');

  // The helper refuses them too, before any card is composed or any figure kept.
  await withHelper(async ({ home, client: real }) => {
    const got = await real.measures.baseline({ ...FIGURES, merges: 0 });
    assert.equal(got.ok, false);
    assert.match(got.refused, /merged/);
    const extra = await real.measures.baseline({ ...FIGURES, note: 'x' });
    assert.equal(extra.ok, false);
    assert.ok(!fs.existsSync(path.join(home, 'measures')) || filesUnder(path.join(home, 'measures')).length === 0);
  });
});

test('the baseline is written only after the director\'s click on the card that reads it back', async () => {
  await withHelper(async ({ home, client }) => {
    const cwd = tempFolder('wh-desk ');

    // The card reads the figures back in plain words, with two options.
    const shown = await run(ARGS, client);
    assert.equal(shown.code, 0, shown.err);
    const { hash, card } = JSON.parse(shown.out);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(card.options.map((o) => o.label), ['Record these', 'Not now']);
    for (const words of ['4127.35', '37 merged pull requests', '3 August 2026', '28 September 2026', '111.55', COUNTED]) {
      assert.ok(card.question.includes(words), words);
    }
    assert.equal(readBaseline(), null, 'nothing is recorded before the click');

    // Not now writes nothing, and the figures waiting are cleared.
    await decide(answered([[card, 'Not now']], cwd), { client: spy(), now: () => T0, projectOf: () => null });
    assert.equal(readBaseline(), null);
    assert.ok(!filesUnder(home).some((f) => MARKS.some((m) => fs.readFileSync(f, 'utf8').includes(m))), 'Not now clears the figures waiting');
    const afterNotNow = await run(['baseline', '--confirm', hash], client);
    assert.equal(afterNotNow.code, 1);

    // Shown again: refused without a click, and refused for a click on a reworded card.
    const again = JSON.parse((await run(ARGS, client)).out);
    const refused = await run(['baseline', '--confirm', again.hash], client);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /click/);
    const reworded = { ...again.card, question: again.card.question.replace('Record nothing', 'Keep nothing') };
    await decide(answered([[reworded, 'Record these']], cwd), { client: spy(), now: () => T0, projectOf: () => null });
    assert.equal((await run(['baseline', '--confirm', again.hash], client)).code, 1);
    assert.equal(readBaseline(), null);
    // A wrong hash is refused even with a click.
    await decide(answered([[again.card, 'Record these']], cwd), { client: spy(), now: () => T0, projectOf: () => null });
    assert.equal((await run(['baseline', '--confirm', 'b'.repeat(64)], client)).code, 1);
    assert.equal(readBaseline(), null);

    // The click on the card exactly as composed lets the helper write it, once.
    const recorded = await run(['baseline', '--confirm', again.hash], client);
    assert.equal(recorded.code, 0, recorded.err);
    assert.deepEqual(JSON.parse(recorded.out), { recorded: true });
    for (const mark of MARKS) assert.ok(!recorded.out.includes(mark));
    assert.deepEqual(readBaseline(), noteBaseline({ ...FIGURES, now: () => T0 }));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'measures', 'baseline.json'), 'utf8')), readBaseline());
    assert.equal((await run(['baseline', '--confirm', again.hash], client)).code, 1, 'a click is used once');
  });
});

test('the figures reach no state event', async () => {
  await withHelper(async ({ home, client }) => {
    // A registered project, with its state clone holding one commit, and the front desk in its folder.
    const P = 'o__p';
    const folder = tempFolder('wh-project ');
    git(folder, ['init', '-q']);
    writeProject(P, { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
    const state = stateDir(P);
    fs.mkdirSync(state, { recursive: true });
    git(state, ['init', '-q', '-b', 'wheelhouse-state']);
    fs.writeFileSync(path.join(state, 'README'), 'state\n');
    git(state, ['add', 'README']);
    git(state, ['commit', '-q', '-m', 'start']);
    const head = git(state, ['rev-parse', 'HEAD']);

    // cli -> helper -> card -> click -> write, with an ordinary question answered beside the card.
    const { hash, card } = JSON.parse((await run(ARGS, client)).out);
    const plain = { question: 'What this is: the colour of the export button.', header: 'Question', options: [{ label: 'Blue' }, { label: 'Green' }], multiSelect: false };
    const helper = spy();
    await decide(answered([[card, 'Record these'], [plain, 'Blue']], folder), { client: helper, now: () => T0 });
    const recorded = await run(['baseline', '--confirm', hash], client);
    assert.equal(recorded.code, 0, recorded.err);
    assert.notEqual(readBaseline(), null);

    // The prompt record was live in this project: it recorded the ordinary answer, and nothing of the card.
    assert.deepEqual(helper.calls.map(([name, body]) => [name, body.kind, body.data?.label]), [['state.write', 'card-answer', 'Blue']]);
    for (const mark of MARKS) assert.ok(!JSON.stringify(helper.calls).includes(mark), mark);

    // No state event and no write to the state branch.
    assert.deepEqual(listEvents(state, { report: () => {} }), []);
    assert.equal(git(state, ['rev-parse', 'HEAD']), head);
    assert.equal(git(state, ['status', '--porcelain']), '');

    // No file outside <home>/measures/ holds the figures: only the baseline itself does.
    const holding = [...filesUnder(home), ...filesUnder(folder)].filter((f) => {
      const text = fs.readFileSync(f, 'latin1');
      return MARKS.some((m) => text.includes(m));
    });
    assert.deepEqual(holding.map((f) => path.relative(home, f)), [path.join('measures', 'baseline.json')]);
    // The kept click and the shown record are there, and name the card by its hash only.
    assert.equal(fs.readdirSync(path.join(home, 'measures', 'clicks')).length, 1);
    assert.equal(fs.readdirSync(path.join(home, 'measures', 'shown')).length, 0, 'the shown record goes once the baseline is written');

    // The state itself refuses an event carrying the baseline card, should one ever be sent.
    for (const event of [
      makeEvent({ kind: 'card-answer', data: { question: card.question, label: 'Record these' }, now: () => T0 }),
      makeEvent({ kind: 'note', data: { text: card.question }, now: () => T0 }),
      makeEvent({ kind: 'note', data: { text: 'Record the private note\u2019s  FIGURES as the baseline' }, now: () => T0 }),
      makeEvent({ kind: 'note', data: { header: 'Baseline', text: `The note: ${COUNTED.toUpperCase()}` }, now: () => T0 }),
    ]) {
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: P, event, push: false, now: () => T0 }), /baseline/);
    }
    // The recorded baseline's account of how the note counted, on its own, is not refused: the net
    // is for a card in flight, not a lasting ban on those words.
    assert.equal(carriesBaseline(makeEvent({ kind: 'note', data: { text: `The note: ${COUNTED}` }, now: () => T0 }), { now: () => T0 }), false);
    assert.equal(git(state, ['rev-parse', 'HEAD']), head);
  });
});

// A registered project whose folder is a git repository, for the front desk to sit in.
function registered() {
  const P = 'o__p';
  const folder = tempFolder('wh-project ');
  git(folder, ['init', '-q']);
  writeProject(P, { folder, remoteUrl: 'https://example.com/o/p.git', host: 'github', repo: 'o/p', connection: {} });
  return { P, folder };
}

const asking = (questions, cwd) => ({ cwd, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions } });
const denied = (got) => got?.hookSpecificOutput?.permissionDecision === 'deny';

test('a reworded, stripped or look-alike baseline card is refused, and its figures reach no state write', async () => {
  await withHelper(async ({ client }) => {
    const { folder } = registered();
    const { card } = JSON.parse((await run(ARGS, client)).out);
    const rows = card.question.split('\n');
    const setLine = rows.find((r) => r.startsWith('Record the private note'));
    const variants = {
      'a typographic apostrophe in the set line': { ...card, question: card.question.replace(setLine, setLine.replace("note's", 'note’s')) },
      'the set line removed': { ...card, question: rows.filter((r) => r !== setLine).join('\n') },
      'the set line and reply code removed': { ...card, question: rows.filter((r) => r !== setLine && !r.startsWith('Reply code:')).join('\n') },
      'every fixed word rewritten, the figures kept': {
        question: `What this is: Your note says $4,127.35 for 37 pull requests.\nWhy it's coming to you: To compare.\nOptions: Record these: keep them; Not now: drop them\nMy recommendation: Record these, because they match.\nWhile you decide: Nothing happens.`,
        header: 'Figures',
        options: [{ label: 'Record these', description: 'Keep them.' }, { label: 'Not now', description: 'Drop them.' }],
        multiSelect: false,
      },
    };
    // The card exactly as composed passes the card check, in the project and anywhere else.
    assert.equal(await cardCheck(asking([card], folder), { now: () => T0 }), undefined);
    assert.equal(await cardCheck(asking([card], tempFolder('wh-desk ')), { now: () => T0 }), undefined);
    for (const [name, variant] of Object.entries(variants)) {
      const got = await cardCheck(asking([variant], folder), { now: () => T0 });
      assert.ok(denied(got), name);
      assert.match(got.hookSpecificOutput.permissionDecisionReason, /baseline card|private note/, name);
      // Were it asked all the same, nothing of it goes to the project, and no click is kept.
      const helper = spy();
      await decide(answered([[variant, 'Record these']], folder), { client: helper, now: () => T0 });
      assert.deepEqual(helper.calls, [], name);
      // And the state refuses it, should it ever be sent.
      const event = makeEvent({ kind: 'card-answer', data: { question: variant.question, label: 'Record these' }, now: () => T0 });
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event, push: false, now: () => T0 }), /baseline/, name);
    }
    assert.equal(fs.existsSync(path.join(process.env.WHEELHOUSE_HOME, 'measures', 'clicks')), false);
  });
});

test('the baseline card\'s words are refused on any other card', async () => {
  await withHelper(async () => {
    const { folder } = registered();
    const approval = {
      kind: 'approval', level: 3, what: 'Pull request #7 changes the sign-in page.', why: 'It is yours to decide.', recommend: 'Approve',
      because: 'the checks passed', meanwhile: 'Nothing is released.', options: [{ label: 'Approve', says: 'It goes ahead.' }], target: { pr: 7, sha: 'a'.repeat(40) },
    };
    composeCard(approval);
    for (const words of ['Record the private note\'s figures as the baseline', 'How the note counted: by hand.', 'Keep these figures on this computer as the baseline']) {
      assert.throws(() => composeCard({ ...approval, why: `It is yours to decide. ${words}` }), /baseline card's words/, words);
    }
    // The card check refuses an ordinary card using them, so its click can't be dropped unseen.
    const five = (what) => `What this is: ${what}\nWhy it's coming to you: It is yours.\nOptions: Blue: blue; Green: green\nMy recommendation: Blue, because it matches.\nWhile you decide: Nothing changes.`;
    const ordinary = { question: five('The export colour. How the note counted: by hand.'), header: 'Question', options: [{ label: 'Blue' }, { label: 'Green' }] };
    const reason = async (q) => (await cardCheck(asking([q], folder), { now: () => T0 }))?.hookSpecificOutput?.permissionDecisionReason;
    assert.match(await reason(ordinary), /baseline card/);
    // A card merely headed Baseline is not the baseline card.
    assert.equal(await reason({ ...ordinary, question: five('Which test run should be the baseline for speed?'), header: 'Baseline' }), undefined);
    assert.equal(await reason({ ...ordinary, question: five('The export colour.') }), undefined);
  });
});

test('figures waiting and the card that showed them are gone after a day', async () => {
  await withHelper(async ({ home, client, setClock }) => {
    const cwd = tempFolder('wh-desk ');
    const { hash, card } = JSON.parse((await run(ARGS, client)).out);
    const later = new Date(T0.getTime() + BASELINE_WAIT_MS + 1000);
    assert.notEqual(readPending({ now: () => T0 }), null);
    assert.equal(readPending({ now: () => later }), null);
    // A day on, the card is no longer the one shown: the card check refuses it, and a click on it is not kept.
    assert.ok(denied(await cardCheck(asking([card], cwd), { now: () => later })));
    await decide(answered([[card, 'Record these']], cwd), { client: spy(), now: () => later, projectOf: () => null });
    assert.equal(fs.existsSync(path.join(home, 'measures', 'clicks')), false);
    // The helper sweeps them away at its next request, and records nothing.
    setClock(later);
    assert.equal((await run(['baseline', '--confirm', hash], client)).code, 1);
    assert.equal(fs.existsSync(path.join(home, 'measures', 'pending.json')), false);
    assert.equal(fs.existsSync(path.join(home, 'measures', 'shown', 'baseline.json')), false);
    assert.equal(readBaseline(), null);
  });
});

test('figures changed on disk after the card was shown are not recorded', async () => {
  await withHelper(async ({ home, client }) => {
    const cwd = tempFolder('wh-desk ');
    const { hash, card } = JSON.parse((await run(ARGS, client)).out);
    const file = path.join(home, 'measures', 'pending.json');
    const pending = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...pending, figures: { ...pending.figures, merges: 38 } }));
    await decide(answered([[card, 'Record these']], cwd), { client: spy(), now: () => T0, projectOf: () => null });
    const got = await run(['baseline', '--confirm', hash], client);
    assert.equal(got.code, 1);
    assert.match(got.err, /not the figures waiting/);
    assert.equal(readBaseline(), null);
  });
});

test('the net catches the figures only while they wait, and only as the figures', async () => {
  await withHelper(async ({ client }) => {
    const { folder } = registered();
    const shown = await run(['baseline', '--usd', '1200', '--merges', '40', '--from', '2026-08-03', '--to', '2026-09-28', '--counted', 'merged PRs only'], client);
    assert.equal(shown.code, 0, shown.err);
    const { card } = JSON.parse(shown.out);
    const later = () => new Date(T0.getTime() + BASELINE_WAIT_MS + 1000);
    const waiting = () => T0;
    const note = (text, header) => makeEvent({ kind: 'note', data: { text, ...(header ? { header } : {}) }, now: () => T0 });

    // A whole sum under 1000 counts only in its cents form, and never inside a longer number.
    for (const text of ['The plan costs $30 a month', 'Raise the price to $30.50', 'It costs $300', 'Budget $1,200.99 for hosting', 'Spend 1200 or 30 on it']) {
      assert.equal(holdsFigures(text, { now: waiting }), false, text);
      assert.equal(carriesBaseline(note(text), { now: waiting }), false, text);
    }
    // While they wait, the figures as money, and the account of how the note counted, are caught.
    for (const text of ['Budget $1,200 for hosting', 'It is US$1200.00', 'Each was $30.00', 'merged PRs only, as before']) {
      assert.equal(holdsFigures(text, { now: waiting }), true, text);
      assert.equal(carriesBaseline(note(text), { now: waiting }), true, text);
      await assert.rejects(writeEvent({ env: LOCAL_PATHS, project: 'o__p', event: note(text), push: false, now: waiting }), /baseline/, text);
      // Once they are out of date, nothing is refused.
      assert.equal(holdsFigures(text, { now: later }), false, text);
      assert.equal(carriesBaseline(note(text), { now: later }), false, text);
    }

    // The card check: an ordinary card holding a waiting figure is told to leave it out; headed
    // Baseline with a figure, it reads as the baseline card; headed Baseline alone it passes.
    const five = (what) => `What this is: ${what}\nWhy it's coming to you: It is yours.\nOptions: Blue: blue; Green: green\nMy recommendation: Blue, because it matches.\nWhile you decide: Nothing changes.`;
    const ordinary = { header: 'Question', options: [{ label: 'Blue' }, { label: 'Green' }] };
    const reason = async (q, now = waiting) => (await cardCheck(asking([q], folder), { now }))?.hookSpecificOutput?.permissionDecisionReason;
    assert.match(await reason({ ...ordinary, question: five('Hosting at $1,200 a year.') }), /private note.*leave them out/);
    assert.match(await reason({ ...ordinary, question: five('Hosting at $1,200 a year.'), header: 'Baseline' }), /reads as the baseline card/);
    assert.equal(await reason({ ...ordinary, question: five('Which run is the baseline?'), header: 'Baseline' }), undefined);
    assert.equal(await reason({ ...ordinary, question: five('The plan costs $30 a month.') }), undefined);
    assert.equal(await cardCheck(asking([card], folder), { now: waiting }), undefined, 'the composed card itself passes');
    // Out of date, the figures count for nothing, and the card check sweeps them away.
    assert.equal(await reason({ ...ordinary, question: five('Hosting at $1,200 a year.') }, later), undefined);
    assert.equal(fs.existsSync(path.join(process.env.WHEELHOUSE_HOME, 'measures', 'pending.json')), false);
  });
});

test('a figure that isn\'t whole is caught bare too, but not inside a longer number', async () => {
  await withHelper(async ({ client }) => {
    assert.equal((await run(ARGS, client)).code, 0);
    const now = () => T0;
    for (const text of ['the total 4127.35 then', 'about 4,127.35', 'each 111.55']) assert.equal(holdsFigures(text, { now }), true, text);
    for (const text of ['14127.35', '4127.356', '4127.3', '1111.55', '111.555']) assert.equal(holdsFigures(text, { now }), false, text);
  });
});

const fiveParts = (what) => `What this is: ${what}\nWhy it's coming to you: It is yours.\nOptions: One: one; Two: two\nMy recommendation: One, because it fits.\nWhile you decide: Nothing changes.`;

test('a card showing the figures only in an option is refused, and its answer goes nowhere', async () => {
  await withHelper(async ({ client }) => {
    const { P, folder } = registered();
    assert.equal((await run(ARGS, client)).code, 0);
    const now = () => T0;
    const inLabel = { question: fiveParts('Which hosting plan?'), header: 'Question', options: [{ label: '$4,127.35 a year' }, { label: 'Cheaper' }], multiSelect: false };
    const inDescription = { ...inLabel, options: [{ label: 'One', description: 'It costs US$4127.35.' }, { label: 'Two' }] };
    for (const card of [inLabel, inDescription]) {
      const got = await cardCheck(asking([card], folder), { now });
      assert.match(got?.hookSpecificOutput?.permissionDecisionReason ?? '', /leave them out/);
    }
    // Asked all the same, neither answer, nor a typed one holding a figure, reaches the helper.
    const plain = { ...inLabel, question: fiveParts('Which colour?'), options: [{ label: 'Blue' }, { label: 'Green' }] };
    const helper = spy();
    await decide(answered([[inLabel, '$4,127.35 a year'], [inDescription, 'One'], [plain, 'About 4127.35, I think']], folder), { client: helper, now });
    assert.deepEqual(helper.calls, []);
    assert.equal(fs.existsSync(pendingDir(P)), false);
    // Nor does a card with a set line get a shown record, whose options would carry the figures.
    const { question: approval } = composeCard({
      kind: 'approval', level: 3, what: 'Pull request #7 changes the sign-in page.', why: 'It is yours to decide.', recommend: 'Approve',
      because: 'the checks passed', meanwhile: 'Nothing is released.', options: [{ label: 'Approve', says: 'It goes ahead.' }], target: { pr: 7, sha: 'a'.repeat(40) },
    });
    const withFigure = { ...approval, options: approval.options.map((o, i) => (i === 1 ? { ...o, description: 'Wait: hosting is $4,127.35.' } : o)) };
    const shownSpy = spy();
    await decide(answered([[withFigure, 'Not now']], folder), { client: shownSpy, now });
    assert.deepEqual(shownSpy.calls, []);
    const control = spy();
    await decide(answered([[approval, 'Not now']], folder), { client: control, now });
    assert.ok(control.calls.some(([name, body]) => name === 'state.record' && body.event.kind === 'shown'), 'the same card without the figure gets its shown record');
  });
});

test('a write the state refuses for carrying the baseline is dropped, never kept to send again', async () => {
  await withHelper(async () => {
    const { P, folder } = registered();
    const refusing = spy();
    refusing.state.write = async (body) => { refusing.calls.push(['state.write', body]); return { ok: false, refused: CARRIES_BASELINE }; };
    const plain = { question: fiveParts('Which colour?'), header: 'Question', options: [{ label: 'Blue' }, { label: 'Green' }], multiSelect: false };
    await decide(answered([[plain, 'Blue']], folder), { client: refusing, now: () => T0 });
    assert.equal(refusing.calls.length, 1, 'it was sent once');
    const left = fs.existsSync(pendingDir(P)) ? fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json')) : [];
    assert.deepEqual(left, [], 'and not kept');
    // A record already kept is dropped the same way, so a later send, once the figures lapse, has nothing to send.
    fs.mkdirSync(pendingDir(P), { recursive: true });
    fs.writeFileSync(path.join(pendingDir(P), 'x.json'), JSON.stringify({ route: 'write', body: { project: P, kind: 'card-answer', data: { question: 'q', label: 'l' } } }));
    assert.deepEqual(await sendPending(P, refusing), { sent: 1, kept: 0 });
    const later = spy();
    assert.deepEqual(await sendPending(P, later), { sent: 0, kept: 0 });
    assert.deepEqual(later.calls, []);
    // An ordinary refusal is still kept for the next try.
    const busy = spy();
    busy.state.write = async () => ({ ok: false, refused: 'the state is busy' });
    await decide(answered([[plain, 'Green']], folder), { client: busy, now: () => T0 });
    assert.equal(fs.readdirSync(pendingDir(P)).filter((n) => n.endsWith('.json')).length, 1);
  });
});

test('a Not now on the baseline card does not let another card on the same call carry the figures out', async () => {
  await withHelper(async ({ home, client }) => {
    const { folder } = registered();
    const { card } = JSON.parse((await run(ARGS, client)).out);
    const other = { question: fiveParts('Hosting costs US$4127.35 a year; which plan?'), header: 'Question', options: [{ label: 'One' }, { label: 'Two' }], multiSelect: false };
    const helper = spy();
    await decide(answered([[card, 'Not now'], [other, 'One']], folder), { client: helper, now: () => T0 });
    assert.equal(fs.existsSync(path.join(home, 'measures', 'pending.json')), false, 'Not now cleared the figures');
    assert.deepEqual(helper.calls, [], 'and neither answer went to the project');
  });
});

test('outside a project or setup folder, a card holding a waiting figure passes, but a reworded baseline card does not', async () => {
  await withHelper(async ({ client }) => {
    const elsewhere = tempFolder('wh-desk ');
    const { card } = JSON.parse((await run(ARGS, client)).out);
    const now = () => T0;
    const figure = { question: fiveParts('Hosting costs US$4127.35 a year; which plan?'), header: 'Question', options: [{ label: 'One' }, { label: 'Two' }], multiSelect: false };
    assert.equal(await cardCheck(asking([figure], elsewhere), { now }), undefined);
    const reworded = { ...card, question: card.question.replace("note's figures as the baseline", 'note’s figures as the baseline') };
    assert.match((await cardCheck(asking([reworded], elsewhere), { now }))?.hookSpecificOutput?.permissionDecisionReason ?? '', /reads as the baseline card/);
    // In a project the same figure card is refused.
    const { folder } = registered();
    assert.match((await cardCheck(asking([figure], folder), { now }))?.hookSpecificOutput?.permissionDecisionReason ?? '', /leave them out/);
  });
});
