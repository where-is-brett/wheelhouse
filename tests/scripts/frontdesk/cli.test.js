// tests/scripts/frontdesk/cli.test.js
// The front desk's one command, against a fake helper that keeps its events in memory and builds
// the views from them as the real one does.
import { test, after } from 'node:test';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { main, readInput, SEAT_WRITES, SEAT_REFUSAL, seatRefusal, RECORD_KINDS, needsApproval, MEANWHILE, CHECKS_UNSAID, RECENT_MS, RECENT_LEAD } from '../../../scripts/frontdesk/cli.js';
import { cardsDue } from '../../../scripts/hooks/board-context.js';
import { numberedWaiting } from '../../../scripts/board/model.js';
import { composeCard, whatProblem } from '../../../scripts/cards/compose.js';
import { buildViews } from '../../../scripts/state/views.js';
import { briefText, wholeBrief, BRIEF_WORDS_MOST } from '../../../scripts/state/brief.js';
import { makeEvent, dataHash, listEvents, confirmationFor, PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { deskCore } from '../../../scripts/desk/core.js';
import { levelWords } from '../../../scripts/settings/effective.js';
import { designWithSlices } from '../../helpers/slices.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { stateDir, computerId } from '../../../scripts/lib/paths.js';
import { SINCE_LEAD } from '../../../scripts/cards/panel-words.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { approveWorkLine, approvalLine, answerLine, chatCopy, ciPushLine, confirmLine, keepControlLine, LIFT_STOP, setLineOf } from '../../../scripts/state/card-lines.js';
import { writeJsonFile, runningFile, sessionFile } from '../../../scripts/watcher/waker.js';
import { setStop, stopState } from '../../../scripts/lib/stop.js';
import { decide as cardCheck, cardProblems } from '../../../scripts/hooks/card-check.js';
import { decide as promptRecord } from '../../../scripts/hooks/prompt-record.js';
import { answerInput } from '../../../scripts/cards/compose.js';
import { controlFilesNamed } from '../../../scripts/cards/build-loop.js';
import { plainWords, glossaryOf } from '../../../scripts/frontdesk/glossary.js';
import { boardModel } from '../../../scripts/board/model.js';
import { CARD } from '../../../scripts/lib/front-desk.js';
import { CLICK_MS } from '../../../scripts/lib/core-numbers.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS } from '../../../scripts/protection/windows-builds.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';
import { pendingDir } from '../../../scripts/hooks/pending.js';
import { SUGGEST, WHY, suggestedAt } from '../../../scripts/lib/calm-words.js';
import { answeredWords, subjectOf } from '../../../scripts/cards/answered.js';
import { takeSeat, holdsSeat } from '../../../scripts/lib/first-mate-seat.js';
import { projectOf } from '../../../scripts/hooks/kit.js';
import { takeHere } from '../../../scripts/lib/session-files.js';

// No host tool runs for real: the helper's runs go through this, and the log stays empty.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));

const FULL = 'abcdef1234567890abcdef1234567890abcdef12';
const DOC = 'fedcba9876543210'.repeat(4);
const NOW = new Date('2026-10-19T12:00:00.000Z');
const T = (n) => new Date(Date.UTC(2026, 9, 18, 0, 0, n));
const CWD = path.resolve('/projects/shop');
const STOP = { ok: false, refused: 'STOP is on' };
const SCRIPT = fileURLToPath(new URL('../../../scripts/frontdesk/cli.js', import.meta.url));

// A home with an enrolled signing key, for makeEvent and the views.
async function inHome(fn) {
  const home = path.join(tempFolder('wh-frontdesk-'), 'home');
  return as(home, async () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
    return fn();
  });
}

// The helper as the front desk sees it: every call is kept; writes make the event as /state/write
// does (a signed kind is refused) and the views are built from what is held. Under `stop` (true, or
// a function read on each request) every write is refused and the views say STOP is on, as the
// helper does under STOP. A pull request is open at `head`, unless `pr` answers for it. A write is
// made at `writeAt(n)`, the nth write's time. The desk's reads are the real desk's, over what is held.
function fakeHelper({ events = [], stop = false, head = FULL, pr, profile = {}, writeAt = T, names } = {}) {
  const held = [...events];
  const stopped = () => (typeof stop === 'function' ? stop() : stop);
  const calls = [];
  let tick = 100;
  const views = () => buildViews(held, readEnrolled(), { now: () => NOW });
  const writeAs = (kind, data, id) => {
    const made = makeEvent({ kind, data, now: () => writeAt((tick += 1)) });
    const event = id === undefined ? made : { ...made, id };
    held.push(event);
    return { ok: true, id: event.id, pushed: true };
  };
  // The views as the helper gives them, with the card events and the card answers when asked.
  const viewsAnswer = (body) => {
    const built = views();
    return {
      ok: true,
      views: built,
      ...(names === undefined ? {} : { names }),
      ...(stopped() ? { stop: true } : {}),
      ...(body.cards === true ? { cards: held.filter((e) => e.kind === 'card') } : {}),
      ...(body.answers === true ? { answers: held.filter((e) => e.kind === 'card-answer') } : {}),
    };
  };
  const source = {
    project: 'o__p',
    events: () => held,
    enrolled: () => readEnrolled(),
    views: async (body = {}) => viewsAnswer(body),
    profile: async () => ({ settings: profile }),
  };
  const client = {
    // The seat as the helper reads it: placed by the folder, the seat file in the test's home. Not a call the tests count.
    session: {
      seat: async (body) => {
        const found = projectOf(body.cwd);
        return found === null ? { ok: false, error: 'This folder is in no Wheelhouse project' } : { ok: true, holds: holdsSeat(found.project, body.session) };
      },
    },
    desk: {
      read: async (body) => {
        calls.push(['desk.read', { cwd: body.cwd, view: body.view, args: body.args }]);
        return deskCore({ source, recorder: {}, now: () => NOW }).read(body.view, body.args);
      },
      act: async (body) => {
        calls.push(['desk.act', { cwd: body.cwd, command: body.command, args: body.args }]);
        const recorder = { write: async ({ kind, data }) => writeAs(kind, data) };
        return deskCore({ source, recorder, now: () => NOW }).act(body.command, body.args, body.evidence);
      },
    },
    state: {
      write: async (body) => {
        calls.push(['write', body]);
        if (stopped()) return STOP;
        if (PROTECTED_KINDS.includes(body.kind)) return { ok: false, refused: 'a signed kind is recorded through /state/record, never written here' };
        return writeAs(body.kind, body.data, body.id);
      },
    },
    profile: {
      write: async (body) => {
        calls.push(['profile.write', body]);
        return stopped() ? STOP : { ok: true, id: 'p-1', pushed: true };
      },
    },
    prState: async (body) => {
      calls.push(['prState', body]);
      if (pr !== undefined) return pr(body.number);
      return { ok: true, result: { headSha: head, state: 'open', mergeable: 'clean' } };
    },
  };
  return { client, calls, held, views, writes: () => calls.filter(([name]) => name === 'write').map(([, body]) => body) };
}

// Runs one command; resolves with { code, out, err, json }.
async function run(helper, argv, input, opts) {
  return runWith(helper, argv, input, opts);
}
async function runWith(helper, argv, input, { cwd = CWD, ready, env, ask } = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd, client: helper.client, input, env: env ?? {}, ...(ready ? { columnsReady: ready } : {}), ...(ask ? { ask } : {}), now: () => NOW, out: (t) => { out += t; }, err: (t) => { err += t; },
  });
  let json;
  try { json = JSON.parse(out); } catch { json = undefined; }
  return { code, out, err, json };
}

const says = (label) => ({ label, says: `It ${label.toLowerCase()}s and goes ahead.` });
const PRODUCT = (n) => ({
  kind: 'question', level: 2, what: `Which name suits page ${n}?`, why: 'It is the wording users see.',
  options: [says('Plain'), says('Playful')], recommend: 'Plain', because: 'it reads quickest', meanwhile: 'The page keeps its old name.',
});
const APPROVAL = {
  kind: 'approval', level: 3, what: 'Pull request #7 changes the wording on the sign-in page.', why: 'It changes what users see.',
  options: [says('Approve')], recommend: 'Approve', because: 'the checks passed', meanwhile: 'Nothing is released.',
};
const cardEvent = (input, n) => makeEvent({ kind: 'card', data: composeCard(input).card, now: () => T(n) });
const QUESTION = {
  id: 'q-export-csv-1', work: 'export-csv', what: 'The export needs to know which separator to use.', why: 'It changes the file people download.',
  options: [{ label: 'Comma', says: 'Commas between values; opens in any spreadsheet.' }, { label: 'Tab', says: 'Tabs between values.' }],
  recommendation: 'Tab', level: 2,
};
// Typed replies are on by default; the tests of a decision asked in chat still hold the setting confirmed on, and the
// tests of the question picker hold it confirmed off. Made inside a test, once its home has a signing key.
const typedSet = (value) => {
  const setting = makeEvent({ kind: 'setting', data: { key: 'typedReplies', value, words: 'Answer decisions by typing' }, now: () => T(0) });
  return [setting, makeEvent({ ...confirmationFor(setting), now: () => new Date(T(0).getTime() + 1) })];
};
const typedOn = () => typedSet(true);
const typedOff = () => typedSet(false);
const questionEvent = (data = QUESTION, n = 5) => makeEvent({ kind: 'question', data, now: () => T(n) });

test('cards gives at most four questions and says how many are left', async () => {
  await inHome(async () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => cardEvent(PRODUCT(n), n));
    const helper = fakeHelper({ events: six });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.questions.length, CARD.questions);
    assert.equal(first.json.left, 2);
    // Oldest first within one rank, each as AskUserQuestion takes it.
    assert.deepEqual(first.json.questions.map((q) => q.question), six.slice(0, 4).map((e) => e.data.question));
    assert.equal(first.json.questions[0].multiSelect, false);
    assert.equal(first.json.questions[0].options[0].label, 'Plain');
    // The cards handed out are recorded as asked, so the next visit asks the rest.
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: six.slice(0, 4).map((e) => e.id) } }]);
    const second = await run(helper, ['cards']);
    assert.deepEqual(second.json.questions.map((q) => q.question), six.slice(4).map((e) => e.data.question));
    assert.equal(second.json.left, 0);
    const third = await run(helper, ['cards']);
    assert.deepEqual(third.json, { questions: [], left: 0 });
    assert.equal(helper.writes().length, 2, 'nothing handed out, nothing recorded');
    // Every request to the state names the folder, for the helper to place the project; the
    // director's profile, read for the explanations setting, has none to place.
    assert.ok(helper.calls.every(([name, body]) => body.cwd === CWD));
  });
});

test('the foreman\'s own question shows its options by their labels, never the commands they run, and names the foreman', async () => {
  await inHome(async () => {
    const own = {
      id: 'q-export-csv-1000001', work: 'export-csv', what: 'The work couldn\'t start: the host didn\'t answer.', why: 'Starting again is your call.',
      options: [
        { label: 'Try again', says: "act start export-csv --goal 'Export the report' --done 'A CSV downloads' --appetite-sessions 1 --appetite-tokens 1500000" },
        { label: 'Wait', says: 'waiting' },
      ],
      recommendation: 'Try again', level: 3,
    };
    const helper = fakeHelper({ events: [...typedOn(), questionEvent(own)] });
    const got = await run(helper, ['cards']);
    assert.equal(got.code, 0, got.err);
    // A question from the build is a decision: no picker card is handed out, and its message is shown by `decision show`.
    assert.deepEqual(got.json.questions, []);
    const shown = await run(helper, ['decision', 'show', '1']);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /B\. Wait\. Nothing more happens until you choose again/);
    assert.doesNotMatch(shown.out, /act start|--goal|appetite-tokens|session building/);
  });
});

const heldNote = (ids, n = 7) => makeEvent({ kind: 'note', data: { about: 'cards-waiting', count: ids.length, ids }, now: () => T(n) });

// A question that asks to run commands stays a card on the picker; every other question from the build is a decision in chat.
const BUILD_ASK = { ...QUESTION, options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })), recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test'] };

test('the front desk\'s cards pass over a held card until it is pulled', async () => {
  const question = questionEvent(BUILD_ASK);
  const helper = fakeHelper({ events: [EXPORT, question, heldNote([question.data.id])] });
  const held = await run(helper, ['cards']);
  assert.equal(held.code, 0);
  assert.deepEqual(held.json.questions, []);
  assert.equal(held.json.left, 0);
  assert.equal(held.json.heldBack, 1);
  assert.equal(cardWrites(helper).length, 1, 'it is a card all the same');
  const pulled = await run(helper, ['pull-cards']);
  assert.equal(pulled.code, 0);
  assert.equal(pulled.json.questions.length, 1);
  assert.equal(pulled.json.heldBack, undefined);
  assert.deepEqual(helper.writes().filter((w) => w.kind === 'note').at(-1).data, { about: 'cards-pulled', ids: [question.data.id] });
});

test('the session start counts no held card', async () => {
  const question = questionEvent();
  const helper = fakeHelper({ events: [EXPORT, question, heldNote([question.data.id])] });
  assert.equal(cardsDue(helper.views(), NOW), 0);
});

test('cards turns an open feature question into one answer card, once', async () => {
  await inHome(async () => {
    const answered = { ...QUESTION, id: 'q-login-1', work: 'login' };
    const answer = makeEvent({
      kind: 'action', now: () => T(7),
      data: { action: 'answer', question: 'as shown', questionId: 'q-login-1', questionHash: dataHash(answered), label: 'Comma' },
    });
    const helper = fakeHelper({ events: [...typedOn(), questionEvent(), questionEvent(answered, 6), answer] });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    const cards = helper.writes().filter((w) => w.kind === 'card');
    assert.equal(cards.length, 1, 'the answered question gets none');
    const card = cards[0].data;
    assert.equal(card.kind, 'answer');
    assert.equal(card.line, answerLine('q-export-csv-1'));
    assert.equal(card.level, 2);
    // It is a decision: nothing goes to the picker, and its message carries the question's own options and recommendation.
    assert.deepEqual(first.json.questions, []);
    const shown = await run(helper, ['decision', 'show', '1']);
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /A\. Comma\. Commas between values; opens in any spreadsheet\./);
    assert.match(shown.out, /B\. Tab \(recommended\)\. Tabs between values\./);
    assert.match(shown.out, /Recommended because: the session building .* recommends it\./);
    const rows = card.question.split('\n');
    assert.deepEqual(rows.slice(0, 2), ['The export needs to know which separator to use.', 'It changes the file people download.']);
    assert.equal(rows[2], MEANWHILE);
    assert.equal(rows[3], 'To know more, just ask.');
    assert.equal(card.parts.what, 'The export needs to know which separator to use.');
    assert.equal(card.parts.recommendation.startsWith('Tab, because '), true);
    assert.equal(MEANWHILE, 'Meanwhile that work waits, and the rest carries on.');
    assert.equal(helper.writes().filter((w) => w.kind === 'asked').length, 0, 'a decision is shown in chat: no card is handed out as asked');
    // The next visit makes no second card for it: one is waiting.
    const again = await run(helper, ['cards']);
    assert.equal(helper.writes().filter((w) => w.kind === 'card').length, 1);
    assert.deepEqual(again.json, { questions: [], left: 0 });
  });
});

test('a level 4 question becomes a card too, with what it does to the checks or that the build didn\'t say', async () => {
  await inHome(async () => {
    const said = { ...QUESTION, level: 4, checks: 'The export check stops running on this page.' };
    const unsaid = { ...QUESTION, id: 'q-export-csv-2', level: 4 };
    const work = makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] }, now: () => T(1) });
    const helper = fakeHelper({ events: [work, questionEvent(said), questionEvent(unsaid, 6)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    const cards = helper.writes().filter((w) => w.kind === 'card').map((w) => w.data);
    assert.deepEqual(cards.map((c) => [c.line, c.level]), [[answerLine('q-export-csv-1'), 4], [answerLine('q-export-csv-2'), 4]]);
    assert.match(cards[0].question, /^The export check stops running on this page\.$/m);
    assert.ok(cards[1].question.split('\n').includes(CHECKS_UNSAID));
    assert.equal(CHECKS_UNSAID, 'The build didn\'t say. Ask me why and I\'ll find out before you answer.');
    // With four options of its own the card has no Suggest a change… button, and it still composes with that line.
    const four = { ...QUESTION, id: 'q-export-csv-3', level: 4, options: ['Comma', 'Tab', 'Semicolon', 'Pipe'].map((label) => ({ label, says: `${label} between values.` })) };
    const full = fakeHelper({ events: [questionEvent(four)] });
    const asked = await run(full, ['cards']);
    assert.equal(asked.json.problems, undefined);
    const [fourCard] = full.writes().filter((w) => w.kind === 'card').map((w) => w.data);
    assert.deepEqual(fourCard.options, ['Comma', 'Tab', 'Semicolon', 'Pipe']);
    assert.ok(fourCard.question.split('\n').includes(CHECKS_UNSAID));
    assert.ok(fourCard.question.split('\n').includes('To change it, type what you\'d change.'));
    // The work is named by its title; a question for work with no title, by the work's id.
    assert.match(cards[0].descriptions[1], /because the session building Export a report as a spreadsheet recommends it\.$/);
    const untitled = fakeHelper({ events: [questionEvent()] });
    await run(untitled, ['cards']);
    assert.match(untitled.writes().find((w) => w.kind === 'card').data.descriptions[1], /because the session building export-csv recommends it\.$/);
  });
});

test('views survey prints what the survey found as short lines, with the rules numbered by their sources', async () => {
  await inHome(async () => {
    const none = await run(fakeHelper(), ['views', 'survey']);
    assert.equal(none.code, 0);
    assert.equal(none.out, 'No survey has been taken.\n');
    const empty = { v: 1, hostReached: true, requests: [], pushed: [], local: [], more: { pushed: false, local: false }, instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [] };
    const bare = await run(fakeHelper({ events: [makeEvent({ kind: 'survey', data: empty, now: () => T(1) })] }), ['views', 'survey']);
    assert.equal(bare.out, 'The survey found nothing under way, no other instructions and no rules.\n');
    const data = {
      ...empty,
      requests: [{ number: 12, title: 'Add a map\nof the shop', draft: false }, { number: 15, title: 'Fix the footer', draft: true }],
      pushed: [{ name: 'a', head: 'a'.repeat(40), commits: 1, subject: 'Work', at: '2026-10-24T09:00:00+11:00' }],
      more: { pushed: false, local: true },
      local: [{ name: 'b', head: 'b'.repeat(40), commits: 2, subject: 'Work', at: '2026-10-24T09:00:00+11:00' }],
      instructions: { files: ['AGENTS.md', '.cursorrules'], sections: [{ heading: 'Other', line: 4 }] },
      rules: [{ words: 'Never email on Sundays', source: { file: 'CLAUDE.md', line: 12 } }, { words: 'Use plain words', source: { file: 'AGENTS.md', line: 3 } }],
    };
    const full = await run(fakeHelper({ events: [makeEvent({ kind: 'survey', data: { ...empty, hostReached: false }, now: () => T(1) }), makeEvent({ kind: 'survey', data, now: () => T(2) })] }), ['views', 'survey']);
    assert.equal(full.out, [
      'Changes waiting to be merged: 2',
      '- number 12: Add a map of the shop',
      '- number 15: Fix the footer (a draft)',
      'Unfinished work pushed: 1',
      '- a: Work (1 change saved)',
      'Unfinished work on this computer: at least 1',
      '- b: Work (2 changes saved)',
      'Another agent setup\'s files: AGENTS.md, .cursorrules',
      'Parts of CLAUDE.md: 1',
      'Rules found: 2',
      '1. Never email on Sundays (CLAUDE.md, line 12)',
      '2. Use plain words (AGENTS.md, line 3)',
      '',
    ].join('\n'));
    // A host that couldn't be looked at is the first line.
    const missed = await run(fakeHelper({ events: [makeEvent({ kind: 'survey', data: { ...empty, hostReached: false }, now: () => T(1) })] }), ['views', 'survey']);
    assert.match(missed.out, /^The host could not be looked at\./);
    assert.doesNotMatch(full.out + missed.out, /commit|branch|worktree/i);
  });
});

test('every line break in a view\'s text is put on one line', async () => {
  await inHome(async () => {
    const glossary = makeEvent({ kind: 'glossary', data: { term: 'deploy', plain: 'one\ntwo\r\nthree\u2028four', example: 'a\rb' }, now: () => T(1) });
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'first\nsecond\r\nthird\u2028fourth' }, now: () => T(2) });
    const helper = fakeHelper({ events: [glossary, ruling] });
    const terms = (await run(helper, ['views', 'glossary'])).out.split('\n');
    assert.ok(terms.includes('deploy: one two three four'), terms.join('|'));
    const starter = Object.keys(JSON.parse(fs.readFileSync(new URL('../../../templates/glossary.json', import.meta.url), 'utf8')));
    assert.equal(terms.length, starter.length + 2, 'one line for each term, and the final newline');
    assert.deepEqual((await run(helper, ['explain', 'deploy'])).out, 'deploy: one two three four\nFor example: a b\n');
    assert.equal((await run(helper, ['views', 'rulebook'])).out, 'first second third fourth (waiting for the director to confirm it)\n');
  });
});

