// tests/scripts/confirm/window.test.js
// The helper's own window (Part 5 Task 4, rulings P5-23, P5-42, P5-44): the card's words reach osascript and
// PowerShell only as data, never in a script; and POST /confirm opens a window only for a card the state holds as
// shown, signs a deciding click itself with proof `window`, records nothing for Not now or a time-out, and opens one
// window at a time. Every window here is a stand-in `run`: no real osascript or powershell runs.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { guardedRun, standInTools } from '../../helpers/host-stand-ins.js';
import { shortHome, testAddress } from '../../helpers/homes.js';
import { waitLongerOnTheHelper } from '../../helpers/until.js';
import { run } from '../../../scripts/lib/run.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { stopState, liftStop } from '../../../scripts/lib/stop.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { makeBareRemote, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { dataHash, listEvents, makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled, verify } from '../../../scripts/state/signing.js';
import { approvalLine, confirmLine, runbookLine, LIFT_STOP } from '../../../scripts/state/card-lines.js';
import {
  askInWindow, CARD_VARIABLE, MAC_OSASCRIPT, MAC_SCRIPT, NOT_NOW, WINDOWS_SCRIPT, WINDOW_MS, windowsShell,
} from '../../../scripts/confirm/window.js';

// No real gh, glab, copilot or curl runs (P5-44): the PATH finds the stand-ins first, and the helper's own runs go
// through a guard whose log stays empty. The window's programs are answered by the test's stand-in before the guard.
const shims = standInTools();
const hostLog = [];
const hostGuard = guardedRun(run, { log: hostLog });
afterEach(() => {
  assert.deepEqual(hostLog, [], 'no host tool ran through the helper');
  assert.deepEqual(shims.calls(), [], 'no host tool ran from the PATH');
});
after(() => shims.restore());

waitLongerOnTheHelper();

const PROJECT = 'shop';
const HOST_PROJECT = 'o__p';
const HEAD = `abc1234${'0'.repeat(33)}`;
const T0 = new Date('2026-10-23T01:00:00.000Z');
const isWindowProgram = (file) => /^(osascript|powershell(\.exe)?)$/i.test(path.basename(String(file)));

// A stand-in `run` for askInWindow alone: notes each call and answers with `answer(call)`.
function standInWindow(answer) {
  const calls = [];
  const fake = async (file, args = [], options = {}) => {
    const call = { file, args, options };
    calls.push(call);
    return answer(call);
  };
  return { calls, run: fake };
}

// The text of each `-e` line osascript was given, in order.
const scriptOf = (args) => args.flatMap((a, i) => (args[i - 1] === '-e' ? [a] : []));
const argvOf = (args) => args.slice(args.indexOf('--') + 1);

test('a title with quotes, backslashes and new lines reaches osascript only as an argument', async () => {
  const title = 'Say "yes" \\ or end tell\ndo shell script "rm -rf ~"';
  const lines = ['Runbook step 1', '" & (do shell script "id") & "', 'C:\\Users\\Ann O\'Neil'];
  const window = standInWindow(() => ({ code: 0, stdout: 'Do it\n', stderr: '' }));
  const got = await askInWindow({ title, lines, options: ['Do it'], platform: 'darwin', timeoutMs: 60000, run: window.run });
  assert.deepEqual(got, { choice: 'Do it' });
  assert.equal(window.calls.length, 1);
  const [{ file, args, options }] = window.calls;
  // macOS's own osascript, never one planted first on the PATH.
  assert.equal(file, '/usr/bin/osascript');
  assert.equal(file, MAC_OSASCRIPT);
  // The script is the constant one, line for line, and holds nothing of the card.
  assert.deepEqual(scriptOf(args), MAC_SCRIPT);
  assert.equal(args.indexOf('--'), MAC_SCRIPT.length * 2, 'the script\'s lines come first, then --, then the arguments');
  for (const line of MAC_SCRIPT) {
    for (const text of [title, ...lines]) assert.ok(!line.includes(text), 'no card text in the script');
  }
  assert.match(MAC_SCRIPT[0], /^on run argv$/);
  // The card travels as argv: the title, the words, the seconds to wait, then the deciding options.
  assert.deepEqual(argvOf(args), [title, lines.join('\n'), '60', 'Do it']);
  assert.ok(options.timeoutMs > 60000, 'the program is given a little longer than the window\'s own limit');
  // One deciding option is a dialog with Not now as its default button; several are a list, cancelled by Not now.
  assert.match(MAC_SCRIPT.join('\n'), /buttons \{"Not now", item 1 of theOptions\} default button 1 giving up after theWait/);
  assert.match(MAC_SCRIPT.join('\n'), /choose from list theOptions .* cancel button name "Not now"/);

  // What comes back counts only when it is one of the options or Not now.
  for (const [stdout, choice] of [['Not now\n', NOT_NOW], ['\n', null], ['Approve\n', null], ['Do it and more\n', null]]) {
    const again = standInWindow(() => ({ code: 0, stdout, stderr: '' }));
    assert.deepEqual(await askInWindow({ title, lines, options: ['Do it'], platform: 'darwin', run: again.run }), { choice }, JSON.stringify(stdout));
  }
  const several = standInWindow(() => ({ code: 0, stdout: 'Confirm\n', stderr: '' }));
  assert.deepEqual(await askInWindow({ title, lines, options: ['Approve', 'Confirm'], platform: 'darwin', run: several.run }), { choice: 'Confirm' });
  assert.deepEqual(argvOf(several.calls[0].args).slice(3), ['Approve', 'Confirm']);
  assert.equal(argvOf(several.calls[0].args)[2], String(WINDOW_MS / 1000), 'the window waits five minutes unless told otherwise');
  // A failed run is no choice; Not now is never an option given, since the window adds it.
  const failed = standInWindow(() => ({ code: 1, stdout: 'Do it\n', stderr: 'execution error' }));
  assert.deepEqual(await askInWindow({ title, lines, options: ['Do it'], platform: 'darwin', run: failed.run }), { choice: null });
  await assert.rejects(askInWindow({ title, lines, options: ['Do it', NOT_NOW], platform: 'darwin', run: failed.run }), /without Not now/);
});

test('the Windows script is constant and the text travels base64 in the environment', async () => {
  const title = 'Wheelhouse: Runbook';
  const lines = ['Runbook step 1', '$(Remove-Item C:\\ -Recurse) `"; exit', 'Café ✓'];
  const window = standInWindow(() => ({ code: 0, stdout: '0', stderr: '' }));
  const env = { SystemRoot: 'D:\\Windows' };
  const got = await askInWindow({ title, lines, options: ['Do it'], platform: 'win32', timeoutMs: 30000, run: window.run, env });
  assert.deepEqual(got, { choice: 'Do it' });
  const [{ file, args, options }] = window.calls;
  // Windows PowerShell from the system's own folder, never one first on the PATH.
  assert.equal(file, windowsShell('D:\\Windows'));
  assert.equal(file, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand']);
  assert.equal(args.length, 5);
  // The encoded command is the constant script, and nothing of the card is in it or in the arguments.
  assert.equal(Buffer.from(args[4], 'base64').toString('utf16le'), WINDOWS_SCRIPT);
  for (const text of [title, ...lines]) {
    assert.ok(!WINDOWS_SCRIPT.includes(text));
    assert.ok(!args.some((a) => a.includes(text)));
  }
  // The card is in one environment variable, base64 of UTF-8 JSON, Not now last.
  assert.deepEqual(Object.keys(options.env), [CARD_VARIABLE]);
  assert.deepEqual(JSON.parse(Buffer.from(options.env[CARD_VARIABLE], 'base64').toString('utf8')), {
    title, lines, options: ['Do it', NOT_NOW], waitMs: 30000,
  });
  assert.ok(options.timeoutMs > 30000);
  assert.match(WINDOWS_SCRIPT, /UseMnemonic = \$false/);
  assert.match(WINDOWS_SCRIPT, /\$form\.ActiveControl = \$last/, 'Not now, the last button, has the focus');

  // The script answers with the number of the button: anything else is no choice.
  for (const [stdout, choice] of [['1', NOT_NOW], ['-1', null], ['2', null], ['Do it', null], ['', null]]) {
    const again = standInWindow(() => ({ code: 0, stdout, stderr: '' }));
    assert.deepEqual(await askInWindow({ title, lines, options: ['Do it'], platform: 'win32', run: again.run, env }), { choice }, stdout);
  }
  // Without SystemRoot, C:\Windows.
  const plain = standInWindow(() => ({ code: 0, stdout: '0', stderr: '' }));
  await askInWindow({ title, lines, options: ['Do it'], platform: 'win32', run: plain.run, env: {} });
  assert.equal(plain.calls[0].file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');

  // Anywhere else there is no window, and nothing runs.
  const elsewhere = standInWindow(() => assert.fail('nothing runs on Linux'));
  assert.deepEqual(await askInWindow({ title, lines, options: ['Do it'], platform: 'linux', run: elsewhere.run }), { choice: null });
  assert.equal(elsewhere.calls.length, 0);
});

// --- POST /confirm on a real helper ---

// A computer with a home of its own, an enrolled key, a Lean project, and a helper whose window is askInWindow on
// macOS with a stand-in `run`: each osascript call is noted in `windows` and answered by `answer`. The helper's own
// `run` is the guard, so no host tool runs.
// With `adapter`, the project is a host project instead (`o__p` on a local bare remote), whose host is that adapter.
async function computer(answer, { adapter } = {}) {
  const home = shortHome();
  const folder = path.join(shortHome(), 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const remote = adapter ? await makeBareRemote({ repo: 'o/p' }) : null;
  if (remote) {
    writeProject(HOST_PROJECT, {
      folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    await openTestRecord({ env: LOCAL_PATHS, project: HOST_PROJECT, remoteUrl: remote.url });
  } else {
    registerLean({ project: PROJECT, folder, now: () => T0 });
  }
  const project = remote ? HOST_PROJECT : PROJECT;
  const own = makeSigningKey();
  enrol({ computer: own.computer, publicKey: own.publicKey, enrolledAt: T0.toISOString() });
  const windows = [];
  const windowRun = async (file, args) => {
    assert.ok(isWindowProgram(file), `only the window's program runs here, not ${file}`);
    windows.push({ file, args });
    return answer({ file, args, argv: argvOf(args) });
  };
  const askWindow = (card) => askInWindow({ ...card, platform: 'darwin', run: windowRun });
  let tick = 0;
  const helper = await startHelper({
    run: hostGuard,
    askWindow,
    address: testAddress(home),
    envFor: adapter ? async () => ({}) : async () => { throw new Error('no connection on this computer'); },
    adapterFor: adapter ? async () => adapter : async () => { throw new Error('no adapter on this computer'); },
    now: () => new Date(T0.getTime() + 1000 * (tick += 1)),
  });
  const client = helperClient({ address: helper.address });
  return {
    home,
    windows,
    folder: fs.realpathSync.native(folder),
    client,
    project,
    events: () => listEvents(stateDir(project), { report: () => {} }),
    // Writes a card through the helper, as the front desk does, and gives its id and the hash of its data.
    card: async (data) => {
      const made = await client.state.write({ project, kind: 'card', data });
      assert.equal(made.ok, true, JSON.stringify(made));
      return { card: made.id, hash: dataHash(data) };
    },
    close: async () => {
      await helper.close();
      remote?.cleanup();
      if (before === undefined) delete process.env.WHEELHOUSE_HOME;
      else process.env.WHEELHOUSE_HOME = before;
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

const runbookCard = (step = 1) => ({
  question: `Do the first step of the runbook?\nIt closes the project to agents while you look.\n${runbookLine(step)}`,
  header: 'Runbook',
  options: ['Do it', 'Not now'],
  kind: 'runbook',
  level: 4,
});
const said = (text) => ({ code: 0, stdout: `${text}\n`, stderr: '' });

test('a time-out records nothing', async () => {
  const c = await computer(() => ({ code: 1, stdout: '', stderr: '', timedOut: true }));
  try {
    const shown = await c.card(runbookCard());
    const before = c.events().length;
    const got = await c.client.confirm({ cwd: c.folder, ...shown });
    assert.deepEqual(got, { ok: true, choice: null, recorded: false });
    assert.equal(c.windows.length, 1, 'the window was opened');
    assert.equal(c.events().length, before, 'nothing was recorded');
    // The window showed the card's words from the state, with its one deciding option.
    const argv = argvOf(c.windows[0].args);
    assert.deepEqual(argv, ['Wheelhouse: Runbook', runbookCard().question, String(WINDOW_MS / 1000), 'Do it']);
  } finally {
    await c.close();
  }
  // Not now, and a window that gave up, record nothing either.
  for (const answer of [said(NOT_NOW), said('')]) {
    const d = await computer(() => answer);
    try {
      const shown = await d.card(runbookCard());
      const before = d.events().length;
      const got = await d.client.confirm({ project: PROJECT, ...shown });
      assert.equal(got.recorded, false);
      assert.equal(d.events().length, before);
    } finally {
      await d.close();
    }
  }
});

test('a card not in state, or with another hash, opens no window', async () => {
  const c = await computer(() => assert.fail('no window opens'));
  try {
    const shown = await c.card(runbookCard());
    const plain = await c.card({ question: 'Which colour for the button?', header: 'Colour', options: ['Blue', 'Green'], kind: 'question', level: 2 });
    const written = await c.client.state.write({ project: PROJECT, kind: 'ruling', data: { words: 'Keep the shop open on Sundays' } });
    const ruling = c.events().find((e) => e.id === written.id);
    const rulingCard = await c.card({ question: `Confirm the rule?\n${confirmLine(ruling)}`, header: 'Rule', options: ['Confirm', 'Not now'], kind: 'confirm', level: 3 });
    const before = c.events().length;
    const refusals = [
      [{ ...shown, card: '0b7c1d1e-2f3a-4b5c-8d6e-7f8091a2b3c4' }, /not in this project's state/],
      [{ ...shown, hash: 'f'.repeat(64) }, /hash differs/],
      [{ ...shown, hash: shown.hash.toUpperCase() }, /sha256, in lower case/],
      [{ ...shown, hash: undefined }, /sha256, in lower case/],
      [{ ...shown, card: 'runbook-step' }, /named by its id/],
      // A card the state holds as shown, but no step the window confirms: a product question, a ruling's confirmation.
      [plain, /not one the window confirms/],
      [rulingCard, /not one the window confirms/],
      // Lift All stop while STOP is off.
      [{ card: 'lift-stop' }, /All stop is not on/],
    ];
    for (const [body, why] of refusals) {
      const got = await c.client.confirm({ project: PROJECT, ...body });
      assert.equal(got.ok, false, JSON.stringify(body));
      assert.match(got.refused, why);
    }
    // A card already decided no longer waits.
    const answered = await c.client.state.write({ project: PROJECT, kind: 'card-answer', data: { card: shown.card, label: 'Do it' } });
    assert.equal(answered.ok, true);
    const decided = await c.client.confirm({ project: PROJECT, ...shown });
    assert.match(decided.refused, /no longer waits/);
    assert.equal(c.windows.length, 0);
    assert.equal(c.events().length, before + 1, 'only the answer was written');
  } finally {
    await c.close();
  }
});

test('a deciding choice is signed by the helper with proof window', async () => {
  let reply = said('Do it');
  const c = await computer(() => reply);
  try {
    const shown = await c.card(runbookCard());
    const got = await c.client.confirm({ cwd: c.folder, ...shown });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.choice, got.kind, got.step, got.pushed], [true, 'Do it', 'action', 'runbook-step', false]);
    const record = c.events().find((e) => e.id === got.id);
    assert.deepEqual(record.data, { action: 'runbook', step: 1, question: runbookCard().question, label: 'Do it', proof: 'window' });
    assert.ok(record.sig, 'the helper signed it');
    assert.ok(verify(record, readEnrolled()), 'the signature verifies');
    // The signed record decides the card, so it is no longer offered.
    assert.match((await c.client.confirm({ project: PROJECT, ...shown })).refused, /no longer waits/);

    // Lift All stop: the card the helper composes, shown while STOP is on, and STOP lifted by the click.
    assert.equal((await c.client.stop({})).ok, true);
    assert.equal(stopState().on, true);
    reply = said('Lift All stop');
    const lifted = await c.client.confirm({ project: PROJECT, card: 'lift-stop' });
    assert.equal(lifted.ok, true, JSON.stringify(lifted));
    assert.deepEqual([lifted.recorded, lifted.kind, lifted.step], [true, 'action', 'lift-stop']);
    assert.equal(stopState().on, false, 'STOP is lifted');
    const action = c.events().find((e) => e.id === lifted.id);
    assert.equal(action.data.action, 'lift-stop');
    assert.equal(action.data.proof, 'window');
    assert.ok(action.data.question.includes(LIFT_STOP));
    assert.ok(verify(action, readEnrolled()));
    const liftWindow = argvOf(c.windows.at(-1).args);
    assert.equal(liftWindow[0], 'Wheelhouse: All stop');
    assert.deepEqual(liftWindow.slice(3), ['Lift All stop']);

    // Not now on Lift All stop leaves STOP on and records nothing.
    assert.equal((await c.client.stop({})).ok, true);
    reply = said(NOT_NOW);
    const before = c.events().length;
    assert.deepEqual(await c.client.confirm({ project: PROJECT, card: 'lift-stop' }), { ok: true, choice: NOT_NOW, recorded: false });
    assert.equal(stopState().on, true);
    assert.equal(c.events().length, before);
  } finally {
    await c.close();
  }
  // An action's proof, when it names one, is text (ruling P5-23); approvals and confirmations have no shape here.
  assert.throws(() => makeEvent({ kind: 'action', data: { action: 'lift-stop', question: LIFT_STOP, label: 'Lift All stop', proof: 7 } }), /proof that is not text/);
});

test('a second request while a window is open waits for the first', async () => {
  const opened = [];
  const c = await computer(() => new Promise((resolve) => { opened.push(resolve); }));
  try {
    const first = await c.card(runbookCard(1));
    const second = await c.card(runbookCard(2));
    const one = c.client.confirm({ project: PROJECT, ...first });
    const waitFor = async (n) => {
      for (let i = 0; i < 400 && opened.length < n; i++) await new Promise((r) => { setTimeout(r, 10); });
      assert.equal(opened.length, n);
    };
    await waitFor(1);
    const two = c.client.confirm({ project: PROJECT, ...second });
    // While the first window is open, the second request waits: no second window opens.
    await new Promise((r) => { setTimeout(r, 300); });
    assert.equal(c.windows.length, 1, 'one window at a time');
    opened[0](said('Do it'));
    const gotOne = await one;
    assert.equal(gotOne.recorded, true, JSON.stringify(gotOne));
    await waitFor(2);
    assert.equal(argvOf(c.windows[1].args)[1], runbookCard(2).question, 'the second window shows the second card');
    opened[1](said(NOT_NOW));
    assert.deepEqual(await two, { ok: true, choice: NOT_NOW, recorded: false });
  } finally {
    await c.close();
  }
});

test('a click on a window shown during one STOP never lifts a later one', async () => {
  let open = null;
  const c = await computer(() => new Promise((resolve) => { open = resolve; }));
  try {
    assert.equal((await c.client.stop({})).ok, true);
    const asked = c.client.confirm({ project: PROJECT, card: 'lift-stop' });
    for (let i = 0; i < 400 && open === null; i++) await new Promise((r) => { setTimeout(r, 10); });
    assert.ok(open, 'the window opened');
    // While the window is open, that STOP is lifted elsewhere and a new one set, which the window never showed.
    liftStop();
    assert.equal((await c.client.stop({})).ok, true);
    const before = c.events().length;
    open(said('Lift All stop'));
    const got = await asked;
    assert.equal(got.ok, false);
    assert.match(got.refused, /changed while the window was open/);
    assert.equal(stopState().on, true, 'the later STOP stays on');
    assert.equal(c.events().length, before, 'nothing was recorded');
  } finally {
    await c.close();
  }
});

test('under STOP the window serves only the Lift All stop card', async () => {
  let open = null;
  const c = await computer(() => new Promise((resolve) => { open = resolve; }));
  try {
    const first = await c.card(runbookCard(1));
    const second = await c.card(runbookCard(2));
    assert.equal((await c.client.stop({})).ok, true);
    // Refused before any window opens.
    assert.deepEqual(await c.client.confirm({ project: PROJECT, ...first }), { ok: false, refused: 'All stop is on' });
    assert.equal(c.windows.length, 0);
    liftStop();
    // STOP set while a card's window is open: the click records nothing.
    const asked = c.client.confirm({ project: PROJECT, ...second });
    for (let i = 0; i < 400 && open === null; i++) await new Promise((r) => { setTimeout(r, 10); });
    assert.ok(open, 'the window opened');
    assert.equal((await c.client.stop({})).ok, true);
    const before = c.events().length;
    open(said('Do it'));
    assert.deepEqual(await asked, { ok: false, refused: 'All stop is on' });
    assert.equal(c.events().length, before, 'nothing was recorded');
  } finally {
    liftStop();
    await c.close();
  }
});

test('under STOP a card of a project that isn\'t Lean is refused before it is looked up', async () => {
  let asked = 0;
  const adapter = { defaultBranch: async () => 'main', prState: async () => { asked += 1; return { headSha: HEAD, mergeable: 'mergeable', state: 'open' }; } };
  const c = await computer(() => said('Approve'), { adapter });
  try {
    const shown = await c.card({
      question: `Merge the login page?\n${approvalLine(7, HEAD.slice(0, 12))}`, header: 'Approve', options: ['Approve', 'Not now'], kind: 'approval', level: 3,
    });
    assert.equal((await c.client.stop({})).ok, true);
    // Nothing is looked at: not the state, nor the code host's pull request.
    assert.deepEqual(await c.client.confirm({ project: c.project, ...shown }), { ok: false, refused: 'All stop is on' });
    assert.deepEqual(await c.client.confirm({ project: c.project, card: '00000000-0000-4000-8000-000000000000', hash: 'a'.repeat(64) }), { ok: false, refused: 'All stop is on' });
    assert.equal(asked, 0, 'the code host was not asked');
    assert.equal(c.windows.length, 0);
  } finally {
    liftStop();
    await c.close();
  }
});

test('a window-signed approval takes its card out of waiting, with the plain answer beside it', async () => {
  const adapter = { defaultBranch: async () => 'main', prState: async () => ({ headSha: HEAD, mergeable: 'mergeable', state: 'open' }) };
  const c = await computer(() => said('Approve'), { adapter });
  try {
    const card = {
      question: `Merge the login page?\nThe review found nothing to change.\n${approvalLine(7, HEAD.slice(0, 12))}`,
      header: 'Approve',
      options: ['Approve', 'Show me', 'Not now'],
      kind: 'approval',
      level: 4,
    };
    const shown = await c.card(card);
    const got = await c.client.confirm({ project: c.project, ...shown });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.deepEqual([got.recorded, got.kind, got.step, got.choice], [true, 'approval', 'approval', 'Approve']);
    assert.deepEqual(argvOf(c.windows[0].args).slice(3), ['Approve'], 'Show me stays in the chat');
    const approval = c.events().find((e) => e.id === got.id);
    assert.deepEqual(approval.data, { pr: 7, commit: HEAD, words: 'Approve', question: card.question, proof: 'window' });
    assert.ok(verify(approval, readEnrolled()));
    const answers = c.events().filter((e) => e.kind === 'card-answer');
    assert.deepEqual(answers.map((e) => e.data), [{ card: shown.card, question: card.question, label: 'Approve' }]);
    assert.ok(!answers[0].sig, 'the answer beside it is plain');
    const { views } = await c.client.state.views({ project: c.project });
    assert.ok(!views.waiting.some((w) => w.id === shown.card), 'the card no longer waits');
    assert.match((await c.client.confirm({ project: c.project, ...shown })).refused, /no longer waits/);
  } finally {
    await c.close();
  }
});
