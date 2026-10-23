// tests/e2e/mod.test.js
// The mod end to end, through its bridge as the mod runs it: a child `node scripts/mod/bridge.js`
// with one JSON request on standard input and one JSON line back, in the computer's own
// WHEELHOUSE_HOME. One computer per test: a real helper on the home's socket, where the bridge
// finds it, the project's state and the director's profile each on a bare repository, pull
// request 7 on the host behind a stand-in for gh and glab, and the gate's own merge. The front
// desk's cards are composed by its command (scripts/frontdesk/cli.js card), the director's clicks
// in the chat are the prompt-record hook's, and the board is the board-context hook's.
//
// The bridge runs on the real clock, as it does under the mod. The project's configuration names
// Shape 2, so a front desk's tick never starts a watcher process. Where a test needs time to
// pass (the courier's gap, the watcher's bundling minute), it moves back the time the bridge's
// own file kept, as that much time passing would leave it. The bridge's time zone is one where it
// is about midday now, so Away until 18:00 is on offer and no quiet hours apply.
//
// The programs no test may reach for real are stand-ins first on the PATH for the whole file
// (tests/helpers/host-stand-ins.js), for the helper's own calls by name and the bridge's child: the
// board's host facts read protection with `gh api` when their cache doesn't cover the prompt's
// time. Each test asserts none of them ran.
//
// On Windows the bridge finds the helper at the user's own named pipe, which no test may take,
// so this file runs on macOS and Linux only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHelper } from '../../scripts/host/helper.js';
import { helperClient } from '../../scripts/host/helper-client.js';
import { decide as boardContext, HEADINGS } from '../../scripts/hooks/board-context.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { pendingDir } from '../../scripts/hooks/pending.js';
import { main as frontDesk } from '../../scripts/frontdesk/cli.js';
import { SAYS, SETUP_ROLE } from '../../scripts/mod/bridge.js';
import { SAYS as PRESS_SAYS } from '../../scripts/mod/press.js';
import { SENT_TO_FRONT_DESK, SETTINGS_UNDER_STOP } from '../../scripts/lib/calm-words.js';
import { readPaneStatus, hashOf } from '../../scripts/mod/status.js';
import { courierFile } from '../../scripts/mod/courier.js';
import { watchFile } from '../../scripts/mod/watch.js';
import { readSeen } from '../../scripts/briefing/seen.js';
import { repliedDir } from '../../scripts/mod/reply.js';
import { FOREMAN_PROMPT_LEAD } from '../../scripts/foreman/start.js';
import { briefHash } from '../../scripts/feature/files.js';
import { BUNDLE_MS } from '../../scripts/lib/build-loop.js';
import { COURIER_GAP_MS, FOREMAN_TICK_MS, LEADS, TICK_MS } from '../../scripts/lib/mod-numbers.js';
import { keysDir, profileDir, stateDir, wheelhouseHome } from '../../scripts/lib/paths.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { recordRole } from '../../scripts/lib/role.js';
import { run } from '../../scripts/lib/run.js';
import { SETUP_STEPS } from '../../scripts/lib/setup-run.js';
import { stopState } from '../../scripts/lib/stop.js';
import { startRun, markStep, addChanges, newId } from '../../scripts/setup/journal.js';
import { composeCard } from '../../scripts/cards/compose.js';
import { approvalLine, replyCode, setLineOf } from '../../scripts/state/card-lines.js';
import { listEvents, makeEvent } from '../../scripts/state/events.js';
import { enrol, makeSigningKey, verify, readEnrolled } from '../../scripts/state/signing.js';
import { readCursor, writeCursor } from '../../scripts/watcher/core.js';
import { projectConfig } from '../../scripts/watcher/main.js';
import { readWake } from '../../scripts/watcher/waker.js';
import { makeBareRemote, g } from '../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../helpers/homes.js';
import { standInTools } from '../helpers/host-stand-ins.js';
import { prOnHost } from '../helpers/pr-on-host.js';
import { matchingBody } from '../helpers/provenance.js';
import { waitLongerOnTheHelper, WAIT_MS } from '../helpers/until.js';

// These tests run the real helper and check what reaches it, however loaded the computer is.
waitLongerOnTheHelper();

const BRIDGE = fileURLToPath(new URL('../../scripts/mod/bridge.js', import.meta.url));
const SKIP = process.platform === 'win32' ? 'the bridge finds the helper at the user\'s own named pipe on Windows' : false;
const PROJECT = 'o__p';
const PR = 7;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// The child's limit: the bridge answers within its own, and a test machine running every file at once is given longer.
const CHILD_MS = 2 * WAIT_MS;
// A folder that is never created, so no managed copy of the hooks is found.
const NO_MANAGED = path.join(tempFolder('wh-no-managed-'), 'absent');
// The project's configuration on its default branch: Shape 2, so no tick starts a watcher process.
const CONFIG = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], watcherShape: 2 };
// A pull request body stamped with what matches the installed manifest, so the gate's provenance condition passes.
const BODY = matchingBody();