test('card, record and similar refuse at once when nothing is on standard input', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const argv of [['card'], ['record', 'idea'], ['record', 'ruling'], ['similar']]) {
      for (const input of ['', '  \n']) {
        const out = await run(helper, argv, input);
        assert.equal(out.code, 1, argv.join(' '));
        assert.match(out.err, /^[^\n]*nothing was given[^\n]*\n$/, argv.join(' '));
      }
    }
    assert.deepEqual(helper.calls, []);
    // A terminal is never waited on.
    await assert.rejects(readInput({ isTTY: true, [Symbol.asyncIterator]: () => { throw new Error('read'); } }), /nothing was given/);
  });
  // Run as a script with its input closed, it answers one line at once.
  for (const argv of [['card'], ['record', 'idea'], ['similar']]) {
    const done = spawnSync(process.execPath, [SCRIPT, ...argv], { input: '', encoding: 'utf8', timeout: 20000 });
    assert.equal(done.status, 1, argv.join(' '));
    assert.match(done.stderr, /^[^\n]*nothing was given[^\n]*\n$/, argv.join(' '));
  }
});

test('cards says which questions it could not make a card of, and asks the rest', async () => {
  await inHome(async () => {
    const tooMany = { ...QUESTION, id: 'q-export-csv-2', options: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ label, says: label })), recommendation: 'A' };
    const helper = fakeHelper({ events: [...typedOn(), questionEvent(), questionEvent(tooMany, 6)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0);
    assert.equal(out.json.questions.length, 0, 'the one that could be made is a decision, asked in chat');
    assert.equal(out.json.problems.length, 1);
    assert.match(out.json.problems[0], /q-export-csv-2/);
  });
});

// --- The build loop's cards: the click the merge gate waits for, and a lineage hold ---

// The update merge a CI push card is for: not the pull request's head until it is pushed.
const MERGE = '1234567890abcdef1234567890abcdef12345678';
const BRANCH = 'wh/export-csv';
const LATER = '0123456789abcdef0123456789abcdef01234567';
const MINUTE = 60 * 1000;
const ago = (ms) => () => new Date(NOW.getTime() - ms);
const EXPORT = makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] }, now: () => T(1) });
const gateAsks = (data, when = () => T(5)) => makeEvent({ kind: 'gate-asks', data: { work: 'export-csv', pr: 7, ...data }, now: when });
const APPROVE_ASK = { ask: 'approval', sha: FULL };
const PUSH_ASK = { ask: 'ci-push', sha: MERGE, branch: BRANCH };
const openAt = (headSha, state = 'open') => () => ({ ok: true, result: { headSha, state, mergeable: 'clean' } });
const cardWrites = (helper) => helper.writes().filter((w) => w.kind === 'card').map((w) => w.data);

test('a gate-asks for an approval becomes one approval card for that pull request and commit, made once', async () => {
  await inHome(async () => {
    // Within the click window, so the second visit has no reason to ask it again.
    const helper = fakeHelper({ events: [EXPORT, gateAsks(APPROVE_ASK, ago(2 * MINUTE))] });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.problems, undefined);
    const [card, ...more] = cardWrites(helper);
    assert.equal(more.length, 0);
    assert.equal(card.kind, 'approval');
    assert.equal(card.line, approvalLine(7, FULL));
    assert.equal(setLineOf(card.question), approvalLine(7, FULL));
    // The work is named by its title, in plain words; the card is handed out at once and marked asked.
    assert.match(card.parts.what, /^\S.* #7 for Export a report as a spreadsheet /);
    assert.equal(card.question.split('\n')[0], 'Put pull request #7 live?');
    assert.deepEqual(first.json.questions.map((q) => q.question), [chatCopy(card.question)]);
    // Its whole text, set line and reply code with it, is printed beside the cards for a reply with no clickable question.
    assert.deepEqual(first.json.inReply, [card.question]);
    assert.deepEqual(helper.writes().at(-1), { cwd: CWD, kind: 'asked', data: { cards: [helper.held.find((e) => e.kind === 'card').id] } });
    assert.deepEqual(cardProblems(card.question), []);
    // The host was asked whether the pull request is still at that commit.
    assert.deepEqual(helper.calls.filter(([name]) => name === 'prState'), [['prState', { cwd: CWD, number: 7 }]]);
    // The next visit makes no second card, and has nothing to ask.
    const second = await run(helper, ['cards']);
    assert.deepEqual(second.json, { questions: [], left: 0 });
    assert.equal(cardWrites(helper).length, 1);
    // A card already waiting with that line is not made again: it is asked as it waits.
    const waiting = cardEvent({ ...APPROVAL, target: { pr: 7, sha: FULL } }, 4);
    const already = fakeHelper({ events: [EXPORT, waiting, gateAsks(APPROVE_ASK, ago(2 * MINUTE))] });
    const asked = await run(already, ['cards']);
    assert.equal(cardWrites(already).length, 0);
    assert.deepEqual(asked.json.questions.map((q) => q.question), [chatCopy(waiting.data.question)]);
  });
});

test('a gate-asks for a CI push becomes a CI push card for its branch and the update\'s commit', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ events: [EXPORT, gateAsks(PUSH_ASK)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    const [card, ...more] = cardWrites(helper);
    assert.equal(more.length, 0);
    assert.equal(card.kind, 'ci-push');
    assert.equal(card.line, ciPushLine(BRANCH, MERGE));
    assert.equal(setLineOf(card.question), ciPushLine(BRANCH, MERGE));
    assert.ok(card.parts.what.includes(` ${BRANCH}`), card.question);
    assert.equal(card.question.split('\n')[0], 'Push this change to the checks?');
    assert.deepEqual(card.options.slice(0, 1), ['Push it']);
    assert.deepEqual(cardProblems(card.question), []);
  });
});

test('no gate card when the click is on record, the pull request has moved on, or the work is finished', async () => {
  await inHome(async () => {
    const question = 'as shown';
    const approved = makeEvent({ kind: 'approval', data: { pr: 7, commit: FULL, words: 'Approve', question }, now: () => T(9) });
    const pushedJustNow = makeEvent({ kind: 'action', data: { action: 'ci-push', branch: BRANCH, sha: MERGE, question, label: 'Push it' }, now: ago(2 * MINUTE) });
    const merged = makeEvent({ kind: 'report', data: { work: 'export-csv', outcome: 'merged', summary: 'Done.', rulings: [] }, now: () => T(9) });
    const cases = [
      ['an approval of that commit', [gateAsks(APPROVE_ASK), approved], {}],
      ['a CI push click within the window', [gateAsks(PUSH_ASK), pushedJustNow], {}],
      ['an approval asked of a head that has moved on', [gateAsks(APPROVE_ASK)], { head: LATER }],
      ['a CI push whose update is the head now: it was pushed', [gateAsks(PUSH_ASK)], { head: MERGE }],
      ['a pull request merged on the host', [gateAsks(APPROVE_ASK)], { pr: openAt(FULL, 'merged') }],
      ['a pull request closed on the host', [gateAsks(PUSH_ASK)], { pr: openAt(FULL, 'closed') }],
      ['a later gate-asks for the same pull request', [gateAsks(APPROVE_ASK), gateAsks(PUSH_ASK, () => T(6))], { head: MERGE }],
      ['work whose report says merged', [gateAsks(APPROVE_ASK), merged], {}],
    ];
    for (const [name, events, options] of cases) {
      const helper = fakeHelper({ events: [EXPORT, ...events], ...options });
      const out = await run(helper, ['cards']);
      assert.equal(out.code, 0, `${name}: ${out.err}`);
      assert.deepEqual(cardWrites(helper), [], name);
      assert.deepEqual(out.json.questions, [], name);
    }
    // When the host can't say, the card is made: asking is the safe side.
    for (const answer of [() => ({ ok: false, refused: 'the host helper could not be reached' }), () => { throw new Error('gone'); }, openAt('not a commit')]) {
      const helper = fakeHelper({ events: [EXPORT, gateAsks(APPROVE_ASK)], pr: answer });
      const out = await run(helper, ['cards']);
      assert.equal(out.code, 0, out.err);
      assert.deepEqual(cardWrites(helper).map((c) => c.line), [approvalLine(7, FULL)]);
    }
  });
});

test('R121: a CI push card whose click lapsed before the push comes back once; other gate cards keep to the usual rules', async () => {
  await inHome(async () => {
    // An approval card asked long ago, with the gate still waiting: not asked again (ruling F77).
    const waiting = cardEvent({ ...APPROVAL, target: { pr: 7, sha: FULL } }, 4);
    const handedOut = makeEvent({ kind: 'asked', data: { cards: [waiting.id] }, now: () => T(8) });
    const stale = fakeHelper({ events: [EXPORT, waiting, handedOut, gateAsks(APPROVE_ASK, ago(CLICK_MS + MINUTE))] });
    assert.deepEqual((await run(stale, ['cards'])).json, { questions: [], left: 0 });
    assert.deepEqual(stale.writes(), []);
    // Not now on a gate card keeps it off the next visit's cards; it stays on the board.
    const putOff = fakeHelper({ events: [EXPORT, gateAsks(APPROVE_ASK, ago(CLICK_MS + MINUTE))] });
    assert.equal((await run(putOff, ['cards'])).json.questions.length, 1);
    const made = putOff.held.find((e) => e.kind === 'card').id;
    await putOff.client.state.write({ cwd: CWD, kind: 'card-answer', data: { card: made, label: 'Not now' } });
    assert.deepEqual((await run(putOff, ['cards'])).json, { questions: [], left: 0 });
    assert.deepEqual(putOff.views().waiting.map((c) => c.id), [made]);

    // A CI push clicked once, whose click lapsed while the pull request is still at the head the
    // update was made from: the push didn't happen, so the card comes back as it was made.
    const push = cardEvent({
      kind: 'ci-push', level: 3, what: `The branch ${BRANCH} needs the latest changes.`, why: 'It changes a checks file.',
      options: [says('Push it')], recommend: 'Push it', because: 'the merge waits for it', meanwhile: 'The merge waits.', target: { branch: BRANCH, sha: MERGE },
    }, 4);
    const clicked = makeEvent({ kind: 'action', data: { action: 'ci-push', branch: BRANCH, sha: MERGE, question: push.data.question, label: 'Push it' }, now: ago(CLICK_MS + MINUTE) });
    const events = [EXPORT, push, gateAsks({ ...PUSH_ASK, from: FULL }, ago(CLICK_MS + 2 * MINUTE)), clicked];
    // Its records are written as the visit happens, after the click.
    const lapsed = fakeHelper({ events, head: FULL, writeAt: (n) => new Date(NOW.getTime() + n) });
    assert.equal(lapsed.views().waiting.length, 0, 'the click decided the card');
    const back = await run(lapsed, ['cards']);
    assert.equal(back.code, 0, back.err);
    assert.deepEqual(back.json.questions.map((q) => q.question), [chatCopy(push.data.question)]);
    assert.equal(cardWrites(lapsed).length, 0, 'not composed twice');
    assert.deepEqual(lapsed.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: [push.id] } }]);
    // Once for that click: the next visit doesn't ask it again.
    assert.deepEqual((await run(lapsed, ['cards'])).json, { questions: [], left: 0 });
    // Once the head has moved past the head the update was made from (pushed, then built on), no card.
    for (const head of [MERGE, LATER]) {
      const moved = fakeHelper({ events, head });
      assert.deepEqual((await run(moved, ['cards'])).json, { questions: [], left: 0 }, head);
    }
    // A gate-asks that doesn't name the head the update was made from is never asked again.
    const unnamed = fakeHelper({ events: [EXPORT, push, gateAsks(PUSH_ASK, ago(CLICK_MS + 2 * MINUTE)), clicked], head: FULL });
    assert.deepEqual((await run(unnamed, ['cards'])).json, { questions: [], left: 0 });
  });
});

test('a gate card for a commit the gate no longer asks about leaves the board; again numbers the cards as the board does', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const outdated = cardEvent({ ...APPROVAL, target: { pr: 7, sha: FULL } }, 3);
    const two = cardEvent(PRODUCT(2), 6);
    const events = [EXPORT, one, gateAsks(APPROVE_ASK, () => T(2)), outdated, gateAsks({ ask: 'approval', sha: LATER }, () => T(4)), two];
    const helper = fakeHelper({ events, head: LATER });
    assert.deepEqual(helper.views().waiting.map((c) => c.id), [one.id, two.id]);
    // The board and `views waiting` number the two cards still waiting, and `again` follows them.
    const model = boardModel({ views: helper.views(), events, now: NOW });
    assert.deepEqual(model.director.waiting.map((w) => w.since), [one.at, two.at]);
    const listedOut = await run(helper, ['views', 'waiting']);
    assert.equal(listedOut.code, 0, listedOut.err);
    assert.equal(listedOut.out.trim().split('\n').length, 2, listedOut.out);
    assert.match(listedOut.out, /^2\. /m);
    // Each line names its card's id, so a press naming a card by number and id can be matched (fix G).
    assert.deepEqual(listedOut.out.trim().split('\n').map((line) => /\(card ([^)]+)\)$/.exec(line)?.[1]), [one.id, two.id]);
    const asked = await run(helper, ['again', '2']);
    assert.equal(asked.code, 0, asked.err);
    assert.deepEqual(asked.json.questions.map((q) => q.question), [chatCopy(two.data.question)]);
    assert.equal(asked.json.id, two.id, 'again names the card it gives by its id');
    // The visit makes the card for the commit the gate asks about now, and never hands out the outdated one.
    const visit = await run(helper, ['cards']);
    assert.equal(visit.code, 0, visit.err);
    const [made, ...more] = cardWrites(helper);
    assert.deepEqual([made.line, more.length], [approvalLine(7, LATER), 0]);
    assert.deepEqual(visit.json.questions.map((q) => q.question), [made.question, one.data.question].map(chatCopy));
    // Put off with Not now while still current: it stays on the board and off the next visit's cards.
    const madeId = helper.held.find((e) => e.kind === 'card' && e.data.line === made.line).id;
    await helper.client.state.write({ cwd: CWD, kind: 'card-answer', data: { card: madeId, label: 'Not now' } });
    assert.deepEqual((await run(helper, ['cards'])).json, { questions: [], left: 0 });
    assert.deepEqual(helper.views().waiting.map((c) => c.id), [one.id, two.id, madeId]);
  });
});

test('a lineage hold becomes one question card naming the kits and the first paths, made once', async () => {
  await inHome(async () => {
    const paths = ['skills/a/SKILL.md', 'skills/b/SKILL.md', 'skills/c/SKILL.md', 'skills/d/SKILL.md', 'skills/e/SKILL.md', 'skills/f/SKILL.md', 'skills/g/SKILL.md'];
    const hold = makeEvent({ kind: 'lineage-hold', data: { at: T(3).toISOString(), mismatches: paths.map((p) => ({ upstream: 'superpowers', path: p })) }, now: () => T(3) });
    const helper = fakeHelper({ events: [hold] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    const [card, ...more] = cardWrites(helper);
    assert.equal(more.length, 0);
    assert.equal(card.kind, 'question');
    assert.equal(card.line, null);
    assert.equal(card.event, hold.id);
    const [what, why] = card.question.split('\n');
    assert.match(what, /superpowers/);
    assert.ok(what.includes('skills/e/SKILL.md, and 2 more'), what);
    assert.ok(!what.includes('skills/f/SKILL.md'), what);
    assert.match(what, /held/);
    assert.match(why, /next session/);
    assert.ok(card.question.length <= CARD.chars);
    assert.deepEqual(cardProblems(card.question), []);
    assert.deepEqual(out.json.questions.map((q) => q.question), [card.question]);
    // Made once: the next visit makes no second card for that hold.
    await run(helper, ['cards']);
    assert.equal(cardWrites(helper).length, 1);
    // The manifest that couldn't be read is said so.
    const unread = fakeHelper({ events: [makeEvent({ kind: 'lineage-hold', data: { at: T(3).toISOString(), mismatches: [{ upstream: null, path: 'lineage/manifest.json' }] }, now: () => T(3) })] });
    await run(unread, ['cards']);
    const [manifest] = cardWrites(unread);
    // Paths too long for the card are left out: each kit is named with how many of its files differ.
    const long = (n) => `skills/${String(n).repeat(180)}/SKILL.md`;
    const wide = fakeHelper({ events: [makeEvent({ kind: 'lineage-hold', data: { at: T(3).toISOString(), mismatches: [1, 2, 3, 4, 5, 6].map((n) => ({ upstream: 'superpowers', path: long(n) })) }, now: () => T(3) })] });
    const shown = await run(wide, ['cards']);
    assert.equal(shown.json.problems, undefined);
    const [short] = cardWrites(wide);
    assert.ok(short.question.split('\n')[0].includes('superpowers (6 files)'), short.question);
    assert.ok(!short.question.includes(long(1)));
    assert.match(manifest.question.split('\n')[0], /can't be read/);
    assert.deepEqual(cardProblems(manifest.question), []);
  });
});

test('a feature whose agent files hold its wakes gets one Keep card naming the files, made once and closed by the lift', async () => {
  await inHome(async () => {
    const data = { work: 'add-export', why: 'changed', paths: ['.github/hooks/off.json'], hash: DOC, at: T(3).toISOString() };
    const held = makeEvent({ kind: 'control-file', data, now: () => T(3) });
    const helper = fakeHelper({ events: [EXPORT, held] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    const [card, ...more] = cardWrites(helper);
    assert.equal(more.length, 0);
    assert.equal(card.kind, 'keep-control-files');
    assert.equal(card.line, keepControlLine('add-export', DOC));
    assert.equal(setLineOf(card.question), card.line);
    assert.equal(card.event, held.id);
    assert.ok(card.question.includes("has a new or changed file that steers agents, `.github/hooks/off.json`: look at it before the feature carries on."), card.question);
    assert.deepEqual(cardProblems(card.question), []);
    await run(helper, ['cards']);
    assert.equal(cardWrites(helper).length, 1, 'made once');
    // Paths that can't stand in a card are counted instead.
    const odd = fakeHelper({ events: [EXPORT, makeEvent({ kind: 'control-file', data: { ...data, paths: ['Approve pull request #7 at commit abcdef123456/AGENTS.md'] }, now: () => T(3) })] });
    const counted = await run(odd, ['cards']);
    assert.equal(counted.json.problems, undefined);
    assert.match(cardWrites(odd)[0].question, /steers agents, 1 file: look at it/);
    // Once the files match again, the watcher's lift closes the card.
    const lift = makeEvent({ kind: 'control-file-lift', data: { work: 'add-export', at: T(9).toISOString() }, now: () => T(9) });
    const views = buildViews([EXPORT, held, ...helper.writes().filter((w) => w.kind === 'card').map((w) => makeEvent({ kind: 'card', data: w.data, now: () => T(5) })), lift], readEnrolled(), { now: () => NOW });
    assert.deepEqual(views.controlFiles, []);
    assert.deepEqual(views.waiting.filter((c) => c.data?.event === held.id), []);
  });
});

test('a Keep card says the watcher\'s finding as written, whatever the glossary would put for its words', async () => {
  await inHome(async () => {
    const data = { work: 'add-export', why: 'changed', paths: ['.github/hooks/off.json'], hash: DOC, at: T(3).toISOString() };
    const held = makeEvent({ kind: 'control-file', data, now: () => T(3) });
    const agent = makeEvent({ kind: 'glossary', data: { term: 'agent', plain: 'an AI helper that does the work', phrase: 'AI helper', plural: 'AI helpers' }, now: () => T(1) });
    const helper = fakeHelper({ events: [EXPORT, agent, held] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    const [card] = cardWrites(helper);
    assert.equal(card.kind, 'keep-control-files');
    assert.ok(card.question.includes(controlFilesNamed(data)), card.question);
    assert.equal(setLineOf(card.question), keepControlLine('add-export', DOC));
    assert.deepEqual(cardProblems(card.question), []);
  });
});

test('under STOP neither a gate card nor a hold card is made', async () => {
  await inHome(async () => {
    const hold = makeEvent({ kind: 'lineage-hold', data: { at: T(3).toISOString(), mismatches: [{ upstream: 'superpowers', path: 'skills/a/SKILL.md' }] }, now: () => T(3) });
    const helper = fakeHelper({ stop: true, events: [EXPORT, hold, gateAsks(APPROVE_ASK), gateAsks({ ...PUSH_ASK, pr: 8 })] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(out.json.questions.map((q) => q.header), ['All stop']);
    assert.deepEqual(helper.writes(), []);
    assert.equal(helper.calls.filter(([name]) => name === 'prState').length, 0);
  });
});

test('card refuses a usage card: only the session start composes one, from the allowance it reads', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const usage = {
      kind: 'usage', level: 3, ask: 'Switch to Lightest until it resets?', what: 'You have used 95% of this week\'s allowance.', why: 'Only you choose how thorough the work is.',
      options: [{ label: 'Switch to Lightest until it resets', says: 'Thoroughness changes to Lightest.' }, { label: 'Stay on Lean', says: 'Thoroughness stays on Lean.' }],
      recommend: 'Switch to Lightest until it resets', because: 'it saves the most', meanwhile: 'Work carries on.', target: { to: 'lightest', at: '2026-10-26T01:00:00.000Z' },
    };
    const out = await run(helper, ['card'], JSON.stringify(usage));
    assert.notEqual(out.code, 0);
    assert.match(out.err, /A usage card comes from the session start/);
    assert.deepEqual(helper.writes(), []);
  });
});

test('card fills a pull request\'s head and records the card once', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const input = JSON.stringify({ ...APPROVAL, target: { pr: 7 } });
    const first = await run(helper, ['card'], input);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.alreadyAsked, undefined);
    assert.deepEqual(helper.calls.find(([name]) => name === 'prState'), ['prState', { cwd: CWD, number: 7 }]);
    // The chat's copy carries no set line; the card the state keeps does, and the click is signed from it.
    assert.equal(first.json.question.question.includes(approvalLine(7, FULL)), false);
    assert.equal(first.json.question.question, chatCopy(helper.writes().find((w) => w.kind === 'card').data.question));
    assert.ok(helper.writes().find((w) => w.kind === 'card').data.question.includes(approvalLine(7, FULL)));
    const cards = helper.writes().filter((w) => w.kind === 'card');
    assert.equal(cards.length, 1);
    assert.equal(first.json.id, helper.held.find((e) => e.kind === 'card').id);
    assert.equal(cards[0].data.line, approvalLine(7, FULL));
    // The card handed out is recorded as asked, so no later visit offers it again.
    assert.deepEqual(helper.writes().map((w) => [w.kind, w.data.cards]), [['card', undefined], ['asked', [first.json.id]]]);
    // Composed again, with other words, the waiting card comes back as it was recorded, marked as
    // asked already, so the director isn't asked it twice; nothing more is written.
    const second = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, because: 'the review was clean', target: { pr: 7 } }));
    assert.equal(second.code, 0, second.err);
    assert.equal(second.json.id, first.json.id);
    assert.deepEqual(second.json.question, first.json.question);
    assert.equal(second.json.alreadyAsked, true);
    assert.equal(helper.writes().length, 2);
    // A target that names its commit is kept as it is.
    const named = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, what: 'Pull request #8 changes the footer.', target: { pr: 8, sha: DOC } }));
    assert.ok(cardWrites(helper).some((c) => c.question.includes(approvalLine(8, DOC))));
    assert.ok(!named.json.question.question.includes('Reply code'), 'the chat copy carries no reply code');
    assert.equal(helper.calls.filter(([name]) => name === 'prState').length, 2, 'only the number was looked up');
  });
});

