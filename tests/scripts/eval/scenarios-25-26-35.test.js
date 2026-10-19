// tests/scripts/eval/scenarios-25-26-35.test.js
// The front desk scenarios' set-up pieces and judgements: the stand-in helper's state, the
// stand-in front desk command, the readers, and the judgements of scenarios 25, 26, 35 and
// 27's route leg, on made-up streams and events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callsOf } from '../../../scripts/eval/feature-project.js';
import { main as command, viewLines } from '../../../scripts/eval/front-desk-command.js';
import {
  briefHash, codeReads, codeWrites, composedText, documentWithHash, inProject, isProductCode, replyText, saidAbout, seedEvent,
} from '../../../scripts/eval/front-desk.js';
import { parseArgs } from '../../../scripts/eval/harness.js';
import { loadScenarios } from '../../../scripts/eval/run.js';
import { standInViews, startStandInHelper } from '../../../scripts/eval/stand-in-helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { amendLine, approveWorkLine } from '../../../scripts/state/card-lines.js';
import { EXISTING, MESSAGE as MESSAGE_25, judge as judge25 } from '../../eval/build-loop/25-split-and-duplicate.js';
import { DESIGN as DESIGN_26, WORK as WORK_26, judge as judge26 } from '../../eval/build-loop/26-steering.js';
import { judge as judge27 } from '../../eval/build-loop/27-front-desk-route.js';
import { DESIGN as DESIGN_35, judge as judge35 } from '../../eval/build-loop/35-design-to-queue.js';
import { shortHome, tempFolder, testAddress, withHome } from '../../helpers/homes.js';

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

// --- The stand-in helper's state and the stand-in command ---

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