// A time zone where it is about midday now: Etc/GMT-N is N hours ahead of UTC.
function middayZone(at = new Date()) {
  const ahead = 12 - at.getUTCHours();
  return ahead === 0 ? 'Etc/UTC' : `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
}
const ZONE = middayZone();

// gh and glab stood in for: pull request 7 open at `head`, CI green on it, main the default branch.
function standInHost(head) {
  const merges = [];
  return {
    merges,
    defaultBranch: async () => 'main',
    prState: async () => ({ headSha: head, mergeable: 'mergeable', state: 'open', body: BODY }),
    ciState: async (sha) => ({ sha, state: 'success' }),
    merge: async (args) => { merges.push(args); return { merged: true }; },
    openPr: async () => ({ number: PR }),
    updatePr: async () => ({ number: PR }),
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

// The host's default branch with the product and its configuration.
async function seedMain(remoteUrl) {
  const seed = tempFolder('wh-seed-');
  await g(seed, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(seed, '.claude'));
  fs.writeFileSync(path.join(seed, 'README.md'), 'The product.\n');
  fs.writeFileSync(path.join(seed, '.claude', 'wheelhouse.json'), `${JSON.stringify(CONFIG)}\n`);
  await g(seed, 'add', '-A');
  await g(seed, 'commit', '-q', '-m', 'The product');
  await g(seed, 'push', '-q', remoteUrl, 'HEAD:refs/heads/main');
}

// The director's checkout: main with one commit, and a branch called feature.
async function makeFolder() {
  const folder = fs.realpathSync.native(tempFolder('wh-folder-'));
  await g(folder, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(folder, 'app.txt'), 'hello\n');
  await g(folder, 'add', '-A');
  await g(folder, 'commit', '-q', '-m', 'Start');
  await g(folder, 'branch', 'feature');
  return folder;
}

// The host facts as a fresh cache, so reading the board never asks the host. It is kept from four
// hours ago, before the earliest prompt a test makes (three hours back), and is under a day old at
// the latest (two hours on).
function freshFacts() {
  const file = path.join(stateDir(PROJECT), '..', 'host-facts.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at: new Date(Date.now() - 4 * HOUR).toISOString(), facts: { protection: 'on', ci: 'present' } })}\n`);
}

// The host's tools, stood in for while this file runs.
let tools;
before(() => { tools = standInTools(); });
after(() => tools.restore());

// One computer: a home with an enrolled key, the project registered with its state on a bare
// repository and pull request 7 there, the profile on its own, and a helper on the home's socket.
// `register` false leaves the project's record to the test. The test's body runs inside the
// home, since the helper answers the bridge in this process and reads WHEELHOUSE_HOME as it does.
// The helper is closed inside the home too: a request a bridge gave up on (its own time limit,
// under load) is still being answered then, and outside the home it would write the real one.
async function onComputer({ register = true } = {}, body) {
  tools.reset();
  const remote = await makeBareRemote({ repo: 'o/p' });
  const profileRemote = await makeBareRemote({ repo: 'o/profile' });
  await seedMain(remote.url);
  const head = await prOnHost(remote.url, { number: PR, files: { 'src/sign-in.js': 'export const signIn = true;\n' } });
  const home = shortHome();
  const folder = await makeFolder();
  const host = standInHost(head);
  const c = { home, folder, head, host, remote };
  c.register = () => writeProject(PROJECT, {
    folder, remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
  });
  try {
    await as(home, async () => {
      if (register) c.register();
      enrol({ ...makeSigningKey(), enrolledAt: '2026-10-18T00:00:00.000Z' });
      fs.writeFileSync(path.join(wheelhouseHome(), 'profile.json'), JSON.stringify({
        remoteUrl: profileRemote.url, host: 'github', repo: 'o/profile', connection: { host: 'github', mode: 'quick', project: 'o/profile' },
      }));
      freshFacts();
      const helper = await startHelper({ address: testAddress(home), adapterFor: async () => host, envFor: async () => ({}) });
      try {
        c.client = helperClient({ address: helper.address });
        if (register) {
          assert.deepEqual(await c.client.state.clone({ project: PROJECT }), { ok: true });
          assert.equal((await projectConfig(PROJECT, c.client)).config?.watcherShape, 2, 'the configuration is read from the default branch');
        }
        await body(c);
      } finally {
        await helper.close();
      }
    });
    assert.deepEqual(tools.calls(), [], 'no host tool ran');
  } finally {
    remote.cleanup();
    profileRemote.cleanup();
  }
}

// --- What the mod sends ---

// The bridge as the mod runs it: a child process, one request on standard input, one JSON line
// on standard output, exit code 0. The session's role is the bridge's to find, so none is given.
async function bridge(c, request) {
  const done = await run(process.execPath, [BRIDGE], {
    env: { WHEELHOUSE_HOME: c.home, TZ: ZONE, WHEELHOUSE_ROLE: undefined }, input: JSON.stringify(request), timeoutMs: CHILD_MS,
  });
  assert.equal(done.code, 0, done.stderr);
  const lines = done.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, done.stdout);
  return JSON.parse(lines[0]);
}

const tick = (c, { session = 'sess-front', idle = true } = {}) => bridge(c, { cmd: 'tick', session, cwd: c.folder, idle, surface: 'desktop' });
// A press on the pane, naming the card as the pane drew it.
const press = (c, drawn, label) => bridge(c, { cmd: 'press', origin: 'pane', cwd: c.folder, card: drawn.id, hash: drawn.hash, label });
const choose = (c, key, choice) => bridge(c, { cmd: 'setting', origin: 'pane', cwd: c.folder, key, choice });
const drawnCard = (answer, id) => answer.pane.cards.find((card) => card.id === id);

// --- The front desk and the director ---