test('an approve-work card for work users would see always shows it to the director before it merges (scenario 7)', async () => {
  await inHome(async () => {
    const work = (id, visible) => makeEvent({ kind: 'work', data: { id, title: 'Make the order button blue', lane: 'small', visible, dependsOn: [] }, now: () => T(1) });
    const helper = fakeHelper({ events: [work('order-button-blue', true), work('order-total-sum', false)] });
    const approve = (id) => JSON.stringify({ ...APPROVAL, kind: 'approve-work', what: `Work ${id}: a small change.`, target: { work: id, lane: 'small', hash: DOC } });
    const seen = await run(helper, ['card'], approve('order-button-blue'));
    assert.equal(seen.code, 0, seen.err);
    assert.match(helper.writes().find((w) => w.kind === 'card').data.line, /, and show it to me before it merges$/);
    // Work users won't see keeps the card as given.
    const unseen = await run(helper, ['card'], approve('order-total-sum'));
    assert.equal(unseen.code, 0, unseen.err);
    assert.doesNotMatch(helper.writes().filter((w) => w.kind === 'card').at(-1).data.line, /show it to me/);
  });
});

test('card refuses an answer card, input that is not JSON and a card the composer refuses', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const answer = await run(helper, ['card'], JSON.stringify({ ...PRODUCT(1), kind: 'answer', target: { questionId: 'q-export-csv-1' } }));
    assert.equal(answer.code, 1);
    assert.match(answer.err, /cards/);
    // Nor a card tied to a record of the build's, which `cards` makes once (a lineage hold's).
    const tied = await run(helper, ['card'], JSON.stringify({ ...PRODUCT(1), event: 'e-hold' }));
    assert.equal(tied.code, 1);
    assert.match(tied.err, /cards/);
    const notJson = await run(helper, ['card'], 'not json');
    assert.equal(notJson.code, 1);
    assert.match(notJson.err, /JSON/);
    const refused = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, what: 'The sign-in page changes.', target: { pr: 7, sha: FULL } }));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /#7/);
    assert.equal(refused.err.trim().split('\n').length, 1, 'one line');
    assert.deepEqual(helper.writes(), []);
  });
});

test('record ruling keeps the words exactly and gives back its confirm card', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const words = 'Prices show GST, even on $0 items — ALWAYS';
    const out = await run(helper, ['record', 'ruling'], JSON.stringify({ words, reason: 'the director said so', scope: 'project' }));
    assert.equal(out.code, 0, out.err);
    const [ruling, card, asked] = helper.writes();
    assert.equal(ruling.kind, 'ruling');
    assert.deepEqual(ruling.data, { words, reason: 'the director said so', scope: 'project' });
    assert.equal(out.json.id, ruling.id);
    // The confirm card names that very ruling, by its id and its words, and it waits on the board.
    const event = helper.held.find((e) => e.kind === 'ruling');
    assert.equal(event.id, out.json.id);
    assert.equal(card.kind, 'card');
    assert.equal(card.data.kind, 'confirm');
    assert.equal(card.data.line, confirmLine(event));
    assert.ok(card.data.question.includes(confirmLine(event)));
    assert.equal(out.json.card.question.question, chatCopy(card.data.question));
    assert.equal(out.json.card.question.question.includes(confirmLine(event)), false);
    assert.equal(out.json.card.id, helper.held.find((e) => e.kind === 'card').id);
    // The confirm card handed out is recorded as asked.
    assert.deepEqual(asked, { cwd: CWD, kind: 'asked', data: { cards: [out.json.card.id] } });
    // Words a confirm line can't carry are refused before anything is written.
    for (const bad of [{ words: 'Two\nlines' }, { words: '' }, { reason: 'none' }]) {
      const refused = await run(helper, ['record', 'ruling'], JSON.stringify(bad));
      assert.equal(refused.code, 1, JSON.stringify(bad));
    }
    assert.equal(helper.writes().length, 3);
  });
});

test('record brief gives back its confirm card, showing all of it, and a fact joins the brief in force', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const lines = { for: 'Shop owners', now: 'Stop the calls to support', noGos: '', examples: ['Like the invoices page'], facts: [] };
    const out = await run(helper, ['record', 'brief'], JSON.stringify(lines));
    assert.equal(out.code, 0, out.err);
    const [brief, card, asked] = helper.writes();
    assert.equal(brief.kind, 'brief');
    assert.deepEqual(brief.data, wholeBrief(lines));
    const event = helper.held.find((e) => e.kind === 'brief');
    assert.equal(event.id, out.json.id);
    assert.equal(card.data.kind, 'confirm');
    assert.equal(card.data.line, confirmLine(event));
    assert.ok(card.data.question.includes('Like the invoices page'));
    assert.deepEqual(asked.data, { cards: [out.json.card.id] });
    // A draft is no brief until the director's click.
    assert.deepEqual((await run(helper, ['views', 'brief'])).out.trim(), 'This project has no signed brief.');
    helper.held.push(makeEvent({ ...confirmationFor(event), now: () => T(200) }));
    assert.ok((await run(helper, ['views', 'brief'])).out.includes('Stop the calls to support'));
    const fact = await run(helper, ['record', 'brief'], JSON.stringify({ fact: { words: 'One till', date: '2026-11-01' } }));
    assert.equal(fact.code, 0, fact.err);
    const next = helper.held.filter((e) => e.kind === 'brief').at(-1);
    assert.deepEqual(next.data.facts, [{ words: 'One till', date: '2026-11-01' }]);
    assert.equal(next.data.now, 'Stop the calls to support');
    assert.equal(helper.held.filter((e) => e.kind === 'card').length, 2);
  });
});

test('the fullest brief still fits its confirm card', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const room = BRIEF_WORDS_MOST - briefText(wholeBrief({})).length;
    const out = await run(helper, ['record', 'brief'], JSON.stringify({ now: 'a few plain words '.repeat(Math.ceil(room / 18)).slice(0, room).trim() }));
    assert.equal(out.code, 0, out.err);
    const refused = await run(helper, ['record', 'brief'], JSON.stringify({ now: 'a few plain words '.repeat(60) }));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /800 characters/);
  });
});

test('record brief refuses what can\'t stand, before anything is written', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const bad of [{ fact: { words: 'No date' } }, { nogos: 'A typo' }, { now: 'Two\nlines' }, { now: 'x', fact: { words: 'y', date: '2026-11-01' } }, { now: `ghp_${'a1B2'.repeat(9)}` }]) {
      const refused = await run(helper, ['record', 'brief'], JSON.stringify(bad));
      assert.equal(refused.code, 1, JSON.stringify(bad));
    }
    assert.deepEqual(helper.writes(), []);
  });
});

test('record work, amendment, incident and note write the build loop\'s kinds', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('export-csv', designWithSlices('Export a report'));
    const at = { cwd: dir };
    const docHash = createHash('sha256').update(designWithSlices('Export a report')).digest('hex');
    fs.writeFileSync(path.join(dir, 'docs', 'export-csv.change.md'), 'The changed brief.\n');
    const changeHash = createHash('sha256').update('The changed brief.\n').digest('hex');
    const records = {
      work: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [], doc: { path: 'docs/export-csv.md', hash: docHash } },
      amendment: { work: 'export-csv', change: 'Add a total row', hash: changeHash, doc: 'docs/export-csv.change.md' },
      incident: { id: 'bad-total', what: 'Totals are wrong on the invoice page' },
      // The no-blame account once an incident is over (intake, route 1).
      note: { incident: 'bad-total', text: 'A rounding change reached the invoice page; the fix and a check are in.' },
    };
    for (const [kind, data] of Object.entries(records)) {
      const input = kind === 'amendment' ? { ...data, readBack: READ_BACK } : data;
      const out = await run(helper, ['record', kind], JSON.stringify(input), at);
      assert.equal(out.code, 0, out.err);
      assert.deepEqual(helper.writes().filter((w) => w.kind === kind).at(-1), { cwd: dir, kind, data });
      const written = kind === 'work' ? helper.held.find((e) => e.kind === 'work') : helper.held.at(-1);
      assert.equal(out.json[kind === 'work' ? 'eventId' : 'id'], written.id);
    }
    assert.deepEqual(helper.held.map((e) => e.kind), ['work', 'card', 'asked', 'amendment', 'incident', 'note']);
    for (const kind of ['idea', 'rejection', 'glossary', 'decision', 'risk', 'blocker', 'reversal']) assert.ok(RECORD_KINDS.includes(kind), kind);
  });
});

test('record work refuses the quick lane for work users would see, unless it is ready-made work carried on (scenario 7)', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('order-button-blue');
    const work = { id: 'order-button-blue', title: 'Make the order button blue', lane: 'quick', visible: true, dependsOn: [] };
    const refused = await run(helper, ['record', 'work'], JSON.stringify(work));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /Work users would see goes in the small lane at least, shown to the director first/);
    assert.equal(helper.held.length, 0, 'nothing refused was written');
    // Quick work users won't see, and the same work in the small lane, are written.
    for (const data of [{ ...work, visible: false }, { ...work, lane: 'small', doc: 'docs/order-button-blue.md' }]) {
      const out = await run(helper, ['record', 'work'], JSON.stringify(data), { cwd: dir });
      assert.equal(out.code, 0, out.err);
    }
    // Ready-made work (an archive of another setup's instructions) is always shown, whatever its lane.
    const from = { sha: 'a'.repeat(40), ref: 'refs/wheelhouse/from/archive-1' };
    fs.writeFileSync(path.join(dir, 'docs', 'archive-1.md'), 'Archive.\n');
    const archive = await run(helper, ['record', 'work'], JSON.stringify({ ...work, id: 'archive-1', from, doc: 'docs/archive-1.md' }), { cwd: dir });
    assert.equal(archive.code, 0, archive.err);
  });
});

test('record work and card refuse an event id where a work id belongs, naming the slug when it is known', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('statement-import');
    const work = { id: 'statement-import', title: 'Import a statement', lane: 'small', visible: true, dependsOn: [], doc: 'docs/statement-import.md' };
    const first = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(first.code, 0, first.err);
    const eventId = first.json.eventId;
    const before = helper.held.length;
    const next = { id: 'statement-export', title: 'Export a statement', lane: 'small', visible: true };
    const known = await run(helper, ['record', 'work'], JSON.stringify({ ...next, dependsOn: [eventId] }));
    assert.equal(known.code, 1);
    assert.match(known.err, /the work id is the slug you recorded it under: statement-import/);
    const unknown = await run(helper, ['record', 'work'], JSON.stringify({ ...next, dependsOn: ['65b530ed-b8e7-4a1c-9d2e-0123456789ab'] }));
    assert.equal(unknown.code, 1);
    assert.match(unknown.err, /the work id is the slug you recorded it under, not an event id/);
    const card = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, kind: 'approve-work', what: 'Work statement-import: x.', target: { work: eventId, lane: 'small', hash: DOC } }));
    assert.equal(card.code, 1);
    assert.match(card.err, /the work id is the slug you recorded it under: statement-import/);
    assert.equal(helper.held.length, before, 'nothing refused was written');
  });
});

// A project folder holding a brief at docs/<name>.md, for the tests of `record work`'s own card.
function projectWithDoc(name, text = 'The brief.\n') {
  const dir = tempFolder('wh-frontdesk-work-');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', `${name}.md`), text);
  return dir;
}
const approvalEvents = (target) => [makeEvent({ kind: 'action', now: () => T(300), data: { action: 'approve-work', ...target, question: 'as shown', label: 'Approve' } })];
const cardsOf = (helper) => helper.held.filter((e) => e.kind === 'card');

test('record work composes, records and prints the approve-work card for a small or feature work', async () => {
  await inHome(async () => {
    for (const [lane, id] of [['small', 'statement-import'], ['feature', 'export-csv']]) {
      const helper = fakeHelper();
      const dir = projectWithDoc(id, lane === 'feature' ? designWithSlices('Import a statement') : undefined);
      const work = { id, title: 'Import a statement.', lane, visible: true, dependsOn: [], doc: `docs/${id}.md` };
      const out = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
      assert.equal(out.code, 0, out.err);
      assert.equal(out.json.work, id);
      assert.equal(out.json.eventId, helper.held.find((e) => e.kind === 'work').id);
      assert.ok(!('id' in out.json), 'no id key: the uuid is eventId');
      assert.match(out.json.hash, /^[0-9a-f]{64}$/);
      assert.equal(cardsOf(helper).length, 1, 'a card event was written');
      const line = approveWorkLine(id, lane, out.json.hash, { shownFirst: true });
      // The printed question is the chat's copy, without the set line; the card as recorded holds it.
      assert.equal(cardsOf(helper)[0].data.line, line);
      assert.ok(cardsOf(helper)[0].data.question.includes(line));
      assert.match(out.json.card.question.question, new RegExp(`Work ${id}: Import a statement\\.`));
      assert.equal(typeof out.json.card.id, 'string');
      assert.equal(cardsOf(helper)[0].id, out.json.card.id);
      assert.equal(whatProblem('approve-work', cardsOf(helper)[0].data.parts.what, { work: id, lane, hash: out.json.hash, shownFirst: true }), null);
    }
  });
});

test('record work asks no card for work users will not see, in the quick or bug lane', async () => {
  await inHome(async () => {
    for (const lane of ['quick', 'bug']) {
      const helper = fakeHelper();
      const out = await run(helper, ['record', 'work'], JSON.stringify({ id: `fix-${lane}`, title: 'Tidy a script', lane, visible: false, dependsOn: [] }));
      assert.equal(out.code, 0, out.err);
      assert.ok(!('card' in out.json), lane);
      assert.equal(out.json.work, `fix-${lane}`);
      assert.equal(cardsOf(helper).length, 0, lane);
    }
  });
});

test('record work refuses an approval with no document, writing nothing', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const out = await run(helper, ['record', 'work'], JSON.stringify({ id: 'statement-import', title: 'Import a statement', lane: 'small', visible: true, dependsOn: [] }));
    assert.equal(out.code, 1);
    assert.match(out.err, /an approval names the work's document/);
    assert.equal(helper.held.length, 0);
  });
});

const FEATURE = { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [], doc: 'docs/export-csv.md' };

test('record work refuses a feature design with no slices block, writing nothing', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('export-csv');
    const out = await run(helper, ['record', 'work'], JSON.stringify(FEATURE), { cwd: dir });
    assert.notEqual(out.code, 0);
    assert.match(out.err, /wheelhouse-slices/);
    assert.match(out.err, /Add one/);
    assert.equal(helper.held.filter((e) => e.kind === 'work' || e.kind === 'card').length, 0);
  });
});

test('record work names the problem in a feature design\'s broken slices block', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const broken = '# Export\n\n```wheelhouse-slices\n{"goal":"Export","flag":{"name":"export"},"demo":"end","slices":[{"title":"One","goal":"One"}]}\n```\n';
    const dir = projectWithDoc('export-csv', broken);
    const out = await run(helper, ['record', 'work'], JSON.stringify(FEATURE), { cwd: dir });
    assert.notEqual(out.code, 0);
    assert.match(out.err, /slice 1 needs at least one done check/);
    assert.equal(helper.held.length, 0);
  });
});

test('record work records a feature design with a good slices block and prints its card', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('export-csv', designWithSlices('Export a report'));
    const out = await run(helper, ['record', 'work'], JSON.stringify(FEATURE), { cwd: dir });
    assert.equal(out.code, 0, out.err);
    assert.equal(typeof out.json.card.id, 'string');
    assert.equal(cardsOf(helper).length, 1);
  });
});

test('record work asks for no slices from small or bug work, or from feature work carried on', async () => {
  await inHome(async () => {
    const dir = projectWithDoc('export-csv');
    const small = await run(fakeHelper(), ['record', 'work'], JSON.stringify({ ...FEATURE, id: 'small-one', lane: 'small' }), { cwd: dir });
    assert.equal(small.code, 0, small.err);
    const bug = await run(fakeHelper(), ['record', 'work'], JSON.stringify({ id: 'a-bug', title: 'A bug', lane: 'bug', visible: false, dependsOn: [] }), { cwd: dir });
    assert.equal(bug.code, 0, bug.err);
    const carried = await run(fakeHelper(), ['record', 'work'], JSON.stringify({ ...FEATURE, id: 'carried-on', from: { sha: 'a'.repeat(40), ref: 'refs/wheelhouse/from/carried-on', request: 1 } }), { cwd: dir });
    assert.equal(carried.code, 0, carried.err);
  });
});

test('record work again for approved feature work, its design holding its block, is not refused', async () => {
  await inHome(async () => {
    const dir = projectWithDoc('export-csv', designWithSlices('Export a report'));
    const first = fakeHelper();
    const made = await run(first, ['record', 'work'], JSON.stringify(FEATURE), { cwd: dir });
    assert.equal(made.code, 0, made.err);
    const approved = fakeHelper({ events: [...first.held, ...approvalEvents({ work: 'export-csv', lane: 'feature', hash: made.json.hash, shownFirst: true })] });
    const again = await run(approved, ['record', 'work'], JSON.stringify({ ...FEATURE, dependsOn: ['a-first-thing'] }), { cwd: dir });
    assert.equal(again.code, 0, again.err);
  });
});

test('record work again for a work already approved at that hash and lane asks nothing and says approved', async () => {
  await inHome(async () => {
    const dir = projectWithDoc('statement-import');
    const work = { id: 'statement-import', title: 'Import a statement', lane: 'small', visible: true, dependsOn: [], doc: 'docs/statement-import.md' };
    const first = fakeHelper();
    const made = await run(first, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(made.code, 0, made.err);
    const approval = { work: 'statement-import', lane: 'small', hash: made.json.hash, shownFirst: true };
    const approved = fakeHelper({ events: [...first.held, ...approvalEvents(approval)] });
    const before = approved.held.length;
    const again = await run(approved, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(again.code, 0, again.err);
    assert.equal(again.json.approved, true);
    assert.ok(!('card' in again.json));
    assert.equal(approved.held.length, before + 1, 'only the work event is written');
  });
});

test('record work again while its card waits unasked-of brings back the same card', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('statement-import');
    const work = { id: 'statement-import', title: 'Import a statement', lane: 'small', visible: true, dependsOn: [], doc: 'docs/statement-import.md' };
    const first = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    const second = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(second.code, 0, second.err);
    assert.equal(second.json.card.id, first.json.card.id);
    assert.equal(cardsOf(helper).length, 1);
  });
});

test('record work for a title with a hex-looking word still writes a card, with the plain line for what', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('hex-export');
    const work = { id: 'hex-export', title: 'Fix deadbeef1234 export', lane: 'small', visible: true, dependsOn: [], doc: 'docs/hex-export.md' };
    const out = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(out.code, 0, out.err);
    assert.equal(cardsOf(helper).length, 1);
    assert.equal(cardsOf(helper)[0].data.parts.what, 'Work hex-export, as its document describes.');
  });
});