test('the stand-in front desk command checks the duplicate, shows the views, records and hashes', async () => {
  const helper = await startStandInHelper({
    address: testAddress(shortHome()),
    state: {
      events: [
        seedEvent('work', { id: 'orders-export', title: 'Staff can download the orders list as a CSV file', lane: 'small', visible: true, dependsOn: [] }, '2026-10-16T09:00:00.000Z'),
        seedEvent('rejection', { key: 'sms', title: 'Text reminders', reason: 'too costly' }, '2026-09-30T09:00:00.000Z'),
      ],
    },
  });
  const dir = tempFolder('front-desk-command-');
  write(dir, 'docs/report.md', 'A 65-second clip shows as 1:5.\n');
  try {
    const client = helperClient({ address: helper.address });
    const said = async (...argv) => {
      let out = '';
      let err = '';
      const code = await withHome(() => command(argv, { client, cwd: dir, stdin: null, out: (t) => { out += t; }, err: (t) => { err += t; } }));
      return { code, out, err };
    };
    assert.match((await said('similar', 'download the orders list as a spreadsheet')).out, /^- work orders-export \(score 0\.\d\d\): Staff can download/);
    assert.match((await said('similar', 'zebra crossings')).out, /Nothing in open work/);
    const views = (await said('views')).out;
    assert.match(views, /- orders-export: Staff can download the orders list as a CSV file\. small lane; not approved; queued, not started/);
    assert.match(views, /- sms: Text reminders \(turned down 30 September 2026: too costly\)/);
    assert.equal((await said('views', 'nonsense')).code, 2);
    const refused = await said('record', 'work', '{"id":"x"}');
    assert.equal(refused.code, 1);
    assert.match(refused.err, /needs its title/);
    const hash = (await said('hash', 'docs/report.md')).out.trim();
    assert.equal(hash, briefHash('A 65-second clip shows as 1:5.\n'));
    const data = { id: 'video-length', title: 'A video\'s length shows wrongly', lane: 'bug', visible: false, dependsOn: [], doc: { path: 'docs/report.md', hash } };
    const recorded = await said('record', 'work', JSON.stringify(data));
    assert.equal(recorded.code, 0, recorded.err);
    assert.match(recorded.out, /^Recorded work [0-9a-f-]{36}\.$/m);
    assert.deepEqual(helper.events().at(-1).data, data);
    assert.match((await said()).out, /What a record carries/);
  } finally {
    await helper.close();
  }
  assert.deepEqual(viewLines({}, 'ideas'), ['Ideas:', '  (none)']);
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
  assert.deepEqual(codeWrites(calls, dir), [path.join(dir, 'duration.js')]);
  const stream = events(['say', 'First.'], ['AskUserQuestion', { questions: [{ question: 'Change the approved x to this, abc' }] }], ['say', 'Second.'], ['Bash', { command: 'ls' }, '', { parent: 'p1' }]);
  assert.equal(replyText(stream), 'First.\n\nSecond.');
  assert.match(composedText(stream), /Change the approved x to this, abc/);
  assert.doesNotMatch(composedText(stream), /\bls\b/, 'a subagent\'s calls are not the session\'s');
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

test('scenario 26 wants route 3, the amendment with its card line, and nothing built', () => {
  const dir = tempFolder('scenario-26-');
  const changed = DESIGN_26.text.replace('An Excel workbook (`.xlsx`), one sheet per day', 'A CSV file');
  write(dir, DESIGN_26.path, changed);
  const hash = briefHash(changed);
  const line = amendLine(WORK_26, hash);
  const amendment = written('amendment', { work: WORK_26, change: 'Make the export CSV, not Excel', hash });
  const reply = `I've treated this as a change to running work.\n\nDoing: the export as CSV. Not doing: Excel. Done when: the button gives a CSV file.\n\n${line}`;
  const ok = judge26({ reply, composed: reply, written: [amendment], calls: callsOf(events(intake)), dir, variant: 'with' });
  assert.equal(ok.pass, true, ok.why);
  // The card line must be word for word, with the changed document's hash.
  assert.match(judge26({ reply, composed: reply.replace(line, amendLine(WORK_26, DESIGN_26.hash)), written: [amendment], calls: [], dir, variant: 'with' }).why, /card line .* is not in what it composed/);
  // An amendment naming the approved design, or no document, fails.
  assert.match(judge26({ reply, composed: reply, written: [written('amendment', { work: WORK_26, change: 'x', hash: DESIGN_26.hash })], calls: [], dir, variant: 'with' }).why, /names the design as approved, unchanged/);
  assert.match(judge26({ reply, composed: reply, written: [written('amendment', { work: WORK_26, change: 'x', hash: 'c'.repeat(64) })], calls: [], dir, variant: 'with' }).why, /is no document in the project/);
  // No amendment, or no route said, fails; and building fails first.
  assert.match(judge26({ reply, composed: reply, written: [], calls: [], dir, variant: 'without' }).why, /no amendment recorded for orders-export \(route 3 said; it wrote an amend line\)/);
  assert.match(judge26({ reply: 'Done.', composed: 'Done.', written: [amendment], calls: [], dir, variant: 'with' }).why, /no route 3 was said/);
  const built = callsOf(events(
    ['Edit', { file_path: path.join(dir, '.claude/worktrees/orders-export/src/export-rows.js'), old_string: 'a', new_string: 'b' }],
    ['Bash', { command: 'npm test' }],
    ['Skill', { skill: 'superpowers:writing-plans' }],
    ['Agent', { subagent_type: 'wheelhouse:builder', description: 'Build the CSV export' }],
  ));
  const why = judge26({ reply, composed: reply, written: [amendment], calls: built, dir, variant: 'without' }).why;
  assert.match(why, /it wrote code: .*export-rows\.js; it ran `npm test`; it started writing-plans; it sent wheelhouse:builder to build/);
});

// --- 35 ---

test('scenario 35 wants a work event naming the design and no writing-plans', () => {
  const dir = tempFolder('scenario-35-');
  write(dir, DESIGN_35.path, DESIGN_35.text);
  const work = written('work', { id: 'christmas-pre-orders', title: 'Christmas pre-orders', lane: 'feature', visible: true, dependsOn: [], doc: { path: DESIGN_35.path, hash: DESIGN_35.hash } });
  const card = approveWorkLine('christmas-pre-orders', 'feature', DESIGN_35.hash, { shownFirst: true });
  const ok = judge35({ composed: `Queued.\n${card}`, written: [work], calls: callsOf(events(intake)), dir, variant: 'with' });
  assert.equal(ok.pass, true, ok.why);
  assert.match(ok.why, /feature lane, with its approval card line/);
  // An absolute path to the design names it too.
  const absolute = written('work', { ...work.data, doc: { path: path.join(dir, DESIGN_35.path), hash: DESIGN_35.hash } });
  assert.equal(judge35({ composed: '', written: [absolute], calls: [], dir, variant: 'with' }).pass, true);
  // writing-plans fails, with or without a work event; so does no work event, or a stale hash.
  const planning = callsOf(events(['Skill', { skill: 'superpowers:writing-plans' }]));
  assert.match(judge35({ composed: '', written: [work], calls: planning, dir, variant: 'with' }).why, /it started writing-plans \(after or beside a work event/);
  assert.match(judge35({ composed: '', written: [], calls: planning, dir, variant: 'without' }).why, /^it started writing-plans$/);
  assert.match(judge35({ composed: '', written: [], calls: [], dir, variant: 'without' }).why, /^no work event names the design$/);
  const stale = written('work', { ...work.data, doc: { path: DESIGN_35.path, hash: 'd'.repeat(64) } });
  assert.match(judge35({ composed: '', written: [stale], calls: [], dir, variant: 'with' }).why, /not the file's/);
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