// A card the front desk composes and records with its own command, handed out to ask.
async function composed(c, input) {
  let said = '';
  let error = '';
  const code = await frontDesk(['card'], { cwd: c.folder, client: c.client, input: JSON.stringify(input), out: (t) => { said += t; }, err: (t) => { error += t; } });
  assert.equal(code, 0, error);
  return JSON.parse(said);
}

// The front desk's approval card for pull request 7.
const APPROVAL = {
  kind: 'approval',
  level: 3,
  what: `Pull request #${PR} adds the sign-in page.`,
  why: 'It changes what users see, which is yours to decide at level 3.',
  options: [{ label: 'Approve', says: 'It goes ahead.' }],
  recommend: 'Approve',
  because: 'the checks passed and the change is small',
  meanwhile: 'Nothing is released and the agents carry on with other work.',
};
// Composed and handed out by the front desk's command, which asks the host for the head.
const approvalCard = (c) => composed(c, { ...APPROVAL, target: { pr: PR } });

// A card recorded but not yet handed out, as one written while no visit runs.
async function waitingCard(c, question) {
  const written = await c.client.state.write({
    project: PROJECT, kind: 'card', data: { question, header: 'Question', options: ['Yes', 'No'], kind: 'question', line: null, code: null, level: 3, importance: 1 },
  });
  assert.equal(written.ok, true, JSON.stringify(written));
  return written.id;
}

// The director's click on a card in the chat, as Claude Code sends it to the prompt-record hook.
function click(c, asked, label) {
  return promptRecord({
    session_id: 'sess-front', cwd: c.folder, permission_mode: 'default', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions: [asked], answers: { [asked.question]: label } }, tool_response: { questions: [asked], answers: { [asked.question]: label } }, tool_use_id: 'toolu_1',
  }, { client: c.client, dir: NO_MANAGED });
}

// The director's prompt, as the board-context hook sees it: the text it adds, or undefined.
async function prompt(c, text, at = new Date()) {
  const out = await boardContext(
    { session_id: 'sess-front', cwd: c.folder, hook_event_name: 'UserPromptSubmit', prompt: text },
    { now: () => at, env: {}, client: c.client, dir: NO_MANAGED, waitMs: 10000 },
  );
  return out?.hookSpecificOutput?.additionalContext;
}