test('ready-made work carried on (from) needs approval whatever its lane or visibility: record work asks its card, and cards re-offers it if unasked', async () => {
  await inHome(async () => {
    const from = { sha: 'a'.repeat(40), ref: 'refs/wheelhouse/from/archive-2' };
    assert.equal(needsApproval({ lane: 'quick', visible: false, from }), true, 'as the foreman holds it');
    assert.equal(needsApproval({ lane: 'quick', visible: false }), false);
    // The record command itself requires visible true for ready-made work, so a quick one is asked its card.
    const helper = fakeHelper();
    const dir = projectWithDoc('archive-2');
    const work = { id: 'archive-2', title: 'Carry on an archive', lane: 'quick', visible: true, dependsOn: [], from, doc: 'docs/archive-2.md' };
    const out = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(out.code, 0, out.err);
    assert.equal(cardsOf(helper).length, 1, 'a card event was written');
    assert.equal(cardsOf(helper)[0].data.line, approveWorkLine('archive-2', 'quick', out.json.hash, { shownFirst: true }));
    assert.match(out.json.card.question.question, /Work archive-2: Carry on an archive\./);
    // (A work event refuses from with visible false, so the quick lane's ready-made work is always visible.) With no card
    // ever written, cards offers it.
    const unasked = fakeHelper({ events: [unaskedWork('archive-3', { lane: 'quick', visible: true, from: { ...from, ref: 'refs/wheelhouse/from/archive-3', request: 1 } })] });
    const cards = await run(unasked, ['cards']);
    assert.equal(cards.code, 0, cards.err);
    assert.equal(cardsOf(unasked).length, 1);
    assert.equal(cardsOf(unasked)[0].data.line, approveWorkLine('archive-3', 'quick', DOC, { shownFirst: true }));
    // The work still names its document.
    const bare = await run(fakeHelper(), ['record', 'work'], JSON.stringify({ ...work, doc: undefined }));
    assert.equal(bare.code, 1);
    assert.match(bare.err, /an approval names the work's document/);
  });
});

test('record work for a title with a line break, or one far too long, still writes the work once with a card', async () => {
  await inHome(async () => {
    for (const [id, title, expected] of [
      ['multi-line', 'Import a\nstatement\n\n  fast', /^Work multi-line: Import a statement fast\.$/],
      ['long-title', `Import ${'a very long statement '.repeat(80)}`, /^Work long-title, as its document describes\.$/],
    ]) {
      const helper = fakeHelper();
      const dir = projectWithDoc(id);
      const out = await run(helper, ['record', 'work'], JSON.stringify({ id, title, lane: 'small', visible: true, dependsOn: [], doc: `docs/${id}.md` }), { cwd: dir });
      assert.equal(out.code, 0, out.err);
      assert.equal(helper.held.filter((e) => e.kind === 'work').length, 1, `${id}: the work is recorded once`);
      assert.equal(cardsOf(helper).length, 1, id);
      assert.match(cardsOf(helper)[0].data.parts.what, expected);
    }
  });
});

test('record work for small work users will not see gives the plain line, with no show-first tail', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('quiet-small');
    const out = await run(helper, ['record', 'work'], JSON.stringify({ id: 'quiet-small', title: 'Tidy a script', lane: 'small', visible: false, dependsOn: [], doc: 'docs/quiet-small.md' }), { cwd: dir });
    assert.equal(out.code, 0, out.err);
    assert.equal(cardsOf(helper)[0].data.line, approveWorkLine('quiet-small', 'small', out.json.hash));
    assert.doesNotMatch(cardsOf(helper)[0].data.line, /show it to me before it merges/);
  });
});

test('record work again after its card was answered with no approval on record asks nothing and does not say approved', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('statement-import');
    const work = { id: 'statement-import', title: 'Import a statement', lane: 'small', visible: true, dependsOn: [], doc: 'docs/statement-import.md' };
    const first = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    const decided = fakeHelper({ events: [...helper.held, answerAt(helper.held.find((e) => e.kind === 'card'), 'Approve', 10 * MINUTE)] });
    const again = await run(decided, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(again.code, 0, again.err);
    assert.ok(!('approved' in again.json));
    assert.ok(!('card' in again.json));
    assert.match(again.json.asked, /^Already .*; nothing to ask\.$/);
  });
});

// A recorded work with a document and no card ever written, as `record work` left it before it asked its own card.
const unaskedWork = (id = 'statement-import', extra = {}) => makeEvent({ kind: 'work', data: { id, title: 'Import a statement', lane: 'small', visible: true, dependsOn: [], doc: { path: `docs/${id}.md`, hash: DOC }, ...extra }, now: () => T(1) });

test('cards re-offers the approve-work card for open work that waits for approval and never had a card', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ events: [unaskedWork()] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    const line = approveWorkLine('statement-import', 'small', DOC, { shownFirst: true });
    assert.equal(cardsOf(helper).length, 1);
    assert.equal(cardsOf(helper)[0].data.line, line);
    assert.equal(out.json.questions.length, 1);
    assert.ok(out.json.questions[0].question.includes('Work statement-import: Import a statement.'));
    const next = await run(helper, ['cards']);
    assert.equal(cardsOf(helper).length, 1, 'the card now exists, so none is made again');
    assert.equal(next.json.problems, undefined);
  });
});

test('cards offers the approve-work card for the new hash once act reapprove has recorded the changed document', async () => {
  await inHome(async () => {
    const CHANGED_DOC = '0123456789abcdef'.repeat(4);
    // As `act reapprove` leaves the record: the director approved DOC, then a work event names the changed document, so no
    // approval stands for the work, and its old card is in the record.
    const approved = makeEvent({ kind: 'action', now: () => T(2), data: { action: 'approve-work', work: 'statement-import', lane: 'small', hash: DOC, shownFirst: true, question: 'as shown', label: 'Approve' } });
    const reapproved = unaskedWork('statement-import', { doc: { path: 'docs/statement-import.md', hash: CHANGED_DOC } });
    reapproved.at = T(3).toISOString();
    const helper = fakeHelper({ events: [unaskedWork(), approved, reapproved] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    assert.equal(cardsOf(helper).length, 1);
    assert.equal(cardsOf(helper)[0].data.line, approveWorkLine('statement-import', 'small', CHANGED_DOC, { shownFirst: true }));
  });
});

test('cards writes no new approve-work card for work whose card exists in any state', async () => {
  await inHome(async () => {
    const first = fakeHelper({ events: [unaskedWork()] });
    await run(first, ['cards']);
    const made = cardsOf(first)[0];
    const notNow = makeEvent({ kind: 'card-answer', data: { card: made.id, label: 'Not now', where: 'panel' }, now: () => T(5) });
    for (const events of [[...first.held], [...first.held, notNow]]) {
      const helper = fakeHelper({ events });
      const out = await run(helper, ['cards']);
      assert.equal(out.code, 0, out.err);
      assert.equal(cardsOf(helper).length, 1, 'no second card is written');
      assert.equal(out.json.problems, undefined);
    }
  });
});

test('cards writes no new approve-work card when the waiting, put-off or Not-now card is in the plain wording', async () => {
  await inHome(async () => {
    const plain = approveWorkLine('statement-import', 'small', DOC);
    const first = fakeHelper({ events: [unaskedWork('statement-import', { visible: false })] });
    await run(first, ['cards']);
    const made = cardsOf(first)[0];
    const old = makeEvent({ kind: 'card', data: { ...made.data, line: plain }, now: () => T(2) });
    const notNow = makeEvent({ kind: 'card-answer', data: { card: old.id, label: 'Not now', where: 'panel' }, now: () => T(5) });
    const work = first.held.find((e) => e.kind === 'work');
    for (const events of [[work, old], [work, old, notNow]]) {
      const helper = fakeHelper({ events });
      const out = await run(helper, ['cards']);
      assert.equal(out.code, 0, out.err);
      assert.equal(cardsOf(helper).length, 1, 'no second card is written');
      assert.equal(out.json.problems, undefined);
    }
  });
});

test('cards re-offers nothing for work that is approved, started, finished or needs no approval', async () => {
  await inHome(async () => {
    const approval = makeEvent({ kind: 'action', now: () => T(300), data: { action: 'approve-work', work: 'approved-one', lane: 'small', hash: DOC, shownFirst: true, question: 'as shown', label: 'Approve' } });
    const run1 = makeEvent({ kind: 'run', data: { work: 'started-one', lane: 'small', engine: 'fake', runId: 'r1', state: 'started', branch: 'wh/started-one' }, now: () => T(2) });
    const report = makeEvent({ kind: 'report', data: { work: 'finished-one', outcome: 'closed', summary: 'Done.', rulings: [] }, now: () => T(3) });
    const helper = fakeHelper({ events: [unaskedWork('approved-one'), approval, unaskedWork('started-one'), run1, unaskedWork('finished-one'), report, unaskedWork('quiet-one', { lane: 'quick', visible: false }), unaskedWork('open-one')] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    // The one open, unasked work is the control: it is offered, so the others are left alone by the check, not by a silent call.
    assert.deepEqual(cardsOf(helper).filter((e) => /^Approve /.test(e.data.line ?? '')).map((e) => e.data.line), [approveWorkLine('open-one', 'small', DOC, { shownFirst: true })]);
  });
});

test('record work takes the card\'s words from a `card` override, which is not stored on the work', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('archive-x');
    const work = { id: 'archive-x', title: 'Carry on archive x', lane: 'small', visible: true, dependsOn: [], doc: 'docs/archive-x.md', card: { what: 'Work archive-x: move the old instructions across.' } };
    const out = await run(helper, ['record', 'work'], JSON.stringify(work), { cwd: dir });
    assert.equal(out.code, 0, out.err);
    assert.match(out.json.card.question.question, /Work archive-x: move the old instructions across\./);
    assert.ok(!('card' in helper.held.find((e) => e.kind === 'work').data));
  });
});

// The read-back an amendment needs (intake, route 3): what the change does, what it leaves, and when it is done.
const READ_BACK = { doing: 'The export as one CSV file', notDoing: 'An Excel option', doneWhen: 'The button gives a CSV file that opens in Numbers' };

test('record amendment takes the read-back, refuses without it, and prints the route line and the read-back to say (scenario 26)', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const dir = projectWithDoc('export-csv', designWithSlices('Export a report'));
    const at = { cwd: dir };
    const work = { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [], doc: 'docs/export-csv.md' };
    await run(helper, ['record', 'work'], JSON.stringify(work), at);
    fs.writeFileSync(path.join(dir, 'docs', 'export-csv.change.md'), 'The brief, as CSV.\n');
    const amendment = { work: 'export-csv', change: 'Make the export CSV, not Excel', hash: createHash('sha256').update('The brief, as CSV.\n').digest('hex'), doc: 'docs/export-csv.change.md' };

    // Without the read-back, or with a part missing, empty or on two lines, nothing is written.
    const bad = [
      undefined, 'Doing: CSV', {}, { ...READ_BACK, doing: '' }, { ...READ_BACK, notDoing: undefined },
      { ...READ_BACK, doneWhen: 'Two\nlines' }, { ...READ_BACK, doing: 7 }, { ...READ_BACK, notDoing: ' . ' },
    ];
    for (const readBack of bad) {
      const refused = await run(helper, ['record', 'amendment'], JSON.stringify({ ...amendment, ...(readBack === undefined ? {} : { readBack }) }), at);
      assert.equal(refused.code, 1, JSON.stringify(readBack));
      assert.match(refused.err, /Read the change back first: give readBack as \{ doing, notDoing, doneWhen \}, each one line/);
    }
    assert.equal(helper.held.filter((e) => e.kind === 'amendment').length, 0, 'nothing refused was written');

    // The approved document is locked: no `doc`, the document itself, or a copy of it is refused, and nothing is written.
    const { doc: _doc, hash: _hash, ...bare } = amendment;
    const lockedWords = /The approved document docs\/export-csv\.md is locked: changing it is an amendment\. Write the changed text to its own file, such as docs\/export-csv\.change\.md, and give it as doc/;
    for (const doc of [undefined, 'docs/export-csv.md', './docs/export-csv.md']) {
      const refused = await run(helper, ['record', 'amendment'], JSON.stringify({ ...bare, ...(doc === undefined ? {} : { doc }), readBack: READ_BACK }), at);
      assert.equal(refused.code, 1, String(doc));
      assert.match(refused.err, lockedWords);
    }
    fs.writeFileSync(path.join(dir, 'docs', 'copy.md'), designWithSlices('Export a report'));
    const same = await run(helper, ['record', 'amendment'], JSON.stringify({ ...bare, doc: 'docs/copy.md', readBack: READ_BACK }), at);
    assert.equal(same.code, 1);
    assert.match(same.err, /The changed document is the approved one: nothing changes/);
    assert.equal(helper.held.filter((e) => e.kind === 'amendment').length, 0, 'nothing refused was written');

    // With it, the event is the amendment alone, and `say` is the route line and the read-back, in one.
    const out = await run(helper, ['record', 'amendment'], JSON.stringify({ ...amendment, readBack: { ...READ_BACK, doing: 'The export as one CSV file.' } }), at);
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(helper.held.at(-1).data, amendment, 'the read-back is said, not stored');
    assert.equal(out.json.say, "I've treated this as a change to work already running; say if it's something else. "
      + 'Doing: The export as one CSV file. Not doing: An Excel option. Done when: The button gives a CSV file that opens in Numbers.');
    // A part that ends in its own mark keeps it, with no full stop after it.
    const asked = await run(helper, ['record', 'amendment'], JSON.stringify({ ...amendment, readBack: { ...READ_BACK, notDoing: 'Excel, for now!' } }), at);
    assert.match(asked.json.say, /Not doing: Excel, for now! Done when:/);
  });
});

test('record works out the hash of the document a work or an amendment names, and prints it', async () => {
  await inHome(async () => {
    const dir = tempFolder('wh-frontdesk-docs-');
    const write = (relative, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
      fs.writeFileSync(path.join(dir, relative), text);
    };
    write('docs/bugs/total.md', 'The total counts cancelled orders.\r\n');
    const helper = fakeHelper();
    const at = { cwd: dir };
    const hashOf = (text) => createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');
    const work = { id: 'staff-total', title: 'The total counts cancelled orders', lane: 'bug', visible: false, dependsOn: [] };

    // A work event's document by its path alone: the hash is the file's, line endings evened.
    const bug = await run(helper, ['record', 'work'], JSON.stringify({ ...work, doc: { path: 'docs/bugs/total.md' } }), at);
    assert.equal(bug.code, 0, bug.err);
    const hash = hashOf('The total counts cancelled orders.\n');
    assert.deepEqual(helper.held.at(-1).data.doc, { path: 'docs/bugs/total.md', hash });
    assert.equal(bug.json.hash, hash, 'the hash is printed, for the approval card to name');
    // Its path given as plain text, as the intake says ("names its brief as `doc`, by its path"), is
    // taken the same way (the rehearsal on a project under way: a session gave it so and was refused).
    const plain = await run(helper, ['record', 'work'], JSON.stringify({ ...work, doc: 'docs/bugs/total.md' }), at);
    assert.equal(plain.code, 0, plain.err);
    assert.deepEqual(helper.held.at(-1).data.doc, { path: 'docs/bugs/total.md', hash });

    // A hash given must be the file's as it stands; a document that can't be read is refused.
    const wrong = await run(helper, ['record', 'work'], JSON.stringify({ ...work, doc: { path: 'docs/bugs/total.md', hash: DOC } }), at);
    assert.equal(wrong.code, 1);
    assert.match(wrong.err, /docs\/bugs\/total\.md is not the document's as it stands/);
    const missing = await run(helper, ['record', 'work'], JSON.stringify({ ...work, doc: { path: 'docs/bugs/none.md' } }), at);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /docs\/bugs\/none\.md can't be read/);
    // A hash given for a document that can't be read is never taken unchecked.
    const unchecked = await run(helper, ['record', 'work'], JSON.stringify({ ...work, doc: { path: 'docs/bugs/none.md', hash: DOC } }), at);
    assert.equal(unchecked.code, 1);
    assert.match(unchecked.err, /docs\/bugs\/none\.md can't be read/);
    // A document over 1 MB says so.
    write('docs/bugs/huge.md', 'x'.repeat(1024 * 1024 + 1));
    for (const doc of [{ path: 'docs/bugs/huge.md' }, { path: 'docs/bugs/huge.md', hash: DOC }]) {
      const huge = await run(helper, ['record', 'work'], JSON.stringify({ ...work, doc }), at);
      assert.equal(huge.code, 1);
      assert.match(huge.err, /docs\/bugs\/huge\.md is over 1 MB/);
    }

    // An amendment: the changed text is in its own file, named as `doc`; the approved document stays as it was.
    write('docs/bugs/total.change.md', 'The total leaves cancelled orders out, and says so.\n');
    const amended = await run(helper, ['record', 'amendment'], JSON.stringify({ work: 'staff-total', change: 'Say that cancelled orders are left out', doc: 'docs/bugs/total.change.md', readBack: READ_BACK }), at);
    assert.equal(amended.code, 0, amended.err);
    const changed = hashOf('The total leaves cancelled orders out, and says so.\n');
    assert.deepEqual(helper.held.at(-1).data, { work: 'staff-total', change: 'Say that cancelled orders are left out', doc: 'docs/bugs/total.change.md', hash: changed });
    assert.equal(amended.json.hash, changed);
    const stale = await run(helper, ['record', 'amendment'], JSON.stringify({ work: 'staff-total', change: 'x', doc: 'docs/bugs/total.change.md', hash, readBack: READ_BACK }), at);
    assert.equal(stale.code, 1);
    assert.match(stale.err, /is not the document's as it stands/);
    // An amendment of work that isn't open is refused, with a hash or without.
    for (const data of [{ work: 'no-such-work', change: 'x' }, { work: 'no-such-work', change: 'x', hash: DOC }]) {
      const unknown = await run(helper, ['record', 'amendment'], JSON.stringify({ ...data, readBack: READ_BACK }), at);
      assert.equal(unknown.code, 1);
      assert.match(unknown.err, /The work no-such-work isn't a known work, so there is nothing to amend/);
    }
    // Work whose feature closed, with no report ending it, isn't open either, as the queue reads it.
    await run(helper, ['record', 'work'], JSON.stringify({ ...work, id: 'shut' }), at);
    helper.held.push(makeEvent({ kind: 'feature', data: { work: 'shut', step: 'closed' }, now: () => new Date('2026-10-18T01:00:00.000Z') }));
    const shut = await run(helper, ['record', 'amendment'], JSON.stringify({ work: 'shut', change: 'x', hash: DOC, readBack: READ_BACK }), at);
    assert.equal(shut.code, 1);
    assert.match(shut.err, /The work shut has finished, so it can't be amended: that work has finished; this becomes a new work/);
    // Open work that names no document needs the changed document's hash.
    await run(helper, ['record', 'work'], JSON.stringify({ ...work, id: 'no-doc' }), at);
    const nameless = await run(helper, ['record', 'amendment'], JSON.stringify({ work: 'no-doc', change: 'x', readBack: READ_BACK }), at);
    assert.equal(nameless.code, 1);
    assert.match(nameless.err, /no-doc names no document/);
    assert.equal(helper.held.filter((e) => e.kind === 'amendment').length, 1, 'nothing refused was written');
  });
});

test('record never writes a card, an answer, a shown or asked record, or a signed kind', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const kind of ['card', 'card-answer', 'shown', 'asked', ...PROTECTED_KINDS, 'action', 'confirmation', 'question', 'unknown']) {
      const out = await run(helper, ['record', kind], JSON.stringify({ question: 'Approve?', label: 'Approve', cards: ['x'] }));
      assert.equal(out.code, 1, kind);
      assert.match(out.err, /record takes/);
    }
    assert.deepEqual(helper.calls, [], 'the helper was never asked');
  });
});

test('a setting made by a usage card\'s pick carries the time of the card\'s offer, and nothing else extra', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const at = '2026-10-26T01:00:00.000Z';
    const ready = ['lean'];
    const run = (h, argv, input) => runWith(h, argv, input, { ready });
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'efficiency', value: 'lean', usageCard: at, other: 1 }))).code, 0);
    assert.deepEqual(helper.writes()[0].data, { key: 'efficiency', value: 'lean', usageCard: at, words: 'Thoroughness: Lean' });
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'efficiency', value: 'lean', usageCard: 'not a time' }))).code, 0);
    assert.equal('usageCard' in helper.writes()[1].data, false);
  });
});

test('a compaction window at or below the point to prepare at is refused, and a larger one is recorded', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const low = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'compactWindow', value: 200000 }));
    assert.equal(low.code, 1);
    assert.match(low.err, /has to be larger than the point to prepare at/);
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'compactPrepare', value: 290000 }))).code, 0);
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'compactWindow', value: 320000 }))).code, 0);
  });
});

test('a Thoroughness level whose column is not ready is refused, in plain words, before it reaches the helper', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const value of ['lean', 'lightest']) {
      const out = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'efficiency', value }));
      assert.equal(out.code, 1);
      assert.match(out.err, /isn't ready yet, so Thoroughness stays as it is/);
    }
    assert.equal((await runWith(helper, ['record', 'setting'], JSON.stringify({ key: 'efficiency', value: 'thorough' }))).code, 0);
    assert.equal((await runWith(helper, ['record', 'setting'], JSON.stringify({ key: 'efficiency', value: 'lightest' }), { ready: ['lean'] })).code, 1);
    assert.equal((await runWith(helper, ['record', 'setting'], JSON.stringify({ key: 'efficiency', value: 'lightest' }), { ready: ['lean', 'lightest'] })).code, 0);
  });
});

test('the premium model can be set back to off but never turned on by the front desk', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const value of ['within-plan', 'paid-too']) {
      const out = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'premium', value }));
      assert.equal(out.code, 1);
      assert.match(out.err, /turned on only through its own opt-in cards/);
    }
    assert.deepEqual(helper.writes(), []);
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'premium', value: 'off' }))).code, 0);
  });
});

test('a setting the catalogue refuses is refused before it reaches the helper', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    for (const data of [{ key: 'pace', value: 9 }, { key: 'noSuchThing', value: 1 }, { key: 'autonomy', value: 'balanced', until: '2026-10-20T00:00:00.000Z' }]) {
      const out = await run(helper, ['record', 'setting'], JSON.stringify(data));
      assert.equal(out.code, 1, JSON.stringify(data));
      assert.equal(out.err.trim().split('\n').length, 1);
    }
    assert.deepEqual(helper.calls, []);
    // A project's setting goes to the project's state, the director's own to their profile.
    assert.equal((await run(helper, ['record', 'setting'], JSON.stringify({ key: 'pace', value: 2 }))).code, 0);
    assert.deepEqual(helper.writes()[0].data, { key: 'pace', value: 2, words: 'Crew at once: 2' });
    const profile = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'presence', value: 'away', until: '2026-10-20T00:00:00.000Z' }));
    assert.equal(profile.code, 0, profile.err);
    assert.deepEqual(helper.calls.find(([name]) => name === 'profile.write'), ['profile.write', {
      kind: 'setting', data: { key: 'presence', value: 'away', until: '2026-10-20T00:00:00.000Z', words: 'Availability: away, until 20 October 2026, 00:00 UTC' },
    }]);
  });
});

