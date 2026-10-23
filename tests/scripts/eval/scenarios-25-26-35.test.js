// tests/scripts/eval/scenarios-25-26-35.test.js
// The front desk scenarios' set-up pieces and judgements: the stand-in helper's state, the scratch
// plugin that holds the real front desk, the readers, and the judgements of scenarios 25, 26, 35
// and 27's route leg, on made-up streams and events.
import { knowsNoSystemCa } from '../../../scripts/protection/settings.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import {
  PLAIN_PROMPT, PLUGIN_FILES, briefHash, cardsRecorded, codeReads, codeWrites, documentWithHash, howAsked, importClosure,
  inProject, isProductCode, replyText, saidAbout, seedEvent, setUpFrontDesk,
} from '../../../scripts/eval/front-desk.js';
import { parseArgs } from '../../../scripts/eval/harness.js';
import { loadScenarios } from '../../../scripts/eval/run.js';
import { standInViews, startStandInHelper } from '../../../scripts/eval/stand-in-helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { FRONT_DESK_LINE, toolSheetLines } from '../../../scripts/hooks/session-start.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { amendLine, approveWorkLine } from '../../../scripts/state/card-lines.js';
import { makeScratchProject } from '../../../probes/lib/scratch.js';
import { EXISTING, MESSAGE as MESSAGE_25, judge as judge25 } from '../../eval/build-loop/25-split-and-duplicate.js';
import { DESIGN as DESIGN_26, WORK as WORK_26, judge as judge26 } from '../../eval/build-loop/26-steering.js';
import { judge as judge27 } from '../../eval/build-loop/27-front-desk-route.js';
import { DESIGN as DESIGN_35, judge as judge35 } from '../../eval/build-loop/35-design-to-queue.js';
import { shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

// The events of tool calls, each answered: [name, input, resultText, { parent }], and text the
// main session said: ['say', text].
function events(...steps) {
  const out = [];
  steps.forEach(([name, input, text = '', { parent = null } = {}], i) => {
    if (name === 'say') {
      out.push({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: input }] } });
      return;
    }
    const id = `t${i}`;
    out.push({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
    out.push({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
  });
  return out;
}

const write = (dir, relative, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
  fs.writeFileSync(path.join(dir, relative), text);
};
const intake = ['Skill', { skill: 'wheelhouse:intake' }, 'loaded'];

// A card as `cli.js card` composes and records it, for a work's approval or amendment.
const cardFor = (kind, target) => composeCard({
  kind,
  level: 3,
  what: `${kind === 'amend' ? 'Change' : 'Approve'} ${target.work} as written.`,
  why: 'It is yours to decide, so it comes to you.',
  options: [{ label: kind === 'amend' ? 'Change it' : 'Approve', says: 'It goes ahead.' }],
  recommend: kind === 'amend' ? 'Change it' : 'Approve',
  because: 'it is what you asked for',
  meanwhile: 'Other work carries on.',
  target,
});

// Runs a command with `input` on standard input and resolves with { code, out, err }; never
// blocks this process, where the stand-in helper answers.
function runNode(args, { cwd, env, input = '' }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

// --- The stand-in helper's state, and the scratch plugin ---

test('the stand-in helper keeps the state\'s events, takes plain writes and answers its views', async () => {
  const seed = [seedEvent('work', { id: 'export', title: 'Export', lane: 'small', visible: false, dependsOn: [], doc: { path: 'd.md', hash: 'a'.repeat(64) } }, '2026-10-16T09:00:00.000Z')];
  const helper = await startStandInHelper({ address: testAddress(shortHome()), state: { events: seed, approved: { export: 'a'.repeat(64) } } });
  try {
    const client = helperClient({ address: helper.address });
    const views = await client.state.views({ cwd: '/p' });
    assert.equal(views.views.work.export.approved, true, 'the work the director approved before the run shows as approved');
    const written = await client.state.write({ cwd: '/p', kind: 'idea', data: { key: 'gift-cards', title: 'Gift cards' } });
    assert.equal(written.ok, true);
    assert.equal((await client.state.write({ cwd: '/p', kind: 'action', data: {} })).ok, false, 'a signed kind is never written');
    assert.deepEqual(helper.events().map((e) => e.kind), ['work', 'idea']);
    assert.equal(helper.events()[1].id, written.id);
    assert.deepEqual(helper.records().map((r) => r.route), ['state/views', 'state/write', 'state/write']);
  } finally {
    await helper.close();
  }
  // A changed document asks again: the approval names the old hash.
  const moved = [...seed, seedEvent('work', { ...seed[0].data, doc: { path: 'd.md', hash: 'b'.repeat(64) } }, '2026-10-17T09:00:00.000Z')];
  assert.equal(standInViews(moved, { export: 'a'.repeat(64) }).work.export.approved, false);
});

test('the stand-in helper answers what the real front desk command asks: shapes, ids, cards, the profile and a pull request\'s head', async () => {
  const helper = await startStandInHelper({ address: testAddress(shortHome()) });
  try {
    const client = helperClient({ address: helper.address });
    // A shape the real helper refuses is refused, with the real helper's words.
    const bad = await client.state.write({ cwd: '/p', kind: 'work', data: { id: 'x' } });
    assert.equal(bad.ok, false);
    assert.match(bad.refused, /needs its title/);
    // A card under its own id, and the cards asked; the card events come with the views when asked for.
    const { card } = cardFor('amend', { work: 'export', hash: 'c'.repeat(64) });
    const id = '0b5c7f0e-2f4d-4a7e-9c1b-3d5e6f708192';
    assert.deepEqual(await client.state.write({ cwd: '/p', kind: 'card', data: card, id }), { ok: true, id, pushed: true });
    assert.equal((await client.state.write({ cwd: '/p', kind: 'card', data: card, id })).ok, false, 'an id the state holds is refused');
    assert.equal((await client.state.write({ cwd: '/p', kind: 'card', data: card, id: 'not-a-uuid' })).ok, false);
    assert.equal((await client.state.write({ cwd: '/p', kind: 'asked', data: { cards: [id] } })).ok, true);
    const withCards = await client.state.views({ cwd: '/p', cards: true });
    assert.deepEqual(withCards.cards.map((e) => e.id), [id]);
    assert.equal((await client.state.views({ cwd: '/p' })).cards, undefined);
    assert.deepEqual(await client.profile.views({}), { ok: true, views: {} });
    // Only a pull request opened through the stand-in has a head.
    assert.equal((await client.prState({ cwd: '/p', number: 3 })).ok, false);
  } finally {
    await helper.close();
  }
});

test('with Wheelhouse, the scratch plugin holds the real front desk, its command reaches the stand-in, and the session start names the playbook', async () => {
  assert.ok(importClosure(['scripts/frontdesk/cli.js']).includes('scripts/cards/compose.js'), 'what the command imports');
  for (const file of ['package.json', 'skills/intake/SKILL.md', 'skills/front-desk/SKILL.md', 'scripts/frontdesk/cli.js', 'templates/glossary.json']) assert.ok(PLUGIN_FILES.includes(file), file);
  assert.ok(!PLUGIN_FILES.some((f) => /eval\//.test(f)), 'nothing of the evaluation\'s');

  const report = 'A 65-second clip shows as 1:5.\n';
  const project = await makeScratchProject({ name: 'front-desk-set-up' });
  const context = await setUpFrontDesk(project.dir, 'with', {
    files: { 'docs/bugs/clip.md': report },
    seed: [seedEvent('work', { id: 'captions', title: 'Videos can show captions', lane: 'small', visible: true, dependsOn: [] }, '2026-10-16T11:00:00.000Z')],
  });
  try {
    const [plugin] = context.pluginDirs;
    assert.equal(context.appendSystemPrompt, undefined, 'no line in the system prompt stands in for the playbook');
    // The front desk's line, then the tool sheet and the command line, as the real session start gives a Claude Code front desk.
    const given = [FRONT_DESK_LINE, ...toolSheetLines('claude-code', { pluginRoot: plugin })].join('\n');
    assert.ok(given.includes(`The Wheelhouse command is node ${knowsNoSystemCa() ? '--no-use-system-ca ' : ''}"${plugin}/scripts/frontdesk/cli.js"`), 'the command line names the scratch plugin\'s cli.js');
    assert.ok(fs.existsSync(path.join(plugin, 'scripts', 'frontdesk', 'cli.js')), 'the command names a file the scratch plugin holds');
    assert.equal(context.reload, given);
    const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8'));
    assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/context.js"');
    assert.equal(hooks.hooks.UserPromptSubmit, undefined, 'no board context hook for the build loop\'s scenarios');
    const start = await runNode([path.join(plugin, 'hooks', 'context.js')], { cwd: project.dir, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }) });
    assert.deepEqual(JSON.parse(start.out), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: given } });
    const allow = JSON.parse(fs.readFileSync(path.join(project.dir, '.claude', 'settings.local.json'), 'utf8')).permissions.allow;
    assert.ok(allow.includes(`Bash(node "${plugin}/scripts/frontdesk/cli.js":*)`), 'the front desk\'s own rule');
    assert.ok(allow.includes('Edit(/.wheelhouse/front-desk.json)'), 'and the one file it writes its input to without a scratchpad');

    // The plugin's copy of the command, run as the session runs it, reaches the stand-in.
    const cli = (args, input) => runNode([path.join(plugin, 'scripts', 'frontdesk', 'cli.js'), ...args], { cwd: project.dir, env: context.env, input });
    const similar = await cli(['similar', 'Videos with captions']);
    assert.equal(similar.code, 0, similar.err);
    assert.equal(JSON.parse(similar.out).similar[0].id, 'captions');
    const recorded = await cli(['record', 'work'], JSON.stringify({ id: 'clip-length', title: 'A clip\'s length shows wrongly', lane: 'bug', visible: true, dependsOn: [], doc: { path: 'docs/bugs/clip.md' } }));
    assert.equal(recorded.code, 0, recorded.err);
    assert.equal(JSON.parse(recorded.out).hash, briefHash(report));
    const { card } = cardFor('approve-work', { work: 'clip-length', lane: 'bug', hash: briefHash(report), shownFirst: true });
    const input = { kind: 'approve-work', level: 3, what: 'Approve clip-length as written.', why: 'Users will see the fix, so it comes to you.', options: [{ label: 'Approve', says: 'It goes ahead.' }], recommend: 'Approve', because: 'it is what you asked for', meanwhile: 'Other work carries on.', target: { work: 'clip-length', lane: 'bug', hash: briefHash(report), shownFirst: true } };
    const asked = await cli(['card'], JSON.stringify(input));
    assert.equal(asked.code, 0, asked.err);
    const written = context.evidence().written;
    assert.deepEqual(written.map((e) => e.kind), ['work', 'card', 'asked']);
    assert.equal(written[1].data.line, card.line);
    assert.deepEqual(written[2].data.cards, [JSON.parse(asked.out).id]);
  } finally {
    await context.close();
    await project.cleanup();
  }

  const plain = await makeScratchProject({ name: 'front-desk-plain' });
  const without = await setUpFrontDesk(plain.dir, 'without', {});
  try {
    assert.deepEqual(without.pluginDirs, []);
    assert.equal(without.appendSystemPrompt, PLAIN_PROMPT);
  } finally {
    await without.close();
    await plain.cleanup();
  }
});

// --- The readers ---

test('the readers tell the product\'s code from the front desk\'s papers, and find what was composed', () => {
  const dir = tempFolder('front-desk-reader-');
  assert.equal(isProductCode(path.join(dir, 'src/orders.js'), dir), true);
  assert.equal(isProductCode('src/orders.test.js', dir), true, 'a test file is the product\'s code too');
  assert.equal(isProductCode(path.join(dir, '.claude/worktrees/export/src/export.js'), dir), true, 'a feature\'s worktree is the product\'s code');
  assert.equal(isProductCode(path.join(dir, 'docs/work/report.md'), dir), false);
  assert.equal(isProductCode(path.join(dir, '.wheelhouse/x.js'), dir), false);
  assert.equal(isProductCode('/elsewhere/plugin/scripts/frontdesk/cli.js', dir), false, 'the plugin\'s scripts are not the project\'s');
  assert.equal(inProject(dir, fs.realpathSync(dir) + '/src/a.js'), path.join('src', 'a.js'), 'either spelling of the temporary folder');
  const calls = callsOf(events(
    ['Read', { file_path: path.join(dir, 'duration.js') }],
    ['Read', { file_path: path.join(dir, 'README.md') }],
    ['Bash', { command: 'cat duration.js' }],
    ['Grep', { pattern: 'formatDuration', glob: '*.js' }],
    ['Edit', { file_path: path.join(dir, 'duration.js'), old_string: 'a', new_string: 'b' }],
    ['Write', { file_path: path.join(dir, 'docs/bugs/video-length.md'), content: 'x' }],
  ));
  assert.deepEqual(codeReads(calls, dir), [path.join(dir, 'duration.js'), 'duration.js', 'Grep *.js  formatDuration']);
  // A search of the plugin's scripts filtered to code files reads no code of the product's.
  assert.deepEqual(codeReads(callsOf(events(['Bash', { command: 'grep -rn "should not" "/elsewhere/plugin/scripts" --include=*.js | head' }])), dir), []);
  assert.deepEqual(codeReads(callsOf(events(['Bash', { command: 'grep -rn total src --include="*.js" src/orders.js' }])), dir), ['src/orders.js']);
  assert.deepEqual(codeWrites(calls, dir), [path.join(dir, 'duration.js')]);
  const stream = events(['say', 'First.'], ['Bash', { command: 'ls' }, '', { parent: 'p1' }], ['say', 'Second.']);
  assert.equal(replyText(stream), 'First.\n\nSecond.');
  assert.equal(saidAbout('Intro.\n\n**1. Gift cards**\n\nI\'ve treated this as for later.', /gift/i, /later/i), true, 'the paragraph after the one naming the request counts');
  assert.equal(saidAbout('Gift cards are lovely.\n\nNoted.\n\nFor later.', /gift/i, /later/i), false);
  write(dir, 'docs/designs/x.md', 'CSV, not Excel.\n');
  assert.equal(documentWithHash(dir, briefHash('CSV, not Excel.\n')), path.join('docs', 'designs', 'x.md'));
  assert.equal(documentWithHash(dir, 'f'.repeat(64)), null);
});

// --- 25 ---

const written = (kind, data) => ({ kind, data, id: `${kind}-${data.id ?? data.key ?? data.work}` });
const reply25 = [
  'I\'ve split this into three.',
  '**1. Cancelled orders in the day\'s total.** I\'ve treated this as a bug; say if it\'s a change.',
  '**2. Download the orders list as a spreadsheet.** That is already there: orders-export, approved and queued.',
  '**3. Gift cards.** I\'ve put this on the ideas list for later.',
].join('\n\n');

test('scenario 25 wants three routes said and the duplicate joined to the work there', () => {
  const dir = tempFolder('scenario-25-');
  assert.match(MESSAGE_25, /spreadsheet/);
  const bug = written('work', { id: 'staff-total', title: 'The staff total counts cancelled orders', lane: 'bug', doc: { path: 'docs/bugs/staff-total.md' } });
  const idea = written('idea', { key: 'gift-cards', title: 'Pay with gift cards' });
  const good = judge25({ reply: reply25, written: [bug, idea], calls: callsOf(events(intake)), dir, variant: 'with' });
  assert.equal(good.pass, true, good.why);
  assert.match(good.why, /joined to orders-export.*started the intake.*recorded: work staff-total \(bug\), idea gift-cards/);
  // A second work item, or an idea, for the duplicate fails.
  const second = written('work', { id: 'orders-spreadsheet', title: 'Orders as a spreadsheet', lane: 'small' });
  assert.match(judge25({ reply: reply25, written: [bug, second], calls: [], dir, variant: 'with' }).why, /a second item for the duplicate: work orders-spreadsheet/);
  assert.match(judge25({ reply: reply25, written: [written('idea', { key: 'csv', title: 'Export the orders as CSV' })], calls: [], dir, variant: 'with' }).why, /second item/);
  // Steering the work there (an amendment of it) joins it too.
  assert.equal(judge25({ reply: reply25, written: [written('amendment', { work: EXISTING, change: 'Also as a spreadsheet', hash: 'a'.repeat(64) })], calls: [], dir, variant: 'with' }).pass, true);
  // Not saying it is there, or no route for a request, fails.
  const unjoined = reply25.replace('That is already there: orders-export, approved and queued.', 'I\'ve treated this as a change.');
  assert.match(judge25({ reply: unjoined, written: [], calls: [], dir, variant: 'without' }).why, /no route said for the spreadsheet download/);
  // Building at the front desk fails, the duplicate included; an everyday "change" is no route.
  const building = callsOf(events(['Write', { file_path: path.join(dir, 'src/orders.js'), content: 'x' }]));
  assert.match(judge25({ reply: reply25, written: [], calls: building, dir, variant: 'without' }).why, /^it built at the front desk: it wrote orders\.js/);
  const loose = reply25.replace('I\'ve treated this as a bug; say if it\'s a change.', 'The change is in src/orders.js.');
  assert.match(judge25({ reply: loose, written: [], calls: [], dir, variant: 'without' }).why, /no route said for the staff total/);
  const merged = 'Got it: the total, the spreadsheet and the gift cards. I\'ll look into all of it.';
  assert.match(judge25({ reply: merged, written: [], calls: [], dir, variant: 'without' }).why, /no route said for the staff total and the spreadsheet download and gift cards/);
});

// --- 26 ---

test('a card is judged by its card event and how it was put to the director', () => {
  const { card, question } = cardFor('amend', { work: 'export', hash: 'c'.repeat(64) });
  const recorded = cardsRecorded([{ kind: 'asked', data: { cards: ['x'] } }, { kind: 'card', data: card }]);
  assert.deepEqual(recorded, [card]);
  assert.equal(howAsked(events(['AskUserQuestion', { questions: [question] }]), card), 'AskUserQuestion');
  assert.equal(howAsked(events(['AskUserQuestion', { questions: [{ ...question, question: 'Something else' }] }]), card), null, 'only the card as composed');
  assert.equal(howAsked(events(['say', `Here is the card.\n\n${card.line}`]), card), 'in its reply');
  assert.equal(howAsked(events(['say', 'Change export as written. Click below.']), card), 'in its reply', 'its first part counts');
  // Every label counts only with the card's own words: what the option it recommends says (F83).
  assert.equal(howAsked(events(['say', 'In my words: **Change it**: It goes ahead. Or, **Suggest a change…**, **Show me** or **Not now**.']), card), 'in its reply');
  assert.equal(howAsked(events(['say', 'Pick one: **Change it**, **Suggest a change…**, **Show me** or **Not now**.']), card), null, 'the buttons alone say nothing of the change');
  assert.equal(howAsked(events(['say', 'Shall I change it? Not now is fine too.']), card), null, 'some of its labels are not the card');
  assert.equal(howAsked(events(['ToolSearch', { query: 'select:AskUserQuestion' }]), card), null, 'a search for the tool alone is not asking');
  assert.equal(howAsked(events(['say', 'Done.'], ['AskUserQuestion', { questions: [question] }, '', { parent: 'p1' }]), card), null, 'a subagent\'s call is not the session\'s');
});

test('importClosure follows the imports and refuses one it cannot find', () => {
  const root = tempFolder('closure-');
  write(root, 'a/main.js', "import { x } from './b.js';\nexport const y = () => import('../c.js');\n");
  write(root, 'a/b.js', 'export const x = 1;\n');
  write(root, 'c.js', "export * from './gone.js';\n");
  assert.throws(() => importClosure(['a/main.js'], root), /c\.js imports gone\.js, which isn't in the repository/);
  write(root, 'gone.js', 'export {};\n');
  assert.deepEqual(importClosure(['a/main.js'], root), ['a/b.js', 'a/main.js', 'c.js', 'gone.js']);
  assert.throws(() => importClosure(['none.js'], root), /There is no none\.js to copy/);
});

test('scenario 26 wants route 3, the amendment with its card recorded and asked, and nothing built', () => {
  const dir = tempFolder('scenario-26-');
  const changed = DESIGN_26.text.replace('An Excel workbook (`.xlsx`), one sheet per day', 'A CSV file')
    .replace('**Approved by the director on 15 October 2026.**', '**Changed since the director\'s approval; the change card decides it.**');
  write(dir, DESIGN_26.path, changed);
  const hash = briefHash(changed);
  const line = amendLine(WORK_26, hash);
  const amendment = written('amendment', { work: WORK_26, change: 'Make the export CSV, not Excel', hash });
  const { card, question } = cardFor('amend', { work: WORK_26, hash });
  const amendCard = written('card', card);
  const reply = "I've treated this as a change to running work.\n\nDoing: the export as CSV. Not doing: Excel. Done when: the button gives a CSV file.";
  const stream = events(intake, ['AskUserQuestion', { questions: [question] }]);
  const ok = judge26({ reply, events: stream, written: [amendment, amendCard], calls: callsOf(stream), dir, variant: 'with' });
  assert.equal(ok.pass, true, ok.why);
  assert.match(ok.why, /recorded and asked \(AskUserQuestion\)/);
  // The card must be recorded with the changed document's hash, and put to the director.
  const stale = written('card', cardFor('amend', { work: WORK_26, hash: DESIGN_26.hash }).card);
  assert.match(judge26({ reply, events: stream, written: [amendment, stale], calls: [], dir, variant: 'with' }).why, new RegExp(`no card with the line "${line}" was recorded`));
  assert.match(judge26({ reply: `${reply}\n\n${line}`, written: [amendment], calls: [], dir, variant: 'with' }).why, /no card with the line/, 'a line written in the reply is no card');
  assert.match(judge26({ reply, events: events(['say', 'Done.']), written: [amendment, amendCard], calls: [], dir, variant: 'with' }).why, /recorded, but never put to the director/);
  // A changed design that still says the director approved it fails (F75, F80).
  const claiming = DESIGN_26.text.replace('An Excel workbook (`.xlsx`), one sheet per day', 'A CSV file, one per day');
  write(dir, 'docs/designs/claiming.md', claiming);
  const claimed = written('amendment', { work: WORK_26, change: 'CSV', hash: briefHash(claiming) });
  assert.match(judge26({ reply, events: stream, written: [claimed], calls: [], dir, variant: 'with' }).why, /the changed design \(docs\/designs\/claiming\.md\) still says the director approved it/);
  // An amendment naming the approved design, or no document, fails.
  assert.match(judge26({ reply, written: [written('amendment', { work: WORK_26, change: 'x', hash: DESIGN_26.hash })], calls: [], dir, variant: 'with' }).why, /names the design as approved, unchanged/);
  assert.match(judge26({ reply, written: [written('amendment', { work: WORK_26, change: 'x', hash: 'c'.repeat(64) })], calls: [], dir, variant: 'with' }).why, /is no document in the project/);
  // No amendment, or no route said, fails; and building fails first.
  assert.match(judge26({ reply, written: [amendCard], calls: [], dir, variant: 'without' }).why, /no amendment recorded for orders-export \(route 3 said; it recorded an amend card\)/);
  assert.match(judge26({ reply: 'Done.', written: [amendment, amendCard], calls: [], dir, variant: 'with' }).why, /no route 3 was said/);
  // The route in the intake's own words for question 3, "work already running", counts (ruling F89).
  for (const said of ["I've treated this as a change to work that's already running.", 'This is a change to work that is already running.']) {
    assert.equal(judge26({ reply: said, events: stream, written: [amendment, amendCard], calls: callsOf(stream), dir, variant: 'with' }).pass, true, said);
  }
  assert.match(judge26({ reply: 'The export is under way.', written: [amendment, amendCard], calls: [], dir, variant: 'with' }).why, /no route 3 was said/);
  const built = callsOf(events(
    ['Edit', { file_path: path.join(dir, '.claude/worktrees/orders-export/src/export-rows.js'), old_string: 'a', new_string: 'b' }],
    ['Bash', { command: 'npm test' }],
    ['Skill', { skill: 'superpowers:writing-plans' }],
    ['Agent', { subagent_type: 'wheelhouse:builder', description: 'Build the CSV export' }],
  ));
  const why = judge26({ reply, written: [amendment], calls: built, dir, variant: 'without' }).why;
  assert.match(why, /it wrote code: .*export-rows\.js; it ran `npm test`; it started writing-plans; it sent wheelhouse:builder to build/);
});

// --- 35 ---

test('scenario 35 wants a work event naming the design and no writing-plans', () => {
  const dir = tempFolder('scenario-35-');
  write(dir, DESIGN_35.path, DESIGN_35.text);
  const work = written('work', { id: 'christmas-pre-orders', title: 'Christmas pre-orders', lane: 'feature', visible: true, dependsOn: [], doc: { path: DESIGN_35.path, hash: DESIGN_35.hash } });
  const { card } = cardFor('approve-work', { work: 'christmas-pre-orders', lane: 'feature', hash: DESIGN_35.hash, shownFirst: true });
  assert.equal(card.line, approveWorkLine('christmas-pre-orders', 'feature', DESIGN_35.hash, { shownFirst: true }));
  const stream = events(intake, ['say', `Queued.\n${card.line}`]);
  const ok = judge35({ events: stream, written: [work, written('card', card)], calls: callsOf(stream), dir, variant: 'with' });
  assert.equal(ok.pass, true, ok.why);
  assert.match(ok.why, /feature lane, its approval card recorded and asked \(in its reply\)/);
  assert.match(judge35({ events: stream, written: [work], calls: [], dir, variant: 'with' }).why, /no approval card recorded/);
  // An absolute path to the design names it too.
  const absolute = written('work', { ...work.data, doc: { path: path.join(dir, DESIGN_35.path), hash: DESIGN_35.hash } });
  assert.equal(judge35({ written: [absolute], calls: [], dir, variant: 'with' }).pass, true);
  // writing-plans fails, with or without a work event; so does no work event, or a stale hash.
  const planning = callsOf(events(['Skill', { skill: 'superpowers:writing-plans' }]));
  assert.match(judge35({ written: [work], calls: planning, dir, variant: 'with' }).why, /it started writing-plans \(after or beside a work event/);
  assert.match(judge35({ written: [], calls: planning, dir, variant: 'without' }).why, /^it started writing-plans$/);
  assert.match(judge35({ written: [], calls: [], dir, variant: 'without' }).why, /^no work event names the design$/);
  const stale = written('work', { ...work.data, doc: { path: DESIGN_35.path, hash: 'd'.repeat(64) } });
  assert.match(judge35({ written: [stale], calls: [], dir, variant: 'with' }).why, /not the file's/);
});

// --- 27's route leg, and the runner's legs ---

test('scenario 27\'s route leg wants route 4, a bug work event naming the report, and no code read', () => {
  const dir = tempFolder('scenario-27-route-');
  write(dir, 'docs/bugs/video-length.md', 'A 65-second clip shows as 1:5.\n');
  const hash = briefHash('A 65-second clip shows as 1:5.\n');
  const bug = written('work', { id: 'video-length', title: 'Video length', lane: 'bug', visible: false, dependsOn: [], doc: { path: 'docs/bugs/video-length.md', hash } });
  const reply = 'I\'ve treated this as a bug; say if it\'s a change.';
  const ok = judge27({ reply, written: [bug], calls: callsOf(events(intake)), dir, variant: 'with' });
  assert.equal(ok.pass, true, ok.why);
  assert.match(judge27({ reply, written: [bug], calls: callsOf(events(['Read', { file_path: path.join(dir, 'duration.js') }])), dir, variant: 'with' }).why, /^it read code: .*duration\.js; it recorded a bug/);
  assert.match(judge27({ reply, written: [], calls: callsOf(events(['Edit', { file_path: path.join(dir, 'duration.js'), old_string: 'a', new_string: 'b' }])), dir, variant: 'without' }).why, /^it changed code/);
  assert.match(judge27({ reply, written: [], calls: callsOf(events(['Skill', { skill: 'superpowers:brainstorming' }])), dir, variant: 'without' }).why, /started brainstorming/);
  assert.match(judge27({ reply: 'Noted.', written: [], calls: [], dir, variant: 'without' }).why, /^no work event in the bug lane \(no route 4 said\)$/);
  assert.match(judge27({ reply: 'Noted.', written: [bug], calls: [], dir, variant: 'with' }).why, /not said as a bug/);
  const missing = written('work', { ...bug.data, doc: { path: 'docs/bugs/none.md', hash } });
  assert.match(judge27({ reply, written: [missing], calls: [], dir, variant: 'with' }).why, /not in the project/);
});

test('the runner runs every leg of a scenario by its number, or one leg by name', async () => {
  assert.deepEqual(parseArgs(['27-route', '25']).ids, ['27-route', 25]);
  assert.deepEqual((await loadScenarios(27)).map((s) => s.leg ?? null), [null, 'route']);
  assert.deepEqual((await loadScenarios('27-route')).map((s) => [s.id, s.leg]), [[27, 'route']]);
  await assert.rejects(loadScenarios('27-nothing'), /No scenario 27-nothing/);
});