const eventsOf = (kind, dir = stateDir(PROJECT)) => listEvents(dir, { report: () => {} }).filter((e) => e.kind === kind);
const kept = () => {
  try {
    return fs.readdirSync(pendingDir(PROJECT)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
};
const signedBy = (event) => verify(event, readEnrolled());

// The gate: the merge the foreman asks for, which needs the director's approval of the head.
const merge = (c) => c.client.merge({ project: PROJECT, number: PR, stop: false, bypass: false, approvalRequired: true });

// The pull request ready but for the approval: the lock taken, and a CLEAN review of its head.
async function readyButApproval(c) {
  assert.equal((await c.client.lock.take({ project: PROJECT })).result.taken, true);
  const review = makeEvent({ kind: 'review', data: { pr: PR, commit: c.head, verdict: 'CLEAN' } });
  assert.equal((await c.client.state.record({ project: PROJECT, event: review })).ok, true);
  assert.deepEqual((await merge(c)).reasons, [`no approval of ${c.head.slice(0, 7)}`]);
}

// --- The tests ---

test('a tick draws a waiting approval card; Approve from the pane lets the gate merge that commit', { skip: SKIP }, () => onComputer({}, async (c) => {
  await readyButApproval(c);
  const card = await approvalCard(c);

  // The pane draws the card whole, with the buttons a click on it offers.
  const drawn = drawnCard(await tick(c), card.id);
  assert.equal(drawn.n, 1);
  assert.equal(drawn.kind, 'approval');
  assert.equal(drawn.text, card.question.question, 'the card\'s text, exactly as written');
  assert.equal(drawn.hash, hashOf(card.question.question));
  assert.deepEqual(drawn.buttons, [
    { label: 'Approve', does: 'record', shape: 'filled' },
    { label: 'Suggest a change…', does: 'suggest', shape: 'outlined' },
    { label: 'Not now', does: 'record', shape: 'small', corner: true },
    { label: 'Why?', does: 'why', shape: 'small' },
    { label: 'Show me', does: 'turn', shape: 'small' },
  ]);

  assert.deepEqual(await press(c, drawn, 'Approve'), { ok: true, says: 'Approved.' });
  const approvals = eventsOf('approval');
  assert.equal(approvals.length, 1);
  assert.deepEqual([approvals[0].data.pr, approvals[0].data.commit], [PR, c.head]);
  assert.equal(signedBy(approvals[0]), true, 'signed with this computer\'s key');
  assert.deepEqual(kept(), [], 'the helper took the record');

  assert.deepEqual(await merge(c), { ok: true, merged: true, sha: c.head, guardrailPaths: [], criticalAreas: [] });
  assert.deepEqual(c.host.merges, [{ number: PR, sha: c.head }]);
  // The card is answered, so the pane draws it no more.
  assert.equal(drawnCard(await tick(c), card.id), undefined);
}));

test('Not now from the pane keeps the card waiting and off the next visit\'s cards', { skip: SKIP }, () => onComputer({}, async (c) => {
  // The approval card, recorded before any visit has handed it out, and a question beside it.
  const { card: data } = composeCard({ ...APPROVAL, target: { pr: PR, sha: c.head } });
  const written = await c.client.state.write({ project: PROJECT, kind: 'card', data });
  assert.equal(written.ok, true, JSON.stringify(written));
  const other = await waitingCard(c, 'Which colour goes on the sign-in button?');
  const before = await tick(c);
  const drawn = drawnCard(before, written.id);
  assert.equal(drawn.asked, false);
  assert.equal(drawnCard(before, other).asked, false);

  // Not now records the card answer alone, and hands the front desk nothing.
  assert.deepEqual(await press(c, drawn, 'Not now'), { ok: true, says: `Recorded: Not now on card ${drawn.n}` });
  assert.deepEqual(eventsOf('card-answer').map((e) => e.data), [{ question: data.question, label: 'Not now' }]);
  assert.deepEqual(eventsOf('approval'), []);

  // Still waiting, as put off: the pane draws it under the same number, with its buttons.
  const after = drawnCard(await tick(c), written.id);
  assert.equal(after.n, drawn.n);
  assert.equal(after.asked, true);
  assert.deepEqual(after.buttons, drawn.buttons);
  // The next visit asks the other card, and not this one.
  let said = '';
  assert.equal(await frontDesk(['cards'], { cwd: c.folder, client: c.client, out: (t) => { said += t; }, err: () => {} }), 0);
  assert.deepEqual(JSON.parse(said).questions.map((q) => q.question), ['Which colour goes on the sign-in button?']);
}));

test('a card answered by its reply code is refused when pressed in the pane afterwards', { skip: SKIP }, () => onComputer({}, async (c) => {
  const card = await approvalCard(c);
  const drawn = drawnCard(await tick(c), card.id);
  // The director puts the card off in the chat, so its code is on record, and later replies from the phone.
  await click(c, card.question, 'Not now');
  assert.equal(eventsOf('shown').length, 1);
  const code = replyCode(setLineOf(card.question.question));
  assert.deepEqual(await bridge(c, { cmd: 'reply', origin: 'bridge', text: `${code} approve`, cwd: c.folder }), { ok: true, says: `Recorded: Approve pull request #${PR}` });
  assert.equal(eventsOf('approval').length, 1);

  // The pane drew the card before the reply; its press now records nothing.
  for (const label of ['Approve', 'Not now']) {
    assert.deepEqual(await press(c, drawn, label), { ok: false, says: PRESS_SAYS.answered }, label);
  }
  assert.equal(eventsOf('approval').length, 1);
  assert.deepEqual(eventsOf('card-answer').map((e) => e.data.label), ['Not now', 'Approve'], 'the chat\'s Not now and the reply\'s answer, nothing more');
}));

test('Pace 2 from the settings pane is in force at once, confirmed, and shown on the board', { skip: SKIP }, () => onComputer({}, async (c) => {
  const paceRow = async () => (await bridge(c, { cmd: 'settings', cwd: c.folder })).rows.find((r) => r.key === 'pace');
  const before = await paceRow();
  assert.equal(before.current, '3');
  assert.equal(before.from, 'the default');

  assert.deepEqual(await choose(c, 'pace', '2'), { ok: true, says: 'Builders at once is now 2, for this project' });
  const after = await paceRow();
  assert.equal(after.current, '2');
  assert.equal(after.from, 'this project');
  assert.deepEqual(after.choices.filter((choice) => choice.chosen).map((choice) => choice.id), ['2']);

  // The setting and the director's signed confirmation of it, both taken by the helper.
  const [setting] = eventsOf('setting');
  assert.deepEqual(setting.data, { key: 'pace', value: 2 });
  const confirmations = eventsOf('confirmation');
  assert.deepEqual(confirmations.map((e) => e.data.confirms), [setting.id]);
  assert.equal(signedBy(confirmations[0]), true);
  assert.deepEqual(kept(), []);

  // The board's settings show it, in force, with no confirm left waiting.
  const shown = await prompt(c, '/wheelhouse:settings');
  assert.ok(shown.startsWith(`${HEADINGS.settings}\n\n`), shown);
  assert.match(shown, /^Builders at once: 2 \(this project\)$/m);
  const board = await prompt(c, '/wheelhouse:board');
  assert.ok(board.startsWith(`${HEADINGS.board}\n\n`), board);
  assert.doesNotMatch(board, /not yet confirmed by you|Changed without your confirmation/, 'the board has nothing of it waiting for a confirm');
}));

test('STOP from the pane holds a push; Lift STOP from the pane lets it through, with a signed lift', { skip: SKIP }, () => onComputer({}, async (c) => {
  const pushFeature = () => c.client.push({ project: PROJECT, dir: c.folder, refspec: 'feature' });
  assert.equal((await c.client.lock.take({ project: PROJECT })).result.taken, true);
  assert.deepEqual(await bridge(c, { cmd: 'stop', origin: 'pane', cwd: c.folder }), { ok: true, says: SAYS.stopOn });
  assert.equal(stopState().on, true);
  assert.deepEqual(await pushFeature(), { ok: false, refused: 'STOP is on' });

  // The pane draws STOP with its start, which Lift STOP sends back.
  const { stop } = (await tick(c)).pane;
  assert.deepEqual(stop, { on: true, since: stopState().at });
  // A Lift STOP that names another STOP leaves it on.
  assert.deepEqual(await bridge(c, { cmd: 'go', origin: 'pane', cwd: c.folder, since: new Date(Date.parse(stop.since) - MINUTE).toISOString() }), { ok: false, says: SAYS.goOtherStop });
  assert.equal(stopState().on, true);

  assert.deepEqual(await bridge(c, { cmd: 'go', origin: 'pane', cwd: c.folder, since: stop.since }), { ok: true, says: `STOP is off. ${SAYS.nothingBuilding}` });
  assert.equal(stopState().on, false);
  const lifts = eventsOf('action').filter((e) => e.data.action === 'lift-stop');
  assert.equal(lifts.length, 1);
  assert.equal(signedBy(lifts[0]), true, 'the lift is signed');
  assert.deepEqual(kept(), [], 'the helper took it');
  assert.deepEqual(await pushFeature(), { ok: true });
  assert.equal(await g(c.remote.url, 'rev-parse', 'refs/heads/feature'), await g(c.folder, 'rev-parse', 'feature'));
  assert.equal((await tick(c)).pane.stop.on, false);
}));

test('a new card wakes the front desk once; away until 18:00 holds a card that blocks nothing', { skip: SKIP }, () => onComputer({}, async (c) => {
  // The session's first tick is its opening, which wakes for nothing.
  assert.equal((await tick(c)).submit, undefined);

  await waitingCard(c, 'Which photo goes on the home page?');
  const woke = await tick(c);
  assert.ok(Array.isArray(woke.submit), 'the tick woke the front desk');
  assert.equal(woke.submit.length, 1);
  const [wake] = woke.submit;
  assert.ok(wake.startsWith(`${LEADS.courier} 1 new card (1). `), wake);
  // Claude's notification is asked for before the cards, so the phone hears while the director is away.
  const ask = wake.slice(`${LEADS.courier} 1 new card (1). `.length);
  assert.ok(ask.indexOf('notification') >= 0 && ask.indexOf('notification') < ask.indexOf('ask any new cards'), ask);
  assert.equal(ask, 'Send Claude\'s notification in one line, titled "Wheelhouse", saying: 1 waiting on you: card 1. Then ask any new cards now, once.');
  // Once.
  assert.equal((await tick(c)).submit, undefined);

  // The courier's gap passes.
  const file = courierFile(PROJECT);
  const courier = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify({ ...courier, lastWakeAt: new Date(Date.parse(courier.lastWakeAt) - COURIER_GAP_MS - MINUTE).toISOString() })}\n`);

  // The director steps away until the evening.
  const presence = await choose(c, 'presence', 'away-evening');
  assert.deepEqual(presence, { ok: true, says: 'Away until 18:00. Undo in the pane for a minute.' });
  const second = await waitingCard(c, 'Which colour goes on the sign-in button?');
  // When the front desk's session last ticked, by courier.json, which only a courier that ran moves on.
  const tickedAt = () => JSON.parse(fs.readFileSync(file, 'utf8')).sessions.find((s) => s.id === 'sess-front')?.at;
  const before = tickedAt();
  const held = await tick(c);
  assert.ok(Date.parse(tickedAt()) > Date.parse(before), 'the courier ran on this tick');
  assert.equal(drawnCard(held, second).blocking, false);
  assert.equal(held.submit, undefined, 'a card that blocks nothing waits while the director is away');

  // Back: the card held wakes then, and the one already sent doesn't.
  assert.deepEqual(await choose(c, 'presence', 'here'), { ok: true, says: 'Here. Undo in the pane for a minute.' });
  assert.deepEqual((await tick(c)).submit, [`${LEADS.courier} 1 new card (2). ${ask.replace('card 1.', 'card 2.')}`]);
  assert.equal(eventsOf('confirmation', profileDir()).length, 2, 'each presence chosen is confirmed');
}));

test('a STOP wake the mod couldn\'t hand on is undone, and the next tick wakes for it again, once', { skip: SKIP }, () => onComputer({}, async (c) => {
  assert.equal((await tick(c)).submit, undefined);
  // STOP from the pane, as the director pressed it after Esc left the session interrupted.
  assert.deepEqual(await bridge(c, { cmd: 'stop', origin: 'pane', cwd: c.folder }), { ok: true, says: SAYS.stopOn });
  const woke = await tick(c);
  assert.deepEqual(woke.submit, [`${LEADS.courier} STOP is on. Send Claude's notification in one line, titled "Wheelhouse · STOP is on", saying: Every builder has halted. Open Claude to see why. Then ask any new cards now, once.`]);
  assert.deepEqual(woke.woken, [`stop:${stopState().at}`]);
  const { lastWakeAt } = JSON.parse(fs.readFileSync(courierFile(PROJECT), 'utf8'));
  assert.equal(lastWakeAt, woke.wokeAt);

  // The session took no prompt, so the mod says so.
  assert.deepEqual(await bridge(c, { cmd: 'unsent', session: 'sess-front', cwd: c.folder, ids: woke.woken, at: woke.wokeAt }), { ok: true });
  const undone = JSON.parse(fs.readFileSync(courierFile(PROJECT), 'utf8'));
  assert.deepEqual(undone.sent.map((s) => s.id), []);
  assert.equal(undone.lastWakeAt, null, 'lastWakeAt is what it was before the wake');

  // The next idle tick wakes again, and once handed on, no more.
  const again = await tick(c);
  assert.deepEqual(again.submit, woke.submit);
  assert.deepEqual(again.woken, woke.woken);
  assert.equal((await tick(c)).submit, undefined);
}));

test('/wheelhouse-digest gives the briefing, and a prompt within the next two hours brings none', { skip: SKIP }, () => onComputer({}, async (c) => {
  const now = Date.now();
  // The director's last message, three hours ago, brought a briefing; a card has come in since.
  assert.ok((await prompt(c, 'Good morning', new Date(now - 3 * HOUR))).includes(HEADINGS.briefing));
  const seen = readSeen(PROJECT);
  await waitingCard(c, 'Which photo goes on the home page?');

  const digest = await bridge(c, { cmd: 'digest', origin: 'composer', cwd: c.folder });
  assert.equal(digest.ok, true);
  // It opens with the verdict, the pane's sentence.
  assert.ok(digest.text.startsWith('One thing needs you. Nothing is broken.\n\n'), digest.text);
  assert.match(digest.text, /^Waiting on you \(\+1\):\n1\. Which photo goes on the home page\?$/m);
  // The briefing is marked given; the director's last message is not a command's to move.
  const given = readSeen(PROJECT);
  assert.equal(given.promptAt, seen.promptAt);
  assert.ok(Date.parse(given.briefedAt) > Date.parse(seen.briefedAt));

  // The director's next prompt, a minute later, brings no briefing: /wheelhouse-digest gave it.
  const next = await prompt(c, 'Thanks', new Date(Date.parse(given.briefedAt) + MINUTE));
  assert.ok(next === undefined || !next.includes(HEADINGS.briefing), next);
  // Two hours after /wheelhouse-digest, and after that prompt, the next one does.
  assert.ok((await prompt(c, 'Back again', new Date(Date.parse(given.briefedAt) + MINUTE + 2 * HOUR))).includes(HEADINGS.briefing));
}));

test('Shape 2: a state event makes one foreman wake line on the next foreman tick', { skip: SKIP }, () => onComputer({}, async (c) => {
  // The board-context hook recorded the session as the foreman's from its first prompt.
  assert.equal(recordRole('sess-foreman', 'foreman'), true);
  const foremanTick = () => tick(c, { session: 'sess-foreman' });
  // The watcher's first look: what is in state already is not news.
  assert.deepEqual(await foremanTick(), { ok: true, role: 'foreman', every: FOREMAN_TICK_MS, submit: [] });

  // Quick work, ready to start, recorded by the front desk.
  const doc = 'docs/work/export.md';
  const text = '# export\n\nThe export.\n';
  fs.mkdirSync(path.join(c.folder, 'docs', 'work'), { recursive: true });
  fs.writeFileSync(path.join(c.folder, doc), text);
  const work = await c.client.state.write({
    project: PROJECT, kind: 'work', data: { id: 'export', title: 'The export', lane: 'quick', visible: false, dependsOn: [], doc: { path: doc, hash: briefHash(text) } },
  });
  assert.equal(work.ok, true, JSON.stringify(work));
  // Found, and held for the bundling minute.
  assert.deepEqual((await foremanTick()).submit, []);
  const cursor = readCursor(PROJECT);
  assert.equal(cursor.held.foreman.events.length, 1);
  writeCursor(PROJECT, { ...cursor, held: { ...cursor.held, foreman: { ...cursor.held.foreman, first: cursor.held.foreman.first - BUNDLE_MS } } });

  const woke = await foremanTick();
  assert.equal(woke.every, FOREMAN_TICK_MS);
  assert.equal(woke.submit.length, 1, JSON.stringify(woke.submit));
  const lead = `${FOREMAN_PROMPT_LEAD} WAKE foreman `;
  assert.ok(woke.submit[0].startsWith(lead), woke.submit[0]);
  const wakeFile = woke.submit[0].slice(lead.length);
  assert.equal(path.dirname(wakeFile), path.join(c.folder, '.wheelhouse', 'foreman', 'wakes'), 'a copy in the main checkout, for the foreman to read');
  assert.deepEqual(readWake(wakeFile).events.map((e) => [e.type, e.id]), [['work-ready', work.id]]);
  // One wake, once.
  assert.deepEqual((await foremanTick()).submit, []);
}));

test('the bridge run where the signing key cannot be read signs nothing for a press', { skip: SKIP || (process.getuid?.() === 0 && 'root reads every file') }, () => onComputer({}, async (c) => {
  const card = await approvalCard(c);
  const drawn = drawnCard(await tick(c), card.id);
  // The key made unreadable, as it is to a run inside the sandbox.
  const key = path.join(keysDir(), 'signing.pem');
  fs.chmodSync(key, 0o000);
  try {
    assert.deepEqual(await press(c, drawn, 'Approve'), { ok: false, says: PRESS_SAYS.cantSign });
    assert.deepEqual(eventsOf('approval'), []);
    assert.deepEqual(eventsOf('card-answer'), []);
    assert.deepEqual(kept(), [], 'nothing kept to send later');
    assert.equal(fs.existsSync(path.join(repliedDir(PROJECT), card.id)), false, 'the card was let go');
  } finally {
    fs.chmodSync(key, 0o600);
  }
  // The card still waits, with its buttons.
  const again = drawnCard(await tick(c), card.id);
  assert.deepEqual(again.buttons.map((b) => b.label), drawn.buttons.map((b) => b.label));
  assert.deepEqual(await press(c, again, 'Approve'), { ok: true, says: 'Approved.' });
  assert.equal(eventsOf('approval').length, 1);
}));

test('a tick in a project still being set up answers setup, draws nothing and wakes no one; once setup is finished the next tick answers the front desk', { skip: SKIP }, () => onComputer({ register: false }, async (c) => {
  // Setup's run on the folder: steps 1 and 2 done, and step 3 registers the project.
  const run_ = startRun({ folder: c.folder, project: PROJECT });
  for (const n of [1, 2]) markStep(run_.id, n, 'doneAt');
  c.register();
  markStep(run_.id, 3, 'doneAt');
  assert.deepEqual(await c.client.state.clone({ project: PROJECT }), { ok: true });
  assert.equal((await projectConfig(PROJECT, c.client)).config?.watcherShape, 2);
  const card = await waitingCard(c, 'Which photo goes on the home page?');

  for (const idle of [true, false]) {
    assert.deepEqual(await tick(c, { idle }), { ok: true, role: SETUP_ROLE, every: TICK_MS });
  }
  assert.equal(readPaneStatus(PROJECT), null, 'no pane is kept');
  assert.equal(fs.existsSync(courierFile(PROJECT)), false, 'the courier never ran');
  assert.equal(fs.existsSync(watchFile(PROJECT)), false, 'nor did the watcher\'s check');

  // Setup's last steps, and the health check's board found green, which finishes setup (setup's
  // ruling R67).
  for (const { n } of SETUP_STEPS) markStep(run_.id, n, 'doneAt');
  addChanges(run_.id, [{ id: newId('chg'), step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: new Date().toISOString() } }]);
  const after = await tick(c);
  assert.equal(after.role, 'front-desk');
  assert.equal(after.every, TICK_MS);
  assert.equal(after.status, after.glance);
  assert.equal(drawnCard(after, card).n, 1);
  assert.deepEqual(readPaneStatus(PROJECT), after.pane);
  // The front desk's first tick is its opening: the card is the visit's to ask, not a wake.
  assert.equal(after.submit, undefined);
}));