test('record setting records its confirm card and marks it asked, and refuses a concept setting', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    // The director's own setting: written to the profile, then its card, naming the id the profile gave it.
    const tab = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'boardTab', value: 'build', because: 'given by the front desk' }));
    assert.equal(tab.code, 0, tab.err);
    const data = { key: 'boardTab', value: 'build', words: 'Logbook opens on: build' };
    assert.deepEqual(helper.calls.filter(([name]) => name === 'profile.write'), [['profile.write', { kind: 'setting', data }]]);
    const [card, asked] = helper.writes();
    assert.equal(card.kind, 'card');
    assert.equal(card.data.line, confirmLine({ kind: 'setting', id: 'p-1', data }));
    assert.equal(tab.json.id, 'p-1');
    assert.equal(tab.json.card.question.question, chatCopy(card.data.question));
    assert.ok(card.data.question.includes('Logbook opens on: build'));
    assert.deepEqual(asked.data, { cards: [tab.json.card.id] });

    // A concept setting an earlier version kept is no setting now: it is refused, and nothing is written.
    const before = helper.writes().length;
    const known = await run(helper, ['record', 'setting'], JSON.stringify({ key: 'known:ci', value: false }));
    assert.equal(known.code, 1);
    assert.equal(helper.writes().length, before);

    // A project's setting is written under the id its card was composed with.
    const pace = await main(['record', 'setting'], {
      cwd: CWD, client: helper.client, input: JSON.stringify({ key: 'pace', value: 1 }), now: () => NOW, makeId: () => 'id-pace', out: () => {}, err: () => {},
    });
    assert.equal(pace, 0);
    const [setting, paceCard] = helper.writes().slice(before);
    assert.equal(setting.id, 'id-pace');
    assert.equal(paceCard.data.line, confirmLine({ kind: 'setting', id: 'id-pace', data: { key: 'pace', value: 1, words: 'Crew at once: 1' } }));

    // Under STOP nothing is written, and no card is made for a setting that wasn't.
    const stopped = fakeHelper({ stop: true });
    const refused = await run(stopped, ['record', 'setting'], JSON.stringify({ key: 'boardTab', value: 'build' }));
    assert.equal(refused.code, 1);
    assert.deepEqual(stopped.writes(), []);
  });
});

test('record setting never turns on build commands on Windows, and can set them back to ask', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const key = 'windowsBuildCommands:abcdef12';
    for (const value of ['unattended', 'guarded']) {
      const refused = await run(helper, ['record', 'setting'], JSON.stringify({ key, value }));
      assert.equal(refused.code, 1, value);
      assert.match(refused.err, /turned on only by a click on their own card/);
    }
    assert.deepEqual(helper.writes(), []);
    const off = await run(helper, ['record', 'setting'], JSON.stringify({ key, value: 'ask' }));
    assert.equal(off.code, 0, off.err);
    assert.deepEqual(helper.writes()[0].data, { key, value: 'ask', words: 'Build commands on Windows: ask' });
  });
});

// A product question on the topic copy-changes, asked at T(n) and decided as recommended a second later.
const approvedOn = (pr, n, topic = 'copy-changes') => {
  const card = cardEvent({ ...PRODUCT(pr), level: 3, topic }, n);
  return [card, makeEvent({ kind: 'card-answer', data: { card: card.id, label: 'Plain' }, now: () => T(n + 1) })];
};
const reversalOf = (topic, n) => makeEvent({ kind: 'reversal', data: { topic, what: 'The director undid a change made alone' }, now: () => T(n) });

test('card takes a topic as a slug, in lower case, and refuses one that is not', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const given = await run(helper, ['card'], JSON.stringify({ ...PRODUCT(1), topic: ' Copy-Changes ' }));
    assert.equal(given.code, 0, given.err);
    assert.equal(helper.held.find((e) => e.kind === 'card').data.topic, 'copy-changes');
    for (const topic of ['copy changes', 'copy_changes', '', 'x'.repeat(41), 7]) {
      const refused = await run(helper, ['card'], JSON.stringify({ ...PRODUCT(2), topic }));
      assert.equal(refused.code, 1, JSON.stringify(topic));
      assert.match(refused.err, /topic/);
    }
    assert.equal(helper.held.filter((e) => e.kind === 'card').length, 1);
  });
});

test('record reversal keeps its topic as a slug in lower case, as a card does', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const out = await run(helper, ['record', 'reversal'], JSON.stringify({ topic: 'Colours', what: 'The director put the old colours back' }));
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(helper.writes()[0].data, { topic: 'colours', what: 'The director put the old colours back' });
    const refused = await run(helper, ['record', 'reversal'], JSON.stringify({ topic: 'the colours', what: 'Undone' }));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /topic/);
    assert.equal(helper.writes().length, 1);
  });
});

test('views levels lists the topics on earlier cards', async () => {
  await inHome(async () => {
    const events = [cardEvent({ ...PRODUCT(1), topic: 'pricing' }, 4), cardEvent({ ...PRODUCT(2), topic: 'copy-changes' }, 5)];
    const out = await run(fakeHelper({ events }), ['views', 'levels']);
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(out.out.trim().split('\n'), ['"copy-changes": on earlier cards', '"pricing": on earlier cards']);
    assert.equal((await run(fakeHelper(), ['views', 'levels'])).out, 'No decision topics yet.\n');
  });
});

test('again gives the card the board numbers n, with its id, and records it as asked', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const two = cardEvent(PRODUCT(2), 2);
    const events = [one, two, makeEvent({ kind: 'card-answer', data: { card: one.id, label: 'Not now' }, now: () => T(3) })];
    const helper = fakeHelper({ events });
    const model = boardModel({ views: buildViews(events, readEnrolled(), { now: () => NOW }), events, now: NOW });
    const n = model.director.waiting.findIndex((w) => w.since === one.at) + 1;
    const out = await run(helper, ['again', String(n)]);
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(out.json.questions.map((q) => q.question), [one.data.question]);
    assert.equal(out.json.id, one.id, 'again names the card it gives by its id');
    assert.deepEqual(helper.calls.map(([name, body]) => [name, body.view ?? body.data?.cards]), [['desk.read', 'waiting'], ['write', [one.id]]]);
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: [one.id] } }]);
    for (const bad of [['again', '9'], ['again', '0'], ['again', 'x'], ['again'], ['again', '1', '2']]) {
      assert.equal((await run(helper, bad)).code, 1, bad.join(' '));
    }
    assert.equal(helper.writes().length, 1);
  });
});

test('why n notes a Why? answer for card n and says the one sentence to put before the card', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const two = cardEvent(PRODUCT(2), 2);
    const helper = fakeHelper({ events: [one, two] });
    const model = boardModel({ views: helper.views(), events: [one, two], now: NOW });
    const n = model.director.waiting.findIndex((w) => w.since === two.at) + 1;
    const out = await run(helper, ['why', String(n)]);
    assert.equal(out.code, 0, out.err);
    const [noted, how, sentence] = out.out.trimEnd().split('\n');
    assert.equal(noted, `Noted that you asked why about card ${n}.`);
    // A card with no glossary term that has an example: the sentence's form, for the front desk to fill.
    assert.equal(how, `Say one sentence and nothing else, then card ${n} from \`again ${n}\` in your clickable-question tool, in the same message:`);
    assert.equal(sentence, `It's like <an everyday comparison>: <what card ${n} decides, in plain words>.`);
    // The answer names the card's question as it was shown, as the pane's own answers do.
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'card-answer', data: { question: two.data.question, label: WHY, where: 'chat' } }]);
    // It never gives the card again, and a Why? decides nothing: the card still waits.
    assert.deepEqual(helper.views().waiting.map((c) => [c.id, c.asked?.label]).sort(), [[one.id, undefined], [two.id, WHY]].sort());
    for (const bad of [['why', '9'], ['why', '0'], ['why', 'x'], ['why']]) {
      assert.equal((await run(helper, bad)).code, 1, bad.join(' '));
    }
    assert.equal(helper.writes().length, 1);
  });
});

test('why decision n asks the session copy for decision n and notes nothing, with typed replies off or on', async () => {
  await inHome(async () => {
    const own = {
      id: 'q-export-csv-1000003', work: 'export-csv', what: 'Should the export carry headers?', why: 'It changes what customers download.',
      options: [{ label: 'Headers', says: 'The first row names each column.' }, { label: 'No headers', says: 'Only the data.' }],
      recommendation: 'Headers', level: 3,
    };
    const helper = fakeHelper({ events: [questionEvent(own)] });
    await run(helper, ['cards']);
    const asked = [];
    const ask = async (body) => { asked.push(body); return { answer: 'It read the sample.', fork: 'f-1' }; };
    const writesBefore = helper.writes().length;
    const out = await runWith(helper, ['why', 'decision', '1', 'Why', 'headers?'], undefined, { ask });
    assert.equal(out.code, 0, out.err);
    assert.match(out.out, /It read the sample\./);
    assert.equal(asked[0].words, 'Why headers?');
    assert.equal(helper.writes().length, writesBefore, 'nothing is noted or recorded');
    const missing = await runWith(helper, ['why', 'decision', '9'], undefined, { ask });
    assert.equal(missing.code, 1);
    assert.equal((await runWith(helper, ['why', 'decision'], undefined, { ask })).code, 1);
  });
});

test('why n [words] adds a read-only session copy\'s answer when the card is a waiting decision, and asks it what the director said', async () => {
  await inHome(async () => {
    const own = {
      id: 'q-export-csv-1000002', work: 'export-csv', what: 'Should the export carry headers?', why: 'It changes what customers download.',
      options: [{ label: 'Headers', says: 'The first row names each column.' }, { label: 'No headers', says: 'Only the data.' }],
      recommendation: 'Headers', level: 3,
    };
    const helper = fakeHelper({ events: [questionEvent(own)] });
    await run(helper, ['cards']);
    const asked = [];
    const ask = async (body) => { asked.push(body); return { answer: 'It read the sample file and found no row names.', fork: 'f-1' }; };
    const out = await runWith(helper, ['why', '1', 'Why', 'headers?'], undefined, { ask });
    assert.equal(out.code, 0, out.err);
    const lines = out.out.trimEnd().split('\n');
    assert.equal(lines[0], 'Noted that you asked why about card 1.');
    assert.match(lines[1], /^Say /, 'the instant answer comes first');
    assert.match(lines.at(-2), /^The session that raised this decision answers/);
    assert.equal(lines.at(-1), 'It read the sample file and found no row names.');
    assert.equal(asked.length, 1);
    assert.equal(asked[0].cwd, CWD);
    assert.equal(asked[0].words, 'Why headers?');
    assert.match(asked[0].id, /^[0-9a-z-]+$/, 'the decision is named by its id');
    assert.equal('n' in asked[0], false);
    // It only explains: the decision still waits.
    const shown = await run(helper, ['decision', 'show', '1']);
    assert.equal(shown.code, 0, shown.err);

    // A copy that can't be asked says so in its own line, and the Why? still works.
    const failed = await runWith(helper, ['why', '1'], undefined, { ask: async () => { throw new Error('no session'); } });
    assert.equal(failed.code, 0, failed.err);
    assert.match(failed.out, /couldn't be asked: no session/);
    const fell = await runWith(helper, ['why', '1'], undefined, { ask: async () => ({ fallback: 'That piece has finished.' }) });
    assert.match(fell.out, /That piece has finished\./);
  });
});

test('why n on a card that is no decision never asks a session copy', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const helper = fakeHelper({ events: [one] });
    let asked = false;
    const out = await runWith(helper, ['why', '1', 'but why?'], undefined, { ask: async () => { asked = true; return { answer: 'x' }; } });
    assert.equal(out.code, 0, out.err);
    assert.equal(asked, false);
  });
});

test('why n on a card that uses a glossary term gives the whole sentence, with the term\'s everyday example (scenario 36)', async () => {
  await inHome(async () => {
    const approval = cardEvent({ ...APPROVAL, what: 'Pull request #7 changes the wording on the sign-in page, and merges it.', target: { pr: 7, sha: FULL } }, 1);
    const helper = fakeHelper({ events: [approval] });
    const out = await run(helper, ['why', '1']);
    assert.equal(out.code, 0, out.err);
    const [, how, sentence] = out.out.trimEnd().split('\n');
    assert.equal(how, 'Say this one sentence, word for word, and nothing else, then card 1 from `again 1` in your clickable-question tool, in the same message:');
    assert.match(sentence, /^It's like [a-z].+: card 1 asks "Put pull request #7 live\?"$/);
  });
});

test('drop ends a queued copy with a closed report, and refuses work that is not open', async () => {
  await inHome(async () => {
    const first = makeEvent({ kind: 'work', data: { id: 'version-flag', title: 'Print the version', lane: 'quick', visible: false, dependsOn: [] }, now: () => T(1) });
    const copy = makeEvent({ kind: 'work', data: { id: 'version-flag-2', title: 'Print the version', lane: 'quick', visible: false, dependsOn: [] }, now: () => T(2) });
    const helper = fakeHelper({ events: [first, copy] });
    const out = await run(helper, ['drop', 'version-flag-2']);
    assert.equal(out.code, 0, out.err);
    assert.match(out.json.say, /will not be built/);
    assert.deepEqual(helper.writes().map((w) => [w.kind, w.data.work, w.data.outcome]), [['report', 'version-flag-2', 'closed']]);
    // It is out of the open work now, so a second drop and an unknown name are refused with nothing more written.
    for (const args of [['drop', 'version-flag-2'], ['drop', 'nothing-here'], ['drop']]) {
      const refused = await run(helper, args);
      assert.equal(refused.code, 1, args.join(' '));
    }
    assert.match((await run(helper, ['drop', 'version-flag-2'])).err, /isn't open work: the open work is version-flag\n$/);
    assert.equal(helper.writes().length, 1);
  });
});

test('drop takes away the request\'s file in .wheelhouse/work, and leaves one that other work names or that lies elsewhere', async () => {
  await inHome(async () => {
    const dir = tempFolder('wh-frontdesk-drop-');
    fs.mkdirSync(path.join(dir, '.wheelhouse', 'work'), { recursive: true });
    const own = path.join(dir, '.wheelhouse', 'work', 'help-flag.md');
    const shared = path.join(dir, '.wheelhouse', 'work', 'version-flag.md');
    const outside = path.join(dir, 'NOTES.md');
    for (const file of [own, shared, outside]) fs.writeFileSync(file, 'what was asked\n');
    const doc = (file) => ({ path: path.relative(dir, file), hash: 'a'.repeat(64) });
    const work = (id, file, n) => makeEvent({ kind: 'work', data: { id, title: id, lane: 'quick', visible: false, dependsOn: [], doc: doc(file) }, now: () => T(n) });
    const helper = fakeHelper({ events: [work('help-flag', own, 1), work('version-flag', shared, 2), work('version-flag-2', shared, 3), work('notes', outside, 4)] });
    for (const id of ['help-flag', 'version-flag-2', 'notes']) {
      const out = await runWith(helper, ['drop', id], undefined, { cwd: dir });
      assert.equal(out.code, 0, out.err);
    }
    assert.equal(fs.existsSync(own), false, 'its own request file goes');
    assert.equal(fs.existsSync(shared), true, 'a file the other open work names stays');
    assert.equal(fs.existsSync(outside), true, 'a file outside .wheelhouse/work stays');
  });
});

test('suggest hands a suggested change on an approval card to the build as one work record, and gives the one line to say (scenario 36)', async () => {
  await inHome(async () => {
    const approval = cardEvent({ ...APPROVAL, target: { pr: 7, sha: FULL } }, 2);
    const question = cardEvent(PRODUCT(1), 3);
    const work = makeEvent({ kind: 'work', data: { id: 'sign-in-words', title: 'New wording on the sign-in page', lane: 'small', visible: true, dependsOn: [], place: 3 }, now: () => T(1) });
    const helper = fakeHelper({ events: [work, approval, question] });
    const out = await run(helper, ['suggest', approval.id, 'sign-in-words', 'The sign-in page says Welcome back instead of Sign in']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.say, 'Noted. A new proposal will follow.');
    // The work as it was, its title the change in the front desk's words, then the card's answer Suggest a change…,
    // so the pane says a new proposal is on its way only once the change is handed on: nothing else is written.
    assert.deepEqual(helper.writes(), [
      { cwd: CWD, kind: 'work', data: { ...work.data, title: 'The sign-in page says Welcome back instead of Sign in' } },
      { cwd: CWD, kind: 'card-answer', data: { question: approval.data.question, label: SUGGEST, where: 'chat' } },
    ]);
    assert.equal(typeof helper.views().waiting.find((c) => c.id === approval.id).steered, 'string');

    // Refused, with nothing written: a card that doesn't wait, one that isn't an approval or a CI
    // push, work that isn't open, and a change missing or on two lines.
    for (const [args, why] of [
      [['suggest', 'c'.repeat(8), 'sign-in-words', 'A change'], /no longer waits/],
      [['suggest', question.id, 'sign-in-words', 'A change'], /is a question card: revise the proposal and compose its new card with `card`/],
      [['suggest', approval.id, 'no-such-work', 'A change'], /no-such-work isn't open work: the open work is sign-in-words/],
      [['suggest', approval.id, 'sign-in-words'], /suggest <card id> <work id> <the change in your own words>/],
      [['suggest', approval.id, 'sign-in-words', 'Two\nlines'], /one line/],
    ]) {
      const refused = await run(helper, args);
      assert.equal(refused.code, 1, args.join(' '));
      assert.match(refused.err, why);
    }
    assert.equal(helper.writes().length, 2);
  });
});

test('why n keeps its answer in pending/ when the helper doesn\'t take it, and says so when it can\'t keep it', async () => {
  await inHome(async () => {
    const waiting = cardEvent(PRODUCT(1), 1);
    const helper = fakeHelper({ events: [waiting] });
    const down = { ...helper.client, state: { ...helper.client.state, write: async () => ({ ok: false, refused: 'the host helper did not answer in time' }) } };
    // A folder that is no registered project has nowhere to keep it.
    const lost = await run({ client: down }, ['why', '1']);
    assert.equal(lost.code, 1);
    assert.match(lost.err, /Why\?/);
    assert.equal(lost.err.trim().split('\n').length, 1, 'one line');
    const folder = path.join(tempFolder('wh-why-'), 'shop');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const kept = await run({ client: down }, ['why', '1'], undefined, { cwd: folder });
    assert.equal(kept.code, 0, kept.err);
    assert.equal(kept.out.split('\n')[0], 'Noted that you asked why about card 1.');
    const files = fs.readdirSync(pendingDir('o__p')).filter((name) => name.endsWith('.json'));
    assert.equal(files.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pendingDir('o__p'), files[0]), 'utf8')),
      { route: 'write', body: { project: 'o__p', kind: 'card-answer', data: { question: waiting.data.question, label: WHY, where: 'chat' } } });
  });
});

test('why n under STOP notes nothing and says so', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ stop: true, events: [cardEvent(PRODUCT(1), 1)] });
    const out = await run(helper, ['why', '1']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.out, 'All stop is on, so nothing was noted about card 1.\n');
    assert.deepEqual(helper.writes(), []);
  });
});

test('card with revises and changed composes a revised card; revises naming no waiting card of this kind is refused', async () => {
  await inHome(async () => {
    const target = { pr: 7, sha: FULL };
    const old = cardEvent({ ...APPROVAL, target }, 1);
    const other = cardEvent(PRODUCT(1), 2);
    const decided = cardEvent(PRODUCT(2), 3);
    const answered = makeEvent({ kind: 'card-answer', data: { card: decided.id, label: 'Plain' }, now: () => T(4) });
    const helper = fakeHelper({ events: [old, other, decided, answered] });
    const revision = { ...APPROVAL, because: 'the review was clean', target, revises: old.id, changed: 'It now says the review was clean.' };
    // Refused: no such card, a card decided already, a card of another kind, and no line saying what changed.
    for (const revises of ['no-such-card', decided.id, other.id]) {
      const refused = await run(helper, ['card'], JSON.stringify({ ...revision, revises }));
      assert.equal(refused.code, 1, revises);
      assert.equal(refused.err, 'revises names no waiting card of this kind\n', revises);
    }
    // An approval of another pull request is no card of this kind to revise: the view would close nothing.
    const elsewhere = cardEvent({ ...APPROVAL, what: 'Pull request #8 changes the footer.', target: { pr: 8, sha: DOC } }, 5);
    helper.held.push(elsewhere);
    const wrongPr = await run(helper, ['card'], JSON.stringify({ ...revision, revises: elsewhere.id }));
    assert.equal(wrongPr.code, 1);
    assert.equal(wrongPr.err, 'revises names no waiting card of this kind\n');
    const unsaid = await run(helper, ['card'], JSON.stringify({ ...revision, changed: undefined }));
    assert.equal(unsaid.code, 1);
    assert.match(unsaid.err, /changed/);
    assert.deepEqual(helper.writes(), []);
    // Refused: the same head, which holds none of the change the words describe.
    const sameHead = await run(helper, ['card'], JSON.stringify(revision));
    assert.equal(sameHead.code, 1);
    assert.equal(sameHead.err, 'a revised approval needs the change committed first\n');
    assert.deepEqual(helper.writes(), []);
    // Composed once the head has moved: a new card with its own set line.
    const moved = { ...revision, target: { pr: 7, sha: DOC } };
    const done = await run(helper, ['card'], JSON.stringify(moved));
    assert.equal(done.code, 0, done.err);
    assert.notEqual(done.json.id, old.id);
    assert.equal(done.json.alreadyAsked, undefined);
    const recorded = helper.held.find((e) => e.id === done.json.id);
    assert.equal(recorded.data.revises, old.id);
    assert.equal(recorded.data.parts.changed, 'It now says the review was clean.');
    assert.notEqual(recorded.data.line, old.data.line);
    assert.deepEqual(helper.writes().map((w) => w.kind), ['card', 'asked']);
    // It replaces the card it revises on the board.
    assert.deepEqual(helper.views().waiting.map((c) => c.id).sort(), [other.id, elsewhere.id, done.json.id].sort());
  });
});

test('card with revises may name an approval card closed by a later head, and the revised card takes the place of the gate\'s card for that head', async () => {
  await inHome(async () => {
    const target = { pr: 7, sha: FULL };
    const old = cardEvent({ ...APPROVAL, target }, 2);
    const steered = makeEvent({ kind: 'card-answer', data: { card: old.id, label: 'Suggest a change…' }, now: () => T(3) });
    // The build committed the change: the gate asks about the new head, and its plain card waits for it.
    const plain = cardEvent({ ...APPROVAL, target: { pr: 7, sha: LATER } }, 5);
    const events = [EXPORT, gateAsks(APPROVE_ASK, () => T(1)), old, steered, gateAsks({ ask: 'approval', sha: LATER }, () => T(4)), plain];
    const helper = fakeHelper({ events, head: LATER });
    assert.deepEqual(helper.views().waiting.map((c) => c.id), [plain.id]);
    const revision = { ...APPROVAL, because: 'the banner is bigger now', revises: old.id, changed: 'The banner is in bigger type.' };
    // A revision at the old card's own head, or naming the gate's card at the head it is composed at, is refused.
    const atOld = await run(helper, ['card'], JSON.stringify({ ...revision, target }));
    assert.equal(atOld.err, 'a revised approval needs the change committed first\n');
    const ofPlain = await run(helper, ['card'], JSON.stringify({ ...revision, revises: plain.id, target: { pr: 7, sha: LATER } }));
    assert.equal(ofPlain.err, 'a revised approval needs the change committed first\n');
    assert.deepEqual(helper.writes(), []);
    // At the new head, named by the pull request alone, the revised card is composed and takes the gate's card's place.
    const done = await run(helper, ['card'], JSON.stringify({ ...revision, target: { pr: 7 } }));
    assert.equal(done.code, 0, done.err);
    assert.notEqual(done.json.id, plain.id);
    assert.deepEqual(helper.writes().map((w) => w.kind), ['card', 'asked']);
    const recorded = helper.held.find((e) => e.id === done.json.id);
    assert.equal(recorded.data.line, approvalLine(7, LATER));
    assert.equal(recorded.data.revises, old.id);
    assert.equal(recorded.data.parts.changed, 'The banner is in bigger type.');
    assert.deepEqual(helper.views().waiting.map((c) => c.id), [done.json.id]);
    // The old card is revised now, so it is no card to revise again; no second card is made.
    const again = await run(helper, ['card'], JSON.stringify({ ...revision, target: { pr: 7 } }));
    assert.equal(again.err, 'revises names no waiting card of this kind\n');
    assert.equal(cardWrites(helper).length, 1);
    // A card closed for any other reason is not one to revise: its work merged.
    const merged = makeEvent({ kind: 'report', data: { work: 'export-csv', outcome: 'merged', summary: 'Done.', rulings: [], pr: 7 }, now: () => T(6) });
    const finished = fakeHelper({ events: [...events, merged], head: LATER });
    const refused = await run(finished, ['card'], JSON.stringify({ ...revision, target: { pr: 7 } }));
    assert.equal(refused.err, 'revises names no waiting card of this kind\n');
  });
});

// X at the first head, closed by the gate's card A at the next head; the suggestion and the gate's record
// come at the times given (null for no suggestion). The revision is composed at the next head.
async function outdatedRevision({ at }) {
  const target = { pr: 7, sha: FULL };
  const old = cardEvent({ ...APPROVAL, target }, 2);
  const plain = cardEvent({ ...APPROVAL, target: { pr: 7, sha: LATER } }, 6);
  const suggestion = (card) => makeEvent({ kind: 'card-answer', data: { card: card.id, label: SUGGEST }, now: () => T(at) });
  const events = [EXPORT, gateAsks(APPROVE_ASK, () => T(1)), old, gateAsks({ ask: 'approval', sha: LATER }, () => T(5)), plain];
  const revision = { ...APPROVAL, because: 'the banner is bigger now', revises: old.id, changed: 'The banner is in bigger type.', target: { pr: 7 } };
  return { old, plain, events, suggestion, revision };
}
const MUST_FOLLOW = 'a revised approval must follow a suggested change on that card\n';

test('card with revises naming an outdated card is refused when the suggestion was on the gate\'s card only', async () => {
  await inHome(async () => {
    const { plain, events, suggestion, revision } = await outdatedRevision({ at: 7 });
    const helper = fakeHelper({ events: [...events, suggestion(plain)], head: LATER });
    const refused = await run(helper, ['card'], JSON.stringify(revision));
    assert.equal(refused.err, MUST_FOLLOW);
    assert.equal(refused.code, 1);
    assert.deepEqual(helper.writes(), []);
  });
});

test('card with revises naming an outdated card is refused when the card has no suggestion at all', async () => {
  await inHome(async () => {
    const { events, revision } = await outdatedRevision({ at: 4 });
    const helper = fakeHelper({ events, head: LATER });
    const refused = await run(helper, ['card'], JSON.stringify(revision));
    assert.equal(refused.err, MUST_FOLLOW);
    assert.deepEqual(helper.writes(), []);
  });
});

test('card with revises naming an outdated card is refused when the suggestion came after the gate\'s record for the head', async () => {
  await inHome(async () => {
    const { old, events, suggestion, revision } = await outdatedRevision({ at: 8 });
    const helper = fakeHelper({ events: [...events, suggestion(old)], head: LATER });
    const refused = await run(helper, ['card'], JSON.stringify(revision));
    assert.equal(refused.err, MUST_FOLLOW);
    assert.deepEqual(helper.writes(), []);
  });
});

test('card with revises naming an outdated card is accepted when the suggestion came before the gate\'s record for the head', async () => {
  await inHome(async () => {
    const { old, plain, events, suggestion, revision } = await outdatedRevision({ at: 3 });
    const helper = fakeHelper({ events: [...events, suggestion(old)], head: LATER });
    const done = await run(helper, ['card'], JSON.stringify(revision));
    assert.equal(done.code, 0, done.err);
    assert.notEqual(done.json.id, plain.id);
    assert.deepEqual(helper.views().waiting.map((c) => c.id), [done.json.id]);
    const recorded = helper.held.find((e) => e.id === done.json.id);
    assert.equal(recorded.data.line, approvalLine(7, LATER));
    assert.equal(recorded.data.parts.changed, 'The banner is in bigger type.');
    assert.match(done.json.question.question, /What changed:/);
  });
});

test('views waiting shows a steered card\'s time', async () => {
  await inHome(async () => {
    const steered = cardEvent(PRODUCT(1), 1);
    const plain = cardEvent(PRODUCT(2), 2);
    const answer = makeEvent({ kind: 'card-answer', data: { card: steered.id, label: SUGGEST }, now: () => T(30) });
    const helper = fakeHelper({ events: [steered, plain, answer] });
    const out = await run(helper, ['views', 'waiting']);
    assert.equal(out.code, 0, out.err);
    const two = (n) => String(n).padStart(2, '0');
    const at = new Date(answer.at);
    const lines = out.out.trim().split('\n');
    assert.equal(lines.length, 2);
    const line = (card) => lines.find((l) => l.includes(`(card ${card.id})`));
    assert.ok(line(steered).endsWith(` ${suggestedAt(`${two(at.getHours())}:${two(at.getMinutes())}`)}`), line(steered));
    assert.ok(line(plain).endsWith(`(card ${plain.id})`), line(plain));
  });
});

// --- one card, one answer: ask here, a decided card, the hour's answers ---

const SESSION = 'session-one';
const answerAt = (card, label, ms, where = 'panel') => makeEvent({ kind: 'card-answer', data: { card: card.id, label, where }, now: ago(ms) });

test('cards --here marks the handed-out ids, and the output is the same', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const two = cardEvent(PRODUCT(2), 2);
    const plain = await run(fakeHelper({ events: [one, two] }), ['cards']);
    const helper = fakeHelper({ events: [one, two] });
    const here = await run(helper, ['cards', '--here'], undefined, { env: { CLAUDE_CODE_SESSION_ID: SESSION } });
    assert.equal(here.code, 0, here.err);
    assert.deepEqual(here.json, plain.json);
    assert.equal(takeHere(SESSION, [one.id, two.id], NOW.getTime()), true);
    assert.equal(takeHere(SESSION, [one.id], NOW.getTime()), false, 'taken once');
  });
});

test('again <n> --here and pull-cards --here mark the ids they hand out', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const helper = fakeHelper({ events: [one] });
    const env = { CLAUDE_CODE_SESSION_ID: SESSION };
    const asked = await run(helper, ['again', '1', '--here'], undefined, { env });
    assert.equal(asked.code, 0, asked.err);
    assert.equal(asked.json.id, one.id);
    assert.equal(takeHere(SESSION, [one.id], NOW.getTime()), true);
    const two = cardEvent(PRODUCT(2), 2);
    helper.held.push(two);
    const pulled = await run(helper, ['pull-cards', '--here'], undefined, { env });
    assert.equal(pulled.code, 0, pulled.err);
    assert.equal(takeHere(SESSION, [two.id], NOW.getTime()), true);
  });
});

test('--here refuses with no session, and other arguments are still refused', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] });
    const none = await run(helper, ['cards', '--here'], undefined, { env: {} });
    assert.equal(none.code, 1);
    assert.equal(none.err, 'The session isn\'t known, so the cards can\'t be asked here.\n');
    assert.deepEqual(helper.writes(), [], 'nothing was marked asked');
    const word = await run(helper, ['cards', 'here'], undefined, { env: { CLAUDE_CODE_SESSION_ID: SESSION } });
    assert.equal(word.err, 'cards takes no arguments\n');
  });
});

test('card refuses an approval already approved at the same commit', async () => {
  await inHome(async () => {
    const input = { ...APPROVAL, target: { pr: 7, sha: FULL } };
    const old = cardEvent(input, 1);
    const helper = fakeHelper({ events: [old, answerAt(old, 'Approve', 10 * MINUTE)] });
    const out = await run(helper, ['card'], JSON.stringify(input));
    assert.equal(out.code, 1);
    assert.match(out.err, /^Already approved in the panel (on \d+ \w+ )?at \d\d:\d\d; nothing to ask\.\n$/);
    assert.doesNotMatch(out.err, new RegExp(old.id));
    assert.deepEqual(helper.writes(), []);
  });
});

test('card lets an approval through when the earlier one at that commit was only put off', async () => {
  await inHome(async () => {
    const input = { ...APPROVAL, target: { pr: 7, sha: FULL } };
    const old = cardEvent(input, 1);
    const helper = fakeHelper({ events: [old, answerAt(old, 'Not now', 10 * MINUTE)] });
    const out = await run(helper, ['card'], JSON.stringify(input));
    assert.equal(out.code, 0, out.err);
  });
});

test('card refuses another kind\'s set line decided within the hour, and lets it through just after', async () => {
  await inHome(async () => {
    const input = {
      kind: 'runbook', level: 3, what: 'Turn STOP on: nothing new will start until it is lifted.', why: 'The agents should pause.',
      options: [says('Do it')], recommend: 'Do it', because: 'it is the safest first step', meanwhile: 'Nothing changes.', target: { step: 1 },
    };
    const old = cardEvent(input, 1);
    const within = fakeHelper({ events: [old, answerAt(old, 'Do it', RECENT_MS, 'chat')] });
    const refused = await run(within, ['card'], JSON.stringify(input));
    assert.equal(refused.code, 1, refused.err);
    assert.match(refused.err, /^Already answered Do it in the chat (on \d+ \w+ )?at \d\d:\d\d; nothing to ask\.\n$/);
    assert.deepEqual(within.writes(), []);
    const later = fakeHelper({ events: [old, answerAt(old, 'Do it', RECENT_MS + 1, 'chat')] });
    const made = await run(later, ['card'], JSON.stringify(input));
    assert.equal(made.code, 0, made.err);
    assert.deepEqual(later.writes().map((w) => w.kind), ['card', 'asked']);
  });
});

test('views waiting lists the last hour\'s answers, and leaves the lead out when there are none', async () => {
  await inHome(async () => {
    const done = cardEvent(PRODUCT(1), 1);
    const decided = answerAt(done, 'Plain', 10 * MINUTE);
    const helper = fakeHelper({ events: [done, decided] });
    const out = await run(helper, ['views', 'waiting']);
    assert.equal(out.code, 0, out.err);
    const words = answeredWords({ card: done, decided: { at: decided.at, label: 'Plain', where: 'panel' } }, NOW);
    assert.deepEqual(out.out.trim().split('\n'), ['Nothing is waiting for the director.', RECENT_LEAD, `- ${subjectOf(done)}: ${words}`]);
    assert.doesNotMatch(out.out, new RegExp(done.id));
    // With a card waiting, the recent answers follow the list.
    const waiting = cardEvent(PRODUCT(2), 2);
    const both = (await run(fakeHelper({ events: [done, decided, waiting] }), ['views', 'waiting'])).out.trim().split('\n');
    assert.match(both[0], /^1\. Which name suits page 2\?/);
    assert.deepEqual(both.slice(1), [RECENT_LEAD, `- ${subjectOf(done)}: ${words}`]);
    // Older than the hour: nothing to list.
    const old = fakeHelper({ events: [done, answerAt(done, 'Plain', RECENT_MS + 60000)] });
    assert.equal((await run(old, ['views', 'waiting'])).out.trim(), 'Nothing is waiting for the director.');
  });
});

test('views and explain answer in short lines, and similar finds work that shares words', async () => {
  await inHome(async () => {
    const ruling = makeEvent({ kind: 'ruling', data: { words: 'Money is shown in dollars' }, now: () => T(1) });
    const work = makeEvent({ kind: 'work', data: { id: 'export-csv', title: 'Export a report as a spreadsheet', lane: 'feature', visible: true, dependsOn: [] }, now: () => T(2) });
    const idea = makeEvent({ kind: 'idea', data: { key: 'dark-mode', title: 'A dark theme for the shop' }, now: () => T(3) });
    const helper = fakeHelper({ events: [ruling, work, idea, cardEvent(PRODUCT(1), 4)] });
    const rulebook = await run(helper, ['views', 'rulebook']);
    assert.equal(rulebook.code, 0, rulebook.err);
    assert.match(rulebook.out, /Money is shown in dollars/);
    assert.match((await run(helper, ['views', 'waiting'])).out, /^1\. Which name suits page 1\?/m);
    assert.match((await run(helper, ['views', 'ideas'])).out, /A dark theme for the shop/);
    assert.match((await run(helper, ['views', 'glossary'])).out, /^pull request: /m);
    const settings = await run(helper, ['views', 'settings']);
    assert.match(settings.out, /^Crew at once: 3 \(the default\)$/m);
    assert.equal((await run(helper, ['views', 'secrets'])).code, 1);

    const explained = await run(helper, ['explain', 'pull', 'request']);
    assert.equal(explained.code, 0, explained.err);
    assert.match(explained.out, /^pull request: .+\nFor example: .+\n$/);
    assert.match((await run(helper, ['explain', 'PRs'])).out, /^pull request: /);
    assert.equal((await run(helper, ['explain', 'flibbertigibbet'])).code, 1);

    const found = await run(helper, ['similar'], 'Could we export the report to a spreadsheet?');
    assert.equal(found.code, 0, found.err);
    assert.equal(found.json.similar[0].id, 'export-csv');
    assert.equal(found.json.similar[0].kind, 'work');
    // The request's words may come as arguments instead, which STOP lets through; then standard
    // input is never read.
    const words = await run(helper, ['similar', 'Could we export', 'the report to a spreadsheet?'], 'not read');
    assert.equal(words.code, 0, words.err);
    assert.deepEqual(words.json, found.json);
    assert.equal((await run(helper, ['similar'], '  ')).code, 1);
    assert.deepEqual(helper.writes(), []);
  });
});

test('views work lists the running and waiting work in plain words, titles as written, and leaves ended work out', async () => {
  await inHome(async () => {
    const work = (id, title, lane, n, extra = {}) => makeEvent({ kind: 'work', data: { id, title, lane, visible: false, dependsOn: [], ...extra }, now: () => T(n) });
    const feature = (id, step, n, extra = {}) => makeEvent({ kind: 'feature', data: { work: id, step, ...extra }, now: () => T(n) });
    const report = (id, outcome, n, pr) => makeEvent({ kind: 'report', data: { work: id, outcome, summary: 'Over.', rulings: [], ...(pr ? { pr } : {}) }, now: () => T(n) });
    const helper = fakeHelper({
      events: [
        // Building, with the pull request the gate waits on.
        work('export-csv', 'Export a report as a spreadsheet', 'feature', 1),
        feature('export-csv', 'building', 2, { slice: { n: 2, m: 3 } }),
        gateAsks(APPROVE_ASK, () => T(3)),
        // Quick work started: it builds at once. Its title carries worker labels.
        work('ci-badge', 'Show the CI status on the PR page', 'quick', 4),
        feature('ci-badge', 'started', 5),
        // Planned and waiting for the go-ahead; paused for the five-hour window.
        work('menu-photos', 'Photos on the menu', 'small', 5),
        feature('menu-photos', 'planned', 6),
        work('loyalty', 'A loyalty stamp card', 'small', 5),
        feature('loyalty', 'paused', 6, { pausedFor: 'five-hour' }),
        // Queued, needing no approval; and waiting for the director's approval.
        work('typo-fix', 'Correct the spelling on the menu', 'bug', 6),
        work('dark-theme', 'A dark theme for the shop', 'small', 7),
        // Merged: ended by its report.
        work('opening-hours', 'Opening hours on the home page', 'quick', 8),
        report('opening-hours', 'merged', 9, 14),
        // Ended blocked: its feature closed with the report.
        work('gift-cards', 'Gift cards at the till', 'small', 10),
        feature('gift-cards', 'building', 11),
        report('gift-cards', 'blocked', 12, 15),
        feature('gift-cards', 'closed', 13),
        // Closed, then queued again: open once more, its old report and gate click kept out of it.
        work('newsletter', 'A monthly newsletter sign-up', 'small', 14),
        gateAsks({ ...APPROVE_ASK, work: 'newsletter', pr: 16 }, () => T(15)),
        feature('newsletter', 'closed', 15),
        report('newsletter', 'closed', 15, 16),
        work('newsletter', 'A monthly newsletter sign-up', 'small', 16),
        // Building as its feature step says, but held by the director's Not now to its build commands.
        work('gallery', 'A photo gallery', 'feature', 17),
        feature('gallery', 'building', 18),
        makeEvent({ kind: 'question', data: { id: 'q-gallery-1', work: 'gallery', what: 'Let the builder run its tests', why: 'w', options: BUILD_QUESTION_OPTIONS, recommendation: BUILD_QUESTION_LABELS.once, level: 3, commands: ['npm test'] }, now: () => T(19) }),
        makeEvent({ kind: 'card-answer', data: { question: 'May the builder run npm test?\n\nAnswer question q-gallery-1', label: BUILD_QUESTION_LABELS.notNow }, now: () => T(20) }),
      ],
    });
    const out = await run(helper, ['views', 'work']);
    assert.equal(out.code, 0, out.err);
    const lines = out.out.trimEnd().split('\n');
    const line = (id) => lines.find((l) => l.startsWith(`${id}: `)) ?? '';
    // Each as the board's build tab gives a feature: its title and lane, then whether a feature runs
    // for it, its step or state and its pull request.
    assert.equal(line('export-csv'), 'export-csv: Export a report as a spreadsheet (a feature): running, building, piece 2 of 3, proposed change #7');
    // A work title is kept as written, worker labels and all, as the board keeps it (design section 21).
    assert.equal(line('ci-badge'), 'ci-badge: Show the CI status on the PR page (quick work): running, building');
    assert.equal(line('menu-photos'), 'menu-photos: Photos on the menu (small work): not running, planned, waiting for the go-ahead to build');
    assert.equal(line('loyalty'), 'loyalty: A loyalty stamp card (small work): not running, paused until the five-hour usage window has room');
    assert.equal(line('typo-fix'), 'typo-fix: Correct the spelling on the menu (a bug fix): not running, queued, not started yet');
    assert.equal(line('dark-theme'), 'dark-theme: A dark theme for the shop (small work): not running, waiting for the director\'s approval');
    assert.equal(line('newsletter'), 'newsletter: A monthly newsletter sign-up (small work): not running, waiting for the director\'s approval');
    assert.equal(line('gallery'), 'gallery: A photo gallery (a feature): not running, waiting for the director to allow its build commands');
    for (const ended of ['opening-hours', 'gift-cards']) assert.equal(line(ended), '', ended);
    // Running work first, each oldest first, then by id.
    assert.deepEqual(lines.filter((l) => /^[a-z-]+: /.test(l)).map((l) => l.split(':')[0]), ['export-csv', 'ci-badge', 'loyalty', 'menu-photos', 'typo-fix', 'dark-theme', 'newsletter', 'gallery']);
    // A term only in a title kept as written gets no Terms line, as on the board.
    assert.doesNotMatch(out.out, /Terms:/);
    assert.deepEqual(helper.writes(), []);

    const none = await run(fakeHelper({ events: [work('opening-hours', 'Opening hours', 'quick', 1), report('opening-hours', 'merged', 2)] }), ['views', 'work']);
    assert.equal(none.out, 'No work is open: nothing is running or waiting.\n');
  });
});