// Every file under `dir`, with its text, so a test can look for words that must be nowhere.
function textsUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return textsUnder(full);
    return entry.isFile() ? [fs.readFileSync(full, 'utf8')] : [];
  });
}

// A commit on top of pull request 7's head on the host, as when the build amends the change. Resolves with the new head.
async function commitOnPullRequest(c, files) {
  const work = tempFolder('wh-pr-more-');
  await g(work, 'init', '-q', '-b', 'main');
  await g(work, 'fetch', '-q', c.remote.url, `refs/pull/${PR}/head`);
  await g(work, 'reset', '-q', '--hard', 'FETCH_HEAD');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
    fs.writeFileSync(path.join(work, name), text);
  }
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Make the heading bigger');
  await g(work, 'push', '-q', c.remote.url, `HEAD:refs/pull/${PR}/head`);
  return g(work, 'rev-parse', 'HEAD');
}

test('Why? notes quietly; a suggestion on an approval hands the words on, signs nothing and stores nothing; a revised approval at a new head is the one Approve signs', { skip: SKIP }, () => onComputer({}, async (c) => {
  const card = await approvalCard(c);
  const drawn = drawnCard(await tick(c), card.id);
  const code = replyCode(setLineOf(card.question.question));

  // The pane draws the card's parts word for word.
  assert.equal(drawn.parts.ask, `Put pull request #${PR} live?`);
  assert.equal(drawn.parts.what, 'Proposed change #7 adds the sign-in page.');
  assert.equal(drawn.parts.recommendation, 'Approve, because the checks passed and the change is small.');
  assert.equal(drawn.parts.line, approvalLine(PR, c.head));
  assert.equal(drawn.parts.code, code);
  assert.equal(drawn.parts.meanwhile, APPROVAL.meanwhile);
  assert.equal(drawn.steered, null);
  assert.equal(drawn.revised, false);
  // The card is shown in the chat and put off, so its reply code is live.
  await click(c, card.question, 'Not now');
  assert.equal(eventsOf('shown').length, 1);

  // Why? answers quietly: no words, no prompt, the card still waiting.
  assert.deepEqual(await bridge(c, { cmd: 'why', origin: 'pane', cwd: c.folder, card: drawn.id, hash: drawn.hash }), { ok: true });
  assert.deepEqual(eventsOf('card-answer').map((e) => e.data.label), ['Not now', 'Why?']);
  assert.deepEqual(eventsOf('approval'), []);
  assert.equal(drawnCard(await tick(c), card.id).id, card.id, 'still waiting');

  // A suggestion carrying the card's own reply code and an approving word is words, not an answer.
  const words = `${code} approve it now, and make the heading bigger zq-suggestion-marker`;
  const sent = await bridge(c, { cmd: 'suggest', origin: 'pane', cwd: c.folder, card: drawn.id, hash: drawn.hash, words });
  assert.equal(sent.ok, true);
  assert.equal(sent.says, SENT_TO_FRONT_DESK);
  assert.equal(sent.submit.length, 1);
  assert.ok(sent.submit[0].startsWith(`${LEADS.pane} the director suggested a change on card ${drawn.n} (${card.id}): `), sent.submit[0]);
  assert.ok(sent.submit[0].includes('zq-suggestion-marker'), 'the prompt carries the words');
  assert.deepEqual(eventsOf('approval'), [], 'the words signed nothing');
  assert.deepEqual(eventsOf('card-answer').map((e) => e.data.label), ['Not now', 'Why?', 'Suggest a change…']);
  assert.deepEqual(kept(), []);
  // The words are in no file anywhere in the Wheelhouse home.
  for (const text of textsUnder(wheelhouseHome())) assert.equal(text.includes('zq-suggestion-marker'), false);
  // The prompt handed on, sent back as a reply, is no answer.
  const replied = await bridge(c, { cmd: 'reply', origin: 'bridge', text: sent.submit[0], cwd: c.folder });
  assert.equal(replied.ok, false, JSON.stringify(replied));
  assert.deepEqual(eventsOf('approval'), []);
  assert.deepEqual(kept(), []);
  // The pane draws the card as steered.
  const steeredCard = drawnCard(await tick(c), card.id);
  assert.equal(typeof steeredCard.steered, 'string');
  // The card is steered and still waits for its revision.
  const waiting = (await c.client.state.views({ project: PROJECT })).views.waiting.find((w) => w.id === card.id);
  assert.equal(typeof waiting.steered, 'string', 'the card is marked steered');

  // The revision at the same head is refused, with the old card still waiting.
  const revision = { ...APPROVAL, target: { pr: PR }, revises: card.id, changed: 'The heading is bigger.' };
  let error = '';
  const refused = await frontDesk(['card'], { cwd: c.folder, client: c.client, input: JSON.stringify(revision), out: () => {}, err: (t) => { error += t; } });
  assert.notEqual(refused, 0);
  assert.match(error, /a revised approval needs the change committed first/);
  assert.equal(drawnCard(await tick(c), card.id).id, card.id);

  // The change is committed: the pull request's head moves on the host.
  const head2 = await commitOnPullRequest(c, { 'src/sign-in.js': 'export const signIn = true;\nexport const heading = 2;\n' });
  assert.notEqual(head2, c.head);
  c.host.prState = async () => ({ headSha: head2, mergeable: 'mergeable', state: 'open', body: BODY });
  const revised = await composed(c, revision);
  assert.notEqual(revised.id, card.id);
  const after = await tick(c);
  assert.equal(drawnCard(after, card.id), undefined, 'the old card is closed');
  const drawnRevised = drawnCard(after, revised.id);
  assert.equal(drawnRevised.kind, 'approval');
  assert.equal(drawnRevised.revised, true);
  assert.deepEqual(drawnRevised.buttons[0], { label: 'Approve', does: 'record', shape: 'filled' });
  assert.equal(drawnRevised.parts.line, approvalLine(PR, head2));
  assert.equal(after.pane.cards.filter((x) => x.kind === 'approval').length, 1);
  const newCode = replyCode(setLineOf(revised.question.question));
  assert.notEqual(newCode, code, 'the revised card is for the new head');

  // The old card answers nothing: not its pane press, and not its reply code.
  assert.equal((await press(c, drawn, 'Approve')).ok, false);
  const old = await bridge(c, { cmd: 'reply', origin: 'bridge', text: `${code} approve`, cwd: c.folder });
  assert.deepEqual(old, { ok: false, says: 'That card\'s answer can\'t be recorded now' });
  assert.deepEqual(eventsOf('approval'), []);

  // Approve on the revised card signs the revised card's own commit.
  assert.deepEqual(await press(c, drawnRevised, 'Approve'), { ok: true, says: 'Approved.' });
  const approvals = eventsOf('approval');
  assert.equal(approvals.length, 1);
  assert.deepEqual([approvals[0].data.pr, approvals[0].data.commit], [PR, head2]);
  assert.equal(signedBy(approvals[0]), true);
  assert.deepEqual(kept(), []);
}));