test('views work ends a running piece\'s line with its latest step, finding the project from the folder', async () => {
  await inHome(async () => {
    const folder = path.join(tempFolder('wh-frontdesk-crew-'), 'shop');
    fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
    writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
    const keep = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); writeJsonFile(file, value); };
    keep(runningFile('o__p', 'feature-login'), { state: 'running', pid: process.pid, at: '2026-11-08T01:00:00.000Z' });
    keep(sessionFile('o__p', 'login'), { sessionId: 's1' });
    const config = tempFolder('wh-frontdesk-config-');
    fs.mkdirSync(path.join(config, 'projects', 'a'), { recursive: true });
    const step = { type: 'assistant', timestamp: '2026-11-08T01:00:00Z', cwd: '/w/tree', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/w/tree/a.ts' } }] } };
    fs.writeFileSync(path.join(config, 'projects', 'a', 's1.jsonl'), `${JSON.stringify(step)}\n`);
    const helper = fakeHelper({
      events: [
        makeEvent({ kind: 'work', data: { id: 'login', title: 'The login page', lane: 'quick', visible: false, dependsOn: [] }, now: () => T(1) }),
        makeEvent({ kind: 'feature', data: { work: 'login', step: 'building' }, now: () => T(2) }),
      ],
    });
    const was = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      const out = await run(helper, ['views', 'work'], undefined, { cwd: folder });
      assert.equal(out.code, 0, out.err);
      assert.ok(out.out.split('\n').find((l) => l.startsWith('login: ')).endsWith(' \u00b7 Reading `a.ts`'), out.out);
      // A folder in no project shows the same work with no step.
      const none = await run(helper, ['views', 'work']);
      assert.doesNotMatch(none.out, /Reading/);
    } finally {
      if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was;
    }
  });
});

test('under STOP the reading commands run and record is refused', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ stop: true, events: [cardEvent(PRODUCT(1), 1), questionEvent()] });
    const cards = await run(helper, ['cards']);
    assert.equal(cards.code, 0, cards.err);
    // The Lift All stop card alone; the waiting card stays on the board. The question's card can't be
    // written under STOP, so none is tried, and nothing is written.
    assert.deepEqual(cards.json.questions.map((q) => q.header), ['All stop']);
    assert.equal(cards.json.left, 1);
    assert.equal(cards.json.problems, undefined);
    assert.deepEqual(helper.writes(), []);
    const again = await run(helper, ['again', '1']);
    assert.equal(again.code, 0);
    assert.equal(again.json.problems, undefined);
    for (const name of ['rulebook', 'waiting', 'ideas', 'glossary', 'settings', 'levels', 'work']) assert.equal((await run(helper, ['views', name])).code, 0, name);
    assert.equal((await run(helper, ['explain', 'merge'])).code, 0);
    assert.equal((await run(helper, ['similar'], 'export a report')).code, 0);
    assert.equal((await run(helper, ['similar', 'export', 'a', 'report'])).code, 0);
    const recorded = await run(helper, ['record', 'idea'], JSON.stringify({ key: 'x', title: 'An idea' }));
    assert.equal(recorded.code, 1);
    assert.equal(recorded.err, 'STOP is on\n');
    assert.equal((await run(helper, ['card'], JSON.stringify(PRODUCT(2)))).code, 1);
  });
});

test('under STOP, cards gives the Lift All stop card alone, never recorded, and the director\'s click on it lifts STOP', async () => {
  await inHome(async () => {
    setStop({ by: 'prompt' });
    const waiting = [1, 2, 3, 4].map((n) => cardEvent(PRODUCT(n), n));
    const helper = fakeHelper({ stop: () => stopState().on, events: [...waiting, questionEvent()] });
    const visit = await run(helper, ['cards']);
    assert.equal(visit.code, 0, visit.err);
    assert.equal(visit.json.questions.length, 1, 'the Lift All stop card alone, as the hook\'s line of 1 says');
    const [lift] = visit.json.questions;
    assert.equal(lift.header, 'All stop');
    assert.equal(setLineOf(lift.question), LIFT_STOP);
    assert.deepEqual(lift.options.map((o) => o.label), ['Lift All stop', 'Show me', 'Not now']);
    // The four cards waiting stay on the board, counted as left; nothing is written, so nothing is refused.
    assert.equal(visit.json.left, 4);
    assert.equal(visit.json.problems, undefined);
    assert.deepEqual(helper.writes(), []);
    assert.equal(helper.held.filter((e) => e.kind === 'card').length, 4);
    // The card check takes the visit's cards as they are.
    const ask = { cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: visit.json.questions } };
    assert.equal(await cardCheck(ask, { projectOf: () => ({ project: 'o__p' }) }), undefined);
    // The director clicks Lift All stop: the prompt record signs the lift, after the card's shown
    // record, and STOP is lifted.
    const records = [];
    const api = {
      state: { record: async (b) => { records.push(b.event); return { ok: true }; }, write: async () => ({ ok: true }) },
      profile: { record: async () => ({ ok: true }) },
    };
    const answers = { [lift.question]: 'Lift All stop' };
    await promptRecord(
      { cwd: CWD, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [lift], answers }, tool_response: { answers } },
      { client: api, now: () => new Date(), projectOf: () => ({ project: 'o__p' }) },
    );
    assert.deepEqual(records.map((e) => [e.kind, e.data.action ?? e.data.options]), [['shown', lift.options.map((o) => o.label)], ['action', 'lift-stop']]);
    assert.equal(records[1].data.question, lift.question);
    assert.equal(stopState().on, false);
    // With STOP off, a visit has no Lift All stop card, and the cards waiting are asked.
    const after = await run(helper, ['cards']);
    assert.ok(after.json.questions.every((q) => q.header !== 'All stop'), JSON.stringify(after.json));
    assert.deepEqual(after.json.questions.map((q) => q.question), waiting.map((e) => e.data.question));
  });
});

const PLAIN_QUESTION = {
  ...QUESTION,
  what: 'The pull request for slice 2 needs a review before it can go on.',
  why: 'Without it `npm run build` stays red, and "pull request" is the word the host shows.',
  options: [{ label: 'Wait', says: 'The slice waits for its review.' }, { label: 'Skip', says: 'It goes on with no review.' }],
  recommendation: 'Wait',
};

test('a card\'s words are in the glossary\'s plain words; what must be recognised stays as written', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ events: [...typedOn(), questionEvent(PLAIN_QUESTION)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    const card = helper.writes().find((w) => w.kind === 'card').data;
    assert.deepEqual(out.json.questions, [], 'a decision is asked in chat, not on the picker');
    // Each term the director doesn't know is put in plain words where it is first used in the card.
    assert.match(card.question, /^The proposed change for piece 2 needs an independent check before it can go on\.$/m);
    // A quotation and a command are kept as written.
    assert.match(card.question, /^Without it `npm run build` stays red, and "pull request" is the word the host shows\.$/m);
    // A term used again is kept, with its meaning at the end of the card's last part.
    const glossary = glossaryOf({});
    assert.match(card.question, /^Meanwhile that work waits, and the rest carries on\. Terms: (?:slice|review) means .+\.$/m);
    assert.ok(card.question.includes(`slice means ${glossary.slice.plain}`) && card.question.includes(`review means ${glossary.review.plain}`), card.question);
    // The labels the director clicks stay as the build wrote them.
    assert.deepEqual(card.options.slice(0, 2), ['Wait', 'Skip']);
    // The concepts are the terms of the card as written, before any were replaced.
    const raw = composeCard({ ...answerInput(PLAIN_QUESTION, 'export-csv'), glossary });
    assert.deepEqual(card.concepts, raw.card.concepts);
    assert.ok(card.concepts.includes('pull request') && card.concepts.includes('slice'), card.concepts.join());
  });
});

test('a card the plain words would take past its length is composed as written', async () => {
  await inHome(async () => {
    // The longest why that still composes as written, with a term the plain words make longer.
    const base = { ...QUESTION, what: 'The pull request is ready.' };
    let n = 0;
    const fits = (k) => { try { composeCard(answerInput({ ...base, why: `It needs ${'w'.repeat(k)}.` }, 'export-csv')); return true; } catch { return false; } };
    while (fits(n + 1)) n += 1;
    const long = { ...base, why: `It needs ${'w'.repeat(n)}.` };
    assert.ok(plainWords('The pull request is ready.', glossaryOf({})).text.length > 'The pull request is ready.'.length);
    const helper = fakeHelper({ events: [...typedOn(), questionEvent(long)] });
    const out = await run(helper, ['cards']);
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.problems, undefined);
    assert.deepEqual(out.json.questions, [], 'a decision is asked in chat, not on the picker');
    assert.equal(helper.writes().filter((w) => w.kind === 'card').length, 1);
  });
});

test('the explanations setting alone decides what is put in plain words, and a concept an old record calls known changes nothing', async () => {
  await inHome(async () => {
    const setting = (key, value) => ({ key, id: key, at: '2026-10-01T00:00:00.000Z', value, before: null });
    const some = fakeHelper({ events: [questionEvent(PLAIN_QUESTION)], profile: { explanations: setting('explanations', 'some-terms') } });
    await run(some, ['cards']);
    const kept = some.writes().find((w) => w.kind === 'card').data.question;
    assert.match(kept, /^The pull request for slice 2 needs a review before it can go on\.$/m);
    assert.match(kept, / Terms: pull request means /);
    const known = fakeHelper({ events: [questionEvent(PLAIN_QUESTION)], profile: { 'known:pull-request': setting('known:pull-request', true) } });
    await run(known, ['cards']);
    assert.match(known.writes().find((w) => w.kind === 'card').data.question, /^The proposed change for piece 2 needs an independent check before it can go on\.$/m);
  });
});

test('card and record ruling put their cards in plain words too, keeping what the set line names', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const approval = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, target: { pr: 7 } }));
    assert.equal(approval.code, 0, approval.err);
    assert.match(approval.json.question.question, /^Proposed change #7 changes the wording on the sign-in page\.$/m);
    assert.equal(approval.json.question.question.includes(approvalLine(7, FULL)), false);
    const words = 'Every pull request needs a review';
    const ruling = await run(helper, ['record', 'ruling'], JSON.stringify({ words }));
    assert.equal(ruling.code, 0, ruling.err);
    assert.ok(ruling.json.card.question.question.includes(`"${words}"`), 'the rule is quoted in the director\'s own words');
    // Both pass the card check as they are.
    const ask = { cwd: CWD, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [approval.json.question, ruling.json.card.question] } };
    assert.equal(await cardCheck(ask, { projectOf: () => ({ project: 'o__p' }) }), undefined);
  });
});

test('card gives back a waiting card no visit has asked, and records it as asked', async () => {
  await inHome(async () => {
    const waiting = makeEvent({ kind: 'card', data: composeCard({ ...APPROVAL, target: { pr: 7, sha: FULL } }).card, now: () => T(1) });
    const helper = fakeHelper({ events: [waiting] });
    const out = await run(helper, ['card'], JSON.stringify({ ...APPROVAL, target: { pr: 7, sha: FULL } }));
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.id, waiting.id);
    assert.equal(out.json.question.question, chatCopy(waiting.data.question));
    assert.equal(out.json.alreadyAsked, undefined);
    assert.deepEqual(helper.writes(), [{ cwd: CWD, kind: 'asked', data: { cards: [waiting.id] } }]);
  });
});

test('preview gives the address of a pull request\'s preview, or says in a sentence that there is none', async () => {
  const asked = [];
  const answers = [
    { ok: true, url: 'https://product-4f2a91c.example.app/' },
    { ok: true, url: null },
    { ok: false, refused: 'the host helper could not be reached: is it running?' },
  ];
  const helper = { client: { preview: async (body) => { asked.push(body); return answers.shift(); } } };
  assert.deepEqual(await run(helper, ['preview', '7']), { code: 0, out: 'https://product-4f2a91c.example.app/\n', err: '', json: undefined });
  assert.deepEqual(asked, [{ cwd: CWD, number: 7 }]);
  const none = await run(helper, ['preview', '7']);
  assert.deepEqual([none.code, none.out], [0, 'Pull request #7 has no preview to show: it isn\'t open, or the host has no finished preview of its latest commit.\n']);
  const away = await run(helper, ['preview', '7']);
  assert.deepEqual([away.code, away.err], [1, 'the host helper could not be reached: is it running?\n']);
  // Nothing else is asked for: one pull request's number.
  for (const argv of [['preview'], ['preview', '0'], ['preview', '7', '8'], ['preview', '#7'], ['preview', '-1']]) {
    const refused = await run(helper, argv);
    assert.deepEqual([refused.code, refused.err], [1, 'Give the pull request\'s number: preview <n>\n'], argv.join(' '));
  }
  assert.equal(asked.length, 3);
});

test('carry-on <n> asks the helper to make the request ready, and prints the work, the from to record and what to write the brief from', async () => {
  const asked = [];
  const ready = {
    ok: true, work: 'carry-on-7', from: { sha: FULL, ref: 'refs/wheelhouse/from/carry-on-7', request: 7 },
    branch: 'prices', fork: true, title: 'Prices page', body: 'Adds prices.', bodyWithheld: false,
    files: [{ path: 'prices.txt', additions: 1, deletions: 0 }], commits: ['Add prices'],
  };
  const answers = [ready, STOP];
  const helper = { client: { survey: { carryOn: async (body) => { asked.push(body); return answers.shift(); } } } };
  const made = await run(helper, ['carry-on', '7']);
  assert.equal(made.code, 0, made.err);
  assert.deepEqual(asked, [{ cwd: CWD, number: 7 }]);
  const { ok: _ok, ...printed } = ready;
  assert.deepEqual(made.json, printed);
  assert.deepEqual([await run(helper, ['carry-on', '7'])].map((r) => [r.code, r.err]), [[1, 'STOP is on\n']]);
  for (const argv of [['carry-on'], ['carry-on', '0'], ['carry-on', '7', '8'], ['carry-on', '#7'], ['carry-on', '--line'], ['carry-on', '--line', ''], ['carry-on', 'menu']]) {
    const refused = await run(helper, argv);
    assert.deepEqual([refused.code, refused.err], [1, 'Give the request\'s number or the piece of work\'s name: carry-on <n>, or carry-on --line <name>\n'], argv.join(' '));
  }
  assert.equal(asked.length, 2);
});

test('carry-on <n> for changes made by hand prints the fixed goal and done lines', async () => {
  const ready = {
    ok: true, work: 'carry-on-4', from: { sha: FULL, ref: 'refs/wheelhouse/from/carry-on-4', request: 4 },
    branch: 'feature/by-hand-0123456789ab', fork: false, title: 'Changes made by hand in the project folder', body: '', bodyWithheld: false, files: [], commits: ['Add slug page'],
  };
  const helper = { client: { survey: { carryOn: async () => ready } } };
  const made = await run(helper, ['carry-on', '4']);
  assert.equal(made.code, 0, made.err);
  assert.deepEqual(made.json.done, ['The hand-made changes pass review', 'The checks pass', 'They join the main version']);
  assert.equal(typeof made.json.goal, 'string');
});

test('carry-on --line <name> asks the helper to make that piece of work ready, by its name', async () => {
  const asked = [];
  const ready = {
    ok: true, work: 'carry-on-menu', from: { sha: FULL, ref: 'refs/wheelhouse/from/carry-on-menu' },
    branch: 'menu', where: 'local', moved: false, commits: ['Start the menu'], files: [{ path: 'menu.md', additions: 3, deletions: 0 }],
  };
  const helper = { client: { survey: { carryOn: async (body) => { asked.push(body); return ready; } } } };
  const made = await run(helper, ['carry-on', '--line', 'menu']);
  assert.equal(made.code, 0, made.err);
  assert.deepEqual(asked, [{ cwd: CWD, line: 'menu' }]);
  const { ok: _ok, ...printed } = ready;
  assert.deepEqual(made.json, printed);
});

test('move raises the card by the folder, and names only GitHub or GitLab', async () => {
  const asked = [];
  const helper = { client: { local: { move: async (body) => { asked.push(body); return { ok: true, asked: true }; } } } };
  const got = await run(helper, ['move', 'github']);
  assert.equal(got.code, 0);
  assert.equal(asked[0].host, 'github');
  assert.equal(typeof asked[0].cwd, 'string');
  const refused = await run(helper, ['move', 'elsewhere']);
  assert.notEqual(refused.code, 0);
  assert.equal(asked.length, 1);
});

test('undo asks the helper by the folder, on any host, and gives what it answers, its card included', async () => {
  const asked = [];
  const helper = { client: { undo: async (body) => { asked.push(body); return { ok: false, refused: 'needs the window', needs: 'window', card: { id: 'c-1' } }; } } };
  const got = await run(helper, ['undo', FULL]);
  assert.equal(got.code, 0, got.err);
  assert.equal(got.json.card.id, 'c-1');
  assert.deepEqual(asked, [{ cwd: CWD, merge: FULL }]);
  const refused = await run(helper, ['undo', 'abc']);
  assert.deepEqual([refused.code, refused.err], [1, 'Give the merge in full: undo <merge>\n']);
});

test('archive and restore ask the helper to make the change ready, and print the work, the from to record and the files moved', async () => {
  const asked = [];
  const answer = (work) => ({ ok: true, work, from: { sha: FULL, ref: `refs/wheelhouse/from/${work}` }, moved: ['AGENTS.md', '.cursorrules'] });
  const helper = {
    client: {
      survey: {
        archive: async (body) => { asked.push(['archive', body]); return answer('archive-instructions'); },
        restore: async (body) => { asked.push(['restore', body]); return { ok: false, refused: 'there is no archive of another agent setup\'s instructions on the main line, so nothing to put back' }; },
      },
    },
  };
  const archived = await run(helper, ['archive']);
  assert.equal(archived.code, 0, archived.err);
  assert.deepEqual(archived.json, { work: 'archive-instructions', from: { sha: FULL, ref: 'refs/wheelhouse/from/archive-instructions' }, moved: ['AGENTS.md', '.cursorrules'] });
  const restored = await run(helper, ['restore']);
  assert.deepEqual([restored.code, restored.err], [1, 'there is no archive of another agent setup\'s instructions on the main line, so nothing to put back\n']);
  assert.deepEqual(asked, [['archive', { cwd: CWD }], ['restore', { cwd: CWD }]]);
  for (const argv of [['archive', 'AGENTS.md'], ['restore', 'all']]) {
    const refused = await run(helper, argv);
    assert.deepEqual([refused.code, refused.err], [1, `${argv[0]} takes no arguments\n`]);
  }
  assert.equal(asked.length, 2);
});

test('an unknown command, or a helper that can\'t be reached, is one line on standard error', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    const unknown = await run(helper, ['show', '7']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.err, /^Commands: cards, pull-cards, card, again, why, suggest, drop, ask-bosun, record, similar, views, explain, preview, undo, move, carry-on, archive, restore, confirm, premium-card, premium-check, note, decision, pull-back, alerts, page, helm\n$/);
    const away = { client: { desk: { read: async () => ({ ok: false, refused: 'the host helper could not be reached: is it running?' }) } } };
    const out = await run(away, ['cards']);
    assert.equal(out.code, 1);
    assert.equal(out.err, 'the host helper could not be reached: is it running?\n');
  });
});

test('through the real helper, the command places the project from its folder and records what it decides', async () => {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const home = shortHome();
  const folder = path.join(home, 'shop');
  try {
    await as(home, async () => {
      fs.mkdirSync(path.join(folder, 'src'), { recursive: true });
      writeProject('o__p', {
        folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
      });
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-18T00:00:00.000Z' });
      await openTestRecord({ env: LOCAL_PATHS, project: 'o__p', remoteUrl: remote.url });
      const adapter = { defaultBranch: async () => 'main', prState: async () => ({ headSha: FULL, state: 'open' }) };
      const helper = await startHelper({ run: hostGuard, address: testAddress(home), adapterFor: async () => adapter, envFor: async () => ({}) });
      try {
        const client = helperClient({ address: helper.address });
        const say = async (argv, input) => {
          let out = '';
          let err = '';
          const code = await main(argv, { cwd: path.join(folder, 'src'), env: {}, client, input, out: (t) => { out += t; }, err: (t) => { err += t; } });
          assert.equal(code, 0, err);
          return out;
        };
        const ruling = JSON.parse(await say(['record', 'ruling'], JSON.stringify({ words: 'Money is shown in dollars' })));
        const approval = JSON.parse(await say(['card'], JSON.stringify({ ...APPROVAL, target: { pr: 7 } })));
        assert.equal(approval.question.question.includes(approvalLine(7, FULL)), false);
        // Both cards were handed out as they were made, so the visit has none left to ask.
        const visit = JSON.parse(await say(['cards']));
        assert.deepEqual(visit, { questions: [], left: 0 });
        assert.match(await say(['views', 'rulebook']), /^Money is shown in dollars \(waiting for the director to confirm it\)$/m);
        const events = listEvents(stateDir('o__p'), { report: () => {} });
        assert.deepEqual(events.map((e) => e.kind).sort(), ['asked', 'asked', 'card', 'card', 'ruling']);
        assert.equal(events.find((e) => e.kind === 'ruling').id, ruling.id);
        assert.deepEqual(events.filter((e) => e.kind === 'asked').flatMap((e) => e.data.cards).sort(), [ruling.card.id, approval.id].sort());
        // Under STOP the real helper's views say so, and the visit's one card is Lift All stop.
        setStop({ by: 'prompt' });
        const stopped = JSON.parse(await say(['cards']));
        assert.deepEqual(stopped.questions.map((q) => q.header), ['All stop']);
        assert.equal(stopped.problems, undefined);
      } finally {
        await helper.close();
      }
    });
  } finally {
    remote.cleanup();
  }
});

test('run as a script, an unknown command is refused with the list of commands', async () => {
  const done = spawnSync(process.execPath, [SCRIPT, 'nonsense'], { encoding: 'utf8' });
  assert.equal(done.status, 1);
  assert.equal(done.stderr, 'Commands: cards, pull-cards, card, again, why, suggest, drop, ask-bosun, record, similar, views, explain, preview, undo, move, carry-on, archive, restore, confirm, premium-card, premium-check, note, decision, pull-back, alerts, page, helm\n');
  assert.equal(done.stdout, '');
});

test('premium-card prints the helper\'s card line, or why it isn\'t offered; premium-check says in one line what the helper found', async () => {
  const asked = [];
  let card = { ok: true, offered: true, line: 'The premium model\'s card for the director: {"question":"…"}.' };
  let check = { ok: true, checked: true, found: true, model: 'model-premium' };
  const helper = {
    client: {
      premium: {
        card: async (body) => { asked.push(['card', body]); return card; },
        check: async (body) => { asked.push(['check', body]); return check; },
      },
    },
  };
  const offered = await run(helper, ['premium-card']);
  assert.deepEqual([offered.code, offered.out], [0, `${card.line}\n`]);
  card = { ok: true, offered: false, why: 'The premium model is offered at Thorough only.' };
  assert.equal((await run(helper, ['premium-card'])).out, 'The premium model is offered at Thorough only.\n');
  card = { ok: false, refused: 'STOP is on' };
  const stopped = await run(helper, ['premium-card']);
  assert.deepEqual([stopped.code, stopped.err], [1, 'STOP is on\n']);
  assert.match((await run(helper, ['premium-check'])).out, /^Your account has the premium model\./);
  check = { ok: true, checked: true, found: false, model: null };
  assert.match((await run(helper, ['premium-check'])).out, /^Your account doesn't have the premium model/);
  check = { ok: true, checked: false, why: 'the premium model is not allowed, so nothing is checked' };
  assert.equal((await run(helper, ['premium-check'])).out, 'Premium model not checked: the premium model is not allowed, so nothing is checked.\n');
  assert.deepEqual((await run(helper, ['premium-check', 'now'])).err, 'premium-check takes no arguments\n');
  assert.ok(asked.every(([, body]) => body.cwd === CWD));
});

test('the premium model\'s card never comes from `card`', async () => {
  await inHome(async () => {
    const refused = await run(fakeHelper(), ['card'], JSON.stringify({ kind: 'premium', level: 4 }));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /comes from `premium-card`/);
  });
});

test('cards makes the premium model\'s failed evaluation one plain card, once, with OK or Try it again', async () => {
  await inHome(async () => {
    const failed = makeEvent({ kind: 'premium-failed', data: { setting: '11111111-2222-4333-8444-555555555555', model: 'model-premium', failed: ['scenario 22 trial 1 failed'] }, now: () => T(5) });
    const helper = fakeHelper({ events: [failed] });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    const cards = helper.writes().filter((w) => w.kind === 'card');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].data.event, failed.id);
    const [asked] = first.json.questions;
    assert.deepEqual(asked.options.map((o) => o.label), ['OK', 'Try it again']);
    assert.match(asked.question, /didn't pass your project's own checks/);
    assert.match(asked.question, /nothing more is charged/);
    assert.doesNotMatch(asked.question, /model-premium/, 'no model is named');
    await run(helper, ['cards']);
    assert.equal(helper.writes().filter((w) => w.kind === 'card').length, 1, 'made once');
    // One no enrolled computer signed brings no card.
    const forged = fakeHelper({ events: [{ ...failed, id: 'f-2', sig: { computer: failed.computer, value: 'AAAA' } }] });
    await run(forged, ['cards']);
    assert.equal(forged.writes().filter((w) => w.kind === 'card').length, 0);
  });
});

test('the project\'s own name, as the helper gives it, is never put in plain words or glossed on a card', async () => {
  await inHome(async () => {
    const input = { ...APPROVAL, what: 'Pull request #7 gives preview board a new banner.', target: { pr: 7, sha: FULL } };
    const plain = await run(fakeHelper(), ['card'], JSON.stringify(input));
    assert.equal(plain.code, 0, plain.err);
    assert.doesNotMatch(plain.json.question.question, /gives preview board a new banner/, 'without the name, preview is taken for the term');
    const named = await run(fakeHelper({ names: ['preview-board'] }), ['card'], JSON.stringify(input));
    assert.equal(named.code, 0, named.err);
    assert.match(named.json.question.question, /gives preview board a new banner\./);
    assert.doesNotMatch(named.json.question.question, /preview means/);
  });
});

test('typed replies switched off: cards hands an open question out as an answer card, once, as it always did', async () => {
  await inHome(async () => {
    const helper = fakeHelper({ events: [...typedOff(), questionEvent()] });
    const first = await run(helper, ['cards']);
    assert.equal(first.code, 0, first.err);
    assert.equal(first.json.questions.length, 1);
    assert.deepEqual(first.json.questions[0].options.map((o) => o.label), ['Comma', 'Tab', 'Suggest a change…']);
    assert.deepEqual(helper.writes().at(-1), { cwd: CWD, kind: 'asked', data: { cards: [helper.held.find((e) => e.kind === 'card').id] } });
    assert.deepEqual((await run(helper, ['cards'])).json, { questions: [], left: 0 });
  });
});

const LEVEL_3 = { ...QUESTION, level: 3 };
const joinerOf = (lead) => questionEvent({ ...LEVEL_3, id: 'q-login-500001', work: 'login', joins: lead.data.id }, 6);

test('a joiner has no number and no wake of its own', async () => {
  await inHome(async () => {
    const lead = questionEvent(LEVEL_3);
    const helper = fakeHelper({ events: [...typedOn(), EXPORT, lead, joinerOf(lead)] });
    assert.equal(numberedWaiting(helper.views(), []).length, 1);
    assert.equal(cardsDue(helper.views(), NOW), 0, 'a decision is shown in chat, so no card is due');
    const made = await run(helper, ['cards']);
    assert.equal(made.json.questions.length, 0);
    assert.deepEqual(helper.writes().filter((w) => w.kind === 'card').map((c) => c.data.joiners), [['q-login-500001']]);
    assert.match(helper.writes().find((w) => w.kind === 'card').data.question, /and login/);
  });
});

test('a card already out is re-issued listing the joiner, and the lead\'s signature stands', async () => {
  await inHome(async () => {
    const lead = questionEvent(LEVEL_3);
    const helper = fakeHelper({ events: [...typedOn(), EXPORT, lead] });
    await run(helper, ['cards']);
    const first = helper.held.filter((e) => e.kind === 'card').at(-1);
    helper.held.push(joinerOf(lead));
    const again = await run(helper, ['cards']);
    const cards = helper.held.filter((e) => e.kind === 'card');
    assert.equal(cards.length, 2);
    assert.equal(cards[1].data.revises, first.id);
    assert.equal(cards[1].data.line, first.data.line);
    assert.deepEqual(cards[1].data.joiners, ['q-login-500001']);
    assert.equal(again.json.questions.length, 0);
    await run(helper, ['cards']);
    assert.equal(helper.held.filter((e) => e.kind === 'card').length, 2, 'once');
    assert.deepEqual(helper.views().waiting.map((c) => c.id), [cards[1].id], 'the first card is closed');
  });
});

test('a joiner still open after the click is a card of its own, saying You said this before', async () => {
  await inHome(async () => {
    const lead = questionEvent(LEVEL_3);
    const signed = makeEvent({ kind: 'action', now: () => T(7), data: { action: 'answer', question: 'an older card', questionId: lead.data.id, questionHash: dataHash(lead.data), label: 'Tab' } });
    const helper = fakeHelper({ events: [...typedOn(), EXPORT, lead, joinerOf(lead), signed] });
    const made = await run(helper, ['cards']);
    assert.equal(made.json.questions.length, 0);
    assert.match(helper.writes().filter((w) => w.kind === 'card').at(-1).data.question, /You said this before: Tab\./);
  });
});

test('a card too long to list its pieces still comes, and they are asked after it', async () => {
  await inHome(async () => {
    const long = { ...LEVEL_3, what: 'x '.repeat(490).trim() };
    const lead = questionEvent(long);
    const joiner = questionEvent({ ...long, id: 'q-login-500001', work: 'login', joins: lead.data.id }, 6);
    const helper = fakeHelper({ events: [...typedOn(), EXPORT, lead, joiner] });
    const made = await run(helper, ['cards']);
    assert.equal(made.json.questions.length, 0);
    assert.equal(helper.held.filter((e) => e.kind === 'card').at(-1).data.joiners, undefined);
  });
});

test('note asks the helper to keep the session note, and refuses what the helper would', async () => {
  const sent = [];
  const keeper = (answer) => ({ client: { session: { note: async (body) => { sent.push(body); return answer; } } } });
  const env = { CLAUDE_CODE_SESSION_ID: 'abc-123' };
  const text = 'Task: the export\nDone: the parser\nNext: the tests\nOpen: none\n';
  const done = await run(keeper({ ok: true, file: '/home/projects/o__p/sessions/abc-123.md' }), ['note'], text, { cwd: CWD, env });
  assert.equal(done.code, 0, done.err);
  assert.match(done.out, /abc-123\.md/);
  assert.deepEqual(sent, [{ cwd: CWD, session: 'abc-123', text }]);
  sent.length = 0;
  // Refused here, before the helper is asked: over 1,200 characters, empty, no session id, arguments.
  for (const [argv, input, opts, pattern] of [
    [['note'], 'x'.repeat(1201), { env }, /1201 characters; keep it to 1200/],
    [['note'], '  \n', { env }, /empty/],
    [['note'], 'a note', { env: {} }, /no id/],
    [['note', 'extra'], 'a note', { env }, /takes no arguments/],
  ]) {
    const refused = await run(keeper({ ok: true, file: 'x' }), argv, input, { cwd: CWD, ...opts });
    assert.equal(refused.code, 1);
    assert.match(refused.err, pattern);
  }
  assert.deepEqual(sent, []);
  // 1,200 characters pass; the helper's refusal is said as it is.
  assert.equal((await run(keeper({ ok: true, file: 'x' }), ['note'], 'x'.repeat(1200), { cwd: CWD, env })).code, 0);
  const stopped = await run(keeper({ ok: false, refused: 'STOP is on' }), ['note'], 'a note', { cwd: CWD, env });
  assert.equal(stopped.code, 1);
  assert.match(stopped.err, /STOP is on/);
});

// --- cards are asked in the chat ---

// A registered project in a folder whose configuration still names `agent` for this computer.
function agentProject(agent) {
  const folder = path.join(tempFolder('wh-agent-'), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ agents: { [computerId()]: agent } }));
  writeProject('o__p', { folder, remoteUrl: 'https://example.test/o/p.git', host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' } });
  return folder;
}

test('a configuration that still names another agent has its cards asked in the chat, and the desk is not asked about a panel', async () => {
  await inHome(async () => {
    const folder = agentProject('copilot');
    const helper = fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] });
    const out = await run(helper, ['cards'], undefined, { cwd: folder, env: {} });
    assert.equal(out.code, 0, out.err);
    assert.equal(out.json.panel, undefined);
    assert.equal(out.json.questions.length, 1);
    assert.ok(!helper.calls.some(([name, body]) => name === 'desk.read' && body.args?.vscode), 'the panel was not asked about');
  });
});

test('--here needs a Claude Code session id', async () => {
  await inHome(async () => {
    const folder = agentProject('claude-code');
    const none = await run(fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] }), ['cards', '--here'], undefined, { cwd: folder, env: {} });
    assert.equal(none.err, 'The session isn\'t known, so the cards can\'t be asked here.\n');
  });
});

test('views waiting --since names panel answers only', async () => {
  await inHome(async () => {
    const one = cardEvent(PRODUCT(1), 1);
    const two = cardEvent(PRODUCT(2), 2);
    const helper = fakeHelper({ events: [one, two, answerAt(one, 'Plain', 10 * MINUTE, 'panel'), answerAt(two, 'Playful', 8 * MINUTE, 'chat')] });
    const since = new Date(NOW.getTime() - 20 * MINUTE).toISOString();
    const out = await run(helper, ['views', 'waiting', '--since', since]);
    assert.equal(out.code, 0, out.err);
    const lead = out.out.split('\n').filter((l) => l.startsWith(SINCE_LEAD));
    assert.equal(lead.length, 1);
    assert.match(lead[0], /Plain/);
    assert.doesNotMatch(lead[0], /Playful/);
    assert.ok(out.out.indexOf(RECENT_LEAD) < out.out.indexOf(SINCE_LEAD), 'after the recent block');
    const plain = await run(helper, ['views', 'waiting']);
    assert.ok(!plain.out.includes(SINCE_LEAD), 'without --since nothing changes');
    const bad = await run(helper, ['views', 'waiting', '--since', 'soon']);
    assert.equal(bad.code, 1);
  });
});

test('cli: record watch writes the event', async () => {
  await inHome(async () => {
    const helper = fakeHelper();
    assert.ok(RECORD_KINDS.includes('watch'));
    const out = await run(helper, ['record', 'watch'], JSON.stringify({ work: 'login', level: 'transcript' }));
    assert.equal(out.code, 0, out.err);
    assert.deepEqual(helper.writes().at(-1), { cwd: CWD, kind: 'watch', data: { work: 'login', level: 'transcript' } });
    assert.deepEqual(helper.held.map((e) => e.kind), ['watch']);
    assert.equal(out.json.id, helper.held.at(-1).id);
  });
});

// --- writes only from the First Mate's seat ---

// A project in a temporary folder, with the seat held by session 'b'.
async function seatHeldByB(fn) {
  await inHome(async () => {
    const folder = agentProject('claude-code');
    const table = [{ pid: 10, ppid: 1, command: 'claude' }, { pid: 20, ppid: 10, command: 'node hook.js' }];
    const taken = await takeSeat('o__p', { session: 'b', folder }, { alive: () => true, startTime: async () => 'T1', ancestor: { pid: 20, table }, now: () => NOW });
    assert.equal(taken.held, true);
    await fn(folder);
  });
}

test('every seat write is refused for a session that doesn\'t hold the seat', async () => {
  await seatHeldByB(async (folder) => {
    for (const command of SEAT_WRITES) {
      const helper = fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] });
      const got = await run(helper, [command], '{}', { cwd: folder, env: { CLAUDE_CODE_SESSION_ID: 'a' } });
      assert.equal(got.code, 1, command);
      assert.equal(got.err, `${SEAT_REFUSAL}\n`, command);
      assert.deepEqual(helper.calls, [], `${command} never reached the helper`);
    }
  });
});

test('the holder\'s writes go through', async () => {
  await seatHeldByB(async (folder) => {
    const env = { CLAUDE_CODE_SESSION_ID: 'b' };
    const helper = fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] });
    const listed = await run(helper, ['cards'], undefined, { cwd: folder, env });
    assert.equal(listed.code, 0, listed.err);
    const recorded = await run(helper, ['record', 'ruling'], JSON.stringify({}), { cwd: folder, env });
    assert.ok(!recorded.err.includes(SEAT_REFUSAL), recorded.err);
    assert.ok(helper.calls.length > 1, 'the record reached the client');
  });
});

test('reads work for any session', async () => {
  await seatHeldByB(async (folder) => {
    const env = { CLAUDE_CODE_SESSION_ID: 'a' };
    for (const argv of [['views', 'waiting'], ['decision', 'list'], ['explain', 'work'], ['similar', 'a name'], ['why', '1']]) {
      const got = await run(fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] }), argv, '', { cwd: folder, env });
      assert.ok(!got.err.includes(SEAT_REFUSAL), argv.join(' '));
    }
  });
});

test('no session id keeps today\'s behaviour', async () => {
  await seatHeldByB(async (folder) => {
    const helper = fakeHelper({ events: [cardEvent(PRODUCT(1), 1)] });
    const got = await run(helper, ['cards'], undefined, { cwd: folder, env: {} });
    assert.equal(got.code, 0, got.err);
    const none = await run(helper, ['record', 'ruling'], '{}', { cwd: folder, env: { CLAUDE_CODE_SESSION_ID: '' } });
    assert.ok(!none.err.includes(SEAT_REFUSAL));
  });
});

test('outside a project nothing is refused', async () => {
  await inHome(async () => {
    const { client } = fakeHelper();
    for (const command of SEAT_WRITES) assert.equal(await seatRefusal({ command, env: { CLAUDE_CODE_SESSION_ID: 'a' }, cwd: CWD, client }), null, command);
  });
});

test('a helper that can\'t answer about the seat refuses nothing', async () => {
  const env = { CLAUDE_CODE_SESSION_ID: 'a' };
  const failing = { session: { seat: async () => { throw new Error('no helper'); } } };
  assert.equal(await seatRefusal({ command: 'cards', env, cwd: CWD, client: failing }), null);
  const unsure = { session: { seat: async () => ({ ok: true }) } };
  assert.equal(await seatRefusal({ command: 'cards', env, cwd: CWD, client: unsure }), null);
});

test('seatRefusal leaves commands outside the list alone', async () => {
  await seatHeldByB(async (folder) => {
    const { client } = fakeHelper();
    for (const command of ['views', 'note', 'alerts', 'premium-check']) assert.equal(await seatRefusal({ command, env: { CLAUDE_CODE_SESSION_ID: 'a' }, cwd: folder, client }), null, command);
    assert.equal(await seatRefusal({ command: 'cards', env: { CLAUDE_CODE_SESSION_ID: 'a' }, cwd: folder, client }), SEAT_REFUSAL);
  });
});

// --- page ---

// The helper's crew route, standing in: the command only asks it, in the project's folder, and says what it answers.
function crewHelper(answer) {
  const helper = fakeHelper();
  const asked = [];
  helper.client.crew = { page: async (body) => { asked.push(body); return answer(body); } };
  return { helper, asked };
}

test('cli: page asks the helper for the folder and prints one line', async () => {
  const { helper, asked } = crewHelper(() => ({ ok: true, file: '/projects/shop/.wheelhouse/watch/login.md' }));
  const out = await run(helper, ['page', 'login']);
  assert.equal(out.code, 0, out.err);
  assert.deepEqual(asked, [{ cwd: CWD, work: 'login' }]);
  assert.equal(out.out.trim().split('\n').length, 1);
  assert.match(out.out, /^The page is at `\/projects\/shop\/\.wheelhouse\/watch\/login\.md`\. To follow it live: `node <plugin root>\/scripts\/crew\/runs\.js --follow login --folder "[^"]+"`\n$/);
  assert.deepEqual(helper.calls, [], 'nothing else is asked of the helper, and nothing is read here');
});

test('cli: page says the helper\'s refusal line, and a name that is not a piece never reaches it', async () => {
  const { helper, asked } = crewHelper(({ work }) => ({ ok: true, said: `There is no open piece called ${work}.` }));
  const closed = await run(helper, ['page', 'old']);
  assert.equal(closed.code, 0, closed.err);
  assert.equal(closed.out, 'There is no open piece called old.\n');
  const odd = await run(helper, ['page', '../x']);
  assert.equal(odd.out, 'There is no open piece called ../x.\n');
  assert.deepEqual(asked.map((b) => b.work), ['old']);
  const idle = crewHelper(() => ({ ok: true, said: 'idle has not started yet, so there is nothing to watch.' }));
  assert.equal((await run(idle.helper, ['page', 'idle'])).out, 'idle has not started yet, so there is nothing to watch.\n');
});

test('cli: page reports a helper that refuses', async () => {
  const { helper } = crewHelper(() => ({ ok: false, refused: 'All stop is on, so the piece can\'t be raised to its full transcript' }));
  const out = await run(helper, ['page', 'login']);
  assert.equal(out.code, 1);
  assert.equal(out.err, 'All stop is on, so the piece can\'t be raised to its full transcript\n');
});

test('cli: page is a seat write', async () => {
  assert.ok(SEAT_WRITES.includes('page'));
});

// The helper's answer to `helm`: kept calls, and the lines or refusal the test gives.
function helmHelper(answer) {
  const helper = fakeHelper();
  const asked = [];
  helper.client.crew = { helm: async (body) => { asked.push(body); return answer(body); } };
  return { helper, asked };
}

test('cli: helm is a seat write and a command', () => {
  assert.ok(SEAT_WRITES.includes('helm'));
});

test('cli: helm asks the helper and prints its lines, and the folder and the session go with it', async () => {
  const lines = ['login is ready for you now. Run this to open it:', '```bash', 'node <plugin root>/scripts/crew/helm.js open login', '```'];
  const { helper, asked } = helmHelper(() => ({ ok: true, lines }));
  const out = await run(helper, ['helm', 'take', 'login']);
  assert.equal(out.code, 0, out.err);
  assert.equal(out.out, `${lines.join('\n')}\n`);
  assert.deepEqual(asked, [{ cwd: CWD, work: 'login', action: 'take' }]);
  assert.deepEqual(helper.calls, [], 'nothing is written or read here');
  const seated = await run(helper, ['helm', 'steer', 'search'], undefined, { env: {} });
  assert.equal(seated.code, 0);
  assert.equal(asked[1].action, 'steer');
});

test('cli: helm says the helper\'s refusal, and takes only a known action and a piece name', async () => {
  const { helper, asked } = helmHelper(() => ({ ok: false, refused: 'login is already at the helm.' }));
  const out = await run(helper, ['helm', 'take', 'login']);
  assert.equal(out.code, 1);
  assert.equal(out.err, 'login is already at the helm.\n');
  assert.equal((await run(helper, ['helm', 'drive', 'login'])).code, 1);
  assert.match((await run(helper, ['helm', 'take', '../x'])).err, /no open piece/);
  assert.equal((await run(helper, ['helm', 'take'])).code, 1);
  assert.equal(asked.length, 1, 'only the valid request reached the helper');
});

test('cli: helm from a window without the First Mate\'s seat is refused before the helper', async () => {
  const { helper, asked } = helmHelper(() => ({ ok: true, lines: ['x'] }));
  helper.client.session.seat = async () => ({ ok: true, holds: false });
  const out = await run(helper, ['helm', 'take', 'login'], undefined, { env: { CLAUDE_CODE_SESSION_ID: 'other' } });
  assert.equal(out.code, 1);
  assert.equal(out.err, `${SEAT_REFUSAL}\n`);
  assert.deepEqual(asked, []);
});