test('a pick in the settings pane is undone within a minute; Undo under STOP is refused and records nothing', { skip: SKIP }, () => onComputer({}, async (c) => {
  const paceRow = async () => (await bridge(c, { cmd: 'settings', cwd: c.folder })).rows.find((r) => r.key === 'pace');
  assert.equal((await paceRow()).current, '3');

  assert.deepEqual(await choose(c, 'pace', '2'), { ok: true, says: 'Builders at once is now 2, for this project' });
  const picked = await paceRow();
  assert.equal(picked.current, '2');
  assert.equal(picked.changed?.undo, true, 'the row offers Undo');

  // Undo within the minute puts back the value before.
  const undone = await choose(c, 'pace', 'undo');
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal((await paceRow()).current, '3');
  assert.deepEqual(eventsOf('setting').map((e) => e.data.value), [2, 3]);
  assert.equal(eventsOf('confirmation').length, 2, 'the pick and its undo are each confirmed');

  // A second pick, then STOP: Undo is refused and nothing more is recorded.
  assert.equal((await choose(c, 'pace', '1')).ok, true);
  assert.deepEqual(await bridge(c, { cmd: 'stop', origin: 'pane', cwd: c.folder }), { ok: true, says: SAYS.stopOn });
  const settings = eventsOf('setting').length;
  const confirmations = eventsOf('confirmation').length;
  assert.deepEqual(await choose(c, 'pace', 'undo'), { ok: false, says: SETTINGS_UNDER_STOP });
  assert.equal(eventsOf('setting').length, settings);
  assert.equal(eventsOf('confirmation').length, confirmations);
  assert.deepEqual(kept(), []);
  assert.equal((await paceRow()).current, '1', 'the value stays as picked');
}));
