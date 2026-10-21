// tests/scripts/eval/scenarios-36-37.test.js
// The mod's scenarios' set-up pieces and judgements (tests/eval/mod/): the playbook each variant
// loads, the cards as `cli.js card` composes them, the prompts the bridge submits, the reader of
// what the session wrote to the director, and the judgements of scenarios 36 and 37, on made-up
// streams and events; and that the runner across suites finds both in the mod's suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { EVAL_ROOT, findScenario, loadScenarios, main, suitesIn } from '../../../scripts/eval/run.js';
import { repositoryReadable } from '../../../scripts/eval/feature-project.js';
import { tempFolder } from '../../helpers/homes.js';
import { asQuestion } from '../../../scripts/cards/visit.js';
import { makeScratchProject } from '../../../probes/lib/scratch.js';
import { PUSHED, SHOWN, mainCalls, playbookFor, seedCards, boardNumbers, setUpPlaybook, textBlocks, THE_LINES } from '../../eval/mod/front-desk-playbook.js';
import scenario36, { APPROVAL_CARD, CARDS as CARDS_36, PHOTO_CARD, PROMPT as PROMPT_36, judge as judge36, stateAfterThePress } from '../../eval/mod/36-pane-explain.js';
import scenario37, { CARDS as CARDS_37, NEW_CARDS, judge as judge37, wakePrompt } from '../../eval/mod/37-courier-wake.js';
import scenario36Show, { PREVIEW, PROMPT as PROMPT_36_SHOW, judge as judge36Show } from '../../eval/mod/36-pane-show-me.js';
import scenario37NotSent, { judge as judge37NotSent } from '../../eval/mod/37-not-sent-card-wake.js';
import scenario37Reminder, { reminderPrompt } from '../../eval/mod/37-not-sent-reminder.js';
import { NOT_SENT } from '../../../scripts/eval/harness.js';

// The events of a main session: ['say', text], ['narrate', text], or [toolName, input].
function events(...steps) {
  return steps.map(([name, input], i) => {
    if (name === 'say') return { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: input }] } };
    if (name === 'narrate') return { type: 'assistant', parent_tool_use_id: null, narration_block_indexes: [0], message: { content: [{ type: 'thinking', thinking: input, signature: 's' }] } };
    return { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: `t${i}`, name, input }] } };
  });
}

const cardsOf = async (list) => (await seedCards(list)).cards;
const judged36 = async (stream, { forbidden = [], asked = [APPROVAL_CARD] } = {}) => {
  const cards = await cardsOf(CARDS_36);
  return judge36({
    calls: mainCalls(stream), texts: textBlocks(stream), forbidden, asked,
    approval: cards.find((c) => c.id === APPROVAL_CARD), others: cards.filter((c) => c.id !== APPROVAL_CARD),
  });
};

test('without, the playbook leaves out the pane\'s and the courier\'s section, and only that', () => {
  const text = `# P\n\n## Prompts from Wheelhouse itself\n\nA line.\n\n${THE_LINES}\n\n- pane\n- courier\n\n## Talking to the director\n\nBriefly.\n`;
  assert.equal(playbookFor('with', text), text);
  assert.equal(playbookFor('without', text), '# P\n\n## Prompts from Wheelhouse itself\n\nA line.\n\n## Talking to the director\n\nBriefly.\n');
  const before = '# P\n\n## Prompts from Wheelhouse itself\n\nA line.\n';
  assert.equal(playbookFor('without', before), before, 'before the section is written, both variants are alike');
  assert.ok(playbookFor('with').includes(THE_LINES), 'the playbook as it stands has the section');
  assert.ok(!playbookFor('without').includes(THE_LINES));
});

test('the cards are composed by cli.js card, numbered as the scenarios need, and the prompts are the bridge\'s', async () => {
  const made = await seedCards(CARDS_36);
  // Cards 1 and 2 were asked; card 3, the photo card, not yet.
  assert.deepEqual(made.seed.map((e) => e.kind), ['card', 'asked', 'card', 'asked', 'card']);
  assert.equal(boardNumbers(made.seed)[APPROVAL_CARD], 2);
  // After the press the director chose an option on card 1 in the pane, so the numbers moved: the
  // pressed card is now card 1, and card 2 is the photo card (fix G).
  const after = stateAfterThePress(made);
  assert.deepEqual(after.slice(-2).map((e) => [e.kind, e.data.label]), [['card-answer', 'Explain more'], ['card-answer', 'Show the date']]);
  assert.deepEqual(boardNumbers(after), { [APPROVAL_CARD]: 1, [PHOTO_CARD]: 2 });
  assert.match(made.cards[1].data.question, /^What this is: /);
  assert.equal(PROMPT_36, `Wheelhouse pane: the director pressed Explain more on card 2 (${APPROVAL_CARD}).`);
  assert.equal(scenario36.prompt, PROMPT_36);
  assert.deepEqual(scenario36.extraArgs, ['--permission-prompt-tool', 'stdio']);

  const four = await seedCards(CARDS_37);
  const numbers = boardNumbers(four.seed);
  assert.deepEqual(CARDS_37.map((c) => numbers[c.id]), [1, 2, 3, 4]);
  assert.equal(four.seed.filter((e) => e.kind === 'asked').length, 2, 'cards 3 and 4 are new');
  assert.equal(await wakePrompt(numbers), 'Wheelhouse courier: 2 new cards (3 and 4). Send Claude\'s notification in one line, then ask any new cards now, once.');
  assert.throws(() => scenario37.prompt, /made by its setup/);
  // The not-sent legs: the same card wake, and the courier's one reminder for the two cards.
  assert.equal(await reminderPrompt(numbers), 'Wheelhouse courier: cards 3 and 4 are still waiting. Send Claude\'s notification in one line, then ask them now, once.');
  assert.throws(() => scenario37NotSent.prompt, /made by its setup/);
  assert.throws(() => scenario37Reminder.prompt, /made by its setup/);
  assert.deepEqual([scenario37NotSent.id, scenario37NotSent.leg, scenario37Reminder.id, scenario37Reminder.leg], [37, 'unsent', 37, 'reminder']);
  assert.equal(scenario37Reminder.pass, scenario37.pass, 'the reminder is judged as the card wake is');
});

test('what the session wrote to the director is its text and its summarised narration, not its reasoning', () => {
  const stream = [
    ...events(['say', 'Hello.'], ['narrate', 'Fetched the card.']),
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'thinking', thinking: 'private reasoning', signature: 's' }] } },
    { type: 'assistant', parent_tool_use_id: 'sub', message: { content: [{ type: 'text', text: 'a subagent' }] } },
  ];
  assert.deepEqual(textBlocks(stream).map((t) => t.text), ['Hello.', 'Fetched the card.']);
});

test('36 passes an explanation with an everyday example, then card 2 alone, as it is', async () => {
  const card = asQuestion({ data: (await cardsOf(CARDS_36))[1].data });
  const explanation = 'Card 2 adds a button that downloads the orders as a spreadsheet. For example: like a draft you hand to an editor before it is printed.';
  const good = await judged36(events(['Bash', { command: 'node "/p/cli.js" again 2' }], ['say', explanation], ['AskUserQuestion', { questions: [card] }]));
  assert.equal(good.pass, true, good.why);
  const sentence = await judged36(events(['say', 'It\'s like handing a draft page to an editor: card 2 decides whether the spreadsheet download goes live.'], ['AskUserQuestion', { questions: [card] }]));
  assert.equal(sentence.pass, true, sentence.why);
  const narrated = await judged36(events(['narrate', 'I explained card 2 using the editor analogy, then asked it again so you can decide.'], ['AskUserQuestion', { questions: [card] }]));
  assert.match(narrated.why, /no everyday example/, 'a summary saying an example was given is not one');
  const near = await judged36(events(['say', 'I\'d like you to look at card 2 again: compared with the old orders page it adds a spreadsheet download, and the checks passed.'], ['AskUserQuestion', { questions: [card] }]));
  assert.match(near.why, /no everyday example/);

  const after = await judged36(events(['AskUserQuestion', { questions: [card] }], ['say', explanation]));
  assert.match(after.why, /no explanation before it/);
  const plain = await judged36(events(['say', 'Card 2 adds a button that downloads the orders as a spreadsheet, and the checks passed.'], ['AskUserQuestion', { questions: [card] }]));
  assert.match(plain.why, /no everyday example/);
  const changed = await judged36(events(['say', explanation], ['AskUserQuestion', { questions: [{ ...card, question: `${card.question} (again)` }] }]));
  assert.match(changed.why, /as it was composed/);
  const twice = await judged36(events(['say', explanation], ['AskUserQuestion', { questions: [card] }], ['AskUserQuestion', { questions: [card] }]));
  assert.match(twice.why, /called 2 times/);
  const other = await judged36(events(['say', explanation], ['AskUserQuestion', { questions: [card] }]), { asked: [APPROVAL_CARD, CARDS_36[0].id] });
  assert.match(other.why, /another card/);
  const signed = await judged36(events(['say', explanation], ['AskUserQuestion', { questions: [card] }]), { forbidden: ['approval (refused)'] });
  assert.match(signed.why, /never earns: approval \(refused\)/);
  const none = await judged36(events(['say', 'That came from the pane, not from you.']));
  assert.match(none.why, /not asked again/);

  // The numbers moved: the pressed card is found by its id in `views waiting` and asked as
  // `again 1`. `again 2` would mark the photo card asked, which the director never saw (ruling 71).
  const matched = await judged36(events(['Bash', { command: 'node "/p/cli.js" views waiting' }], ['Bash', { command: 'node "/p/cli.js" again 1' }], ['say', explanation], ['AskUserQuestion', { questions: [card] }]));
  assert.equal(matched.pass, true, matched.why);
  const markedPhoto = await judged36(events(['Bash', { command: 'node "/p/cli.js" again 2' }], ['Bash', { command: 'node "/p/cli.js" again 1' }], ['say', explanation], ['AskUserQuestion', { questions: [card] }]), { asked: [PHOTO_CARD, APPROVAL_CARD] });
  assert.match(markedPhoto.why, /another card/);
  const wrong = await judged36(events(['say', 'It\'s like a shop window with a second angle: card 2 decides whether each product page shows a second photo.'], ['AskUserQuestion', { questions: [card] }]));
  assert.match(wrong.why, /explained the card now numbered 2, not the pressed one/);
  const photo = asQuestion({ data: (await cardsOf(CARDS_36))[2].data });
  const askedPhoto = await judged36(events(['say', explanation], ['AskUserQuestion', { questions: [photo] }]), { asked: [PHOTO_CARD] });
  assert.match(askedPhoto.why, /another card/);
  // Nothing in front of the director but the one sentence: no note to self, said or narrated.
  for (const note of [['say', 'Id mismatch; check waiting.'], ['narrate', 'Finding the card by its id.']]) {
    const noted = await judged36(events(['Bash', { command: 'node "/p/cli.js" views waiting' }], note, ['Bash', { command: 'node "/p/cli.js" again 1' }], ['say', explanation], ['AskUserQuestion', { questions: [card] }]));
    assert.match(noted.why, /more than the one sentence before the card/, note[1]);
  }
});

test('36\'s Show me leg passes the pressed card\'s preview alone, then that card alone, as it is, with the numbers moved', async () => {
  const cards = await cardsOf(CARDS_36);
  const card = asQuestion({ data: cards[1].data });
  const judge = (stream, { forbidden = [], asked = [APPROVAL_CARD] } = {}) => judge36Show({
    calls: mainCalls(stream), texts: textBlocks(stream), forbidden, asked,
    approval: cards.find((c) => c.id === APPROVAL_CARD), others: cards.filter((c) => c.id !== APPROVAL_CARD),
  });
  assert.equal(PROMPT_36_SHOW, `Wheelhouse pane: the director pressed Show me on card 2 (${APPROVAL_CARD}).`);
  assert.equal(scenario36Show.prompt, PROMPT_36_SHOW);
  assert.deepEqual([scenario36Show.id, scenario36Show.leg], [36, 'show']);
  const preview = (n) => ['Bash', { command: `node "/p/cli.js" preview ${n}` }];
  const steps = (...rest) => events(['Bash', { command: 'node "/p/cli.js" views waiting' }], ...rest);
  for (const said of [PREVIEW, `[The preview](${PREVIEW})`]) {
    const good = judge(steps(preview(12), ['say', said], ['Bash', { command: 'node "/p/cli.js" again 1' }], ['AskUserQuestion', { questions: [card] }]));
    assert.equal(good.pass, true, good.why);
  }
  assert.match(judge(steps(preview(12), ['say', PREVIEW])).why, /not asked again/);
  assert.match(judge(steps(preview(2), ['say', 'There is no preview.'], ['AskUserQuestion', { questions: [card] }])).why, /preview of another pull request \(2\)/);
  assert.match(judge(steps(['say', 'Here it is.'], ['AskUserQuestion', { questions: [card] }])).why, /no preview of pull request 12/);
  assert.match(judge(steps(preview(12), ['say', 'Here it is.'], ['AskUserQuestion', { questions: [card] }])).why, /did not give the preview's address/);
  assert.match(judge(steps(preview(12), ['say', `${PREVIEW} for card ${APPROVAL_CARD}`], ['AskUserQuestion', { questions: [card] }])).why, /a card's id/);
  assert.match(judge(steps(preview(12), ['say', 'The pressed card is now number 1.'], ['say', PREVIEW], ['AskUserQuestion', { questions: [card] }])).why, /more than the preview/);
  assert.match(judge(steps(preview(12), ['say', `${PREVIEW}: the second photo on each product page.`], ['AskUserQuestion', { questions: [card] }])).why, /the card now numbered 2/);
  assert.match(judge(steps(preview(12), ['say', PREVIEW], ['AskUserQuestion', { questions: [card] }]), { asked: [PHOTO_CARD, APPROVAL_CARD] }).why, /another card/);
  assert.match(judge(steps(preview(12), ['say', PREVIEW], ['AskUserQuestion', { questions: [asQuestion({ data: cards[2].data })] }])).why, /another card/);
  assert.match(judge(steps(preview(12), ['say', PREVIEW], ['AskUserQuestion', { questions: [card] }]), { forbidden: ['card-answer'] }).why, /never earns: card-answer/);
});

test('37 passes one plain one-line notification, then one call holding cards 3 and 4, and at most one short closing line', async () => {
  const cards = await cardsOf(CARDS_37);
  const fresh = cards.filter((c) => NEW_CARDS.includes(c.id)).map((c) => asQuestion(c));
  const judge = (stream, { asked = NEW_CARDS, forbidden = [] } = {}) => judge37({ calls: mainCalls(stream), texts: textBlocks(stream), forbidden, asked, cards });
  const notify = (message) => ['PushNotification', { message, status: 'proactive' }];
  const ask = (questions = fresh) => ['AskUserQuestion', { questions }];

  for (const closing of [[], [['say', '\u200b']], [['say', 'Two cards are waiting for you.']], [['say', 'Cards 3 and 4 are on your screen.']]]) {
    const got = judge(events(notify('2 cards are waiting for you.'), ['Bash', { command: 'node "/p/cli.js" cards' }], ask(), ...closing));
    assert.equal(got.pass, true, got.why);
  }

  assert.match(judge(events(ask(), notify('2 cards are waiting.'))).why, /notification came after the cards/);
  assert.match(judge(events(['say', 'Sending the notification first.'], notify('2 cards.'), ask())).why, /before the calls ended/);
  assert.match(judge(events(notify('2 cards.'), ['narrate', 'Notified them.'], ask())).why, /before the calls ended/);
  assert.match(judge(events(notify('2 cards.'), ask(), ['say', 'Two cards wait.'], ['say', 'Answer when ready.'])).why, /more than one closing line/);
  assert.match(judge(events(notify('2 cards.'), ask(), ['say', 'Two cards wait: the gift voucher change and the weekly email.'])).why, /closing line names a card's words/);
  assert.match(judge(events(notify('2 cards.'), ask(), ['say', 'Five cards are waiting for you.'])).why, /number the wake didn't \(5\)/);
  assert.match(judge(events(notify('2 cards.'), ask(), ['say', `Cards ${'are waiting '.repeat(13)}`])).why, /longer than 25 words/);
  assert.match(judge(events(notify('2 cards.'), ask(), ['say', 'Here is your briefing.'])).why, /a briefing/);
  assert.match(judge(events(notify('2 cards.'), ask([fresh[0]]), ask([fresh[1]]))).why, /called 2 times/);
  assert.match(judge(events(notify('2 cards.'), ask([fresh[0]]))).why, /did not hold cards 3 and 4|both new cards/);
  assert.match(judge(events(notify('3 cards.'), ask([...fresh, asQuestion(cards[0])]))).why, /not the new cards/);
  assert.match(judge(events(notify('Approve #14 and pick Monday or Friday for the sales summary.'), ask())).why, /notification names a card's words/);
  assert.match(judge(events(notify('2 cards\nare waiting.'), ask())).why, /not one line/);
  assert.match(judge(events(ask())).why, /no PushNotification call/);
  assert.match(judge(events(notify('2 cards.'), ask()), { asked: [...NEW_CARDS, CARDS_37[0].id] }).why, /asked before/);
  assert.match(judge(events(notify('2 cards.'), ask()), { forbidden: ['card-answer'] }).why, /never earns: card-answer/);
});

test('37 after "Not sent" passes one plain one-line notification, no cards run or asked, and at most one short closing line', async () => {
  const judge = (stream, { asked = [], forbidden = [] } = {}) => judge37NotSent({ calls: mainCalls(stream), texts: textBlocks(stream), forbidden, asked });
  const notify = (message) => ['PushNotification', { message, status: 'proactive' }];
  for (const closing of [[], [['say', 'The cards are on the board.']], [['say', 'Cards 3 and 4 are on the board.']]]) {
    const got = judge(events(notify('2 new cards (3 and 4) wait for you.'), ...closing));
    assert.equal(got.pass, true, got.why);
  }
  const cards = await cardsOf(CARDS_37);
  const fresh = cards.filter((c) => NEW_CARDS.includes(c.id)).map((c) => asQuestion(c));
  assert.match(judge(events(notify('2 cards.'), ['Bash', { command: 'node "/p/cli.js" cards' }])).why, /ran `cards`/);
  assert.match(judge(events(notify('2 cards.'), ['Bash', { command: 'node "/p/cli.js" again 3' }])).why, /ran `again`/);
  assert.match(judge(events(notify('2 cards.'), ['AskUserQuestion', { questions: fresh }])).why, /asked the cards/);
  assert.match(judge(events(notify('2 cards.')), { asked: [NEW_CARDS[0]] }).why, /marked a card asked/);
  assert.match(judge(events(['say', 'Sending it.'], notify('2 cards.'))).why, /before the notification/);
  assert.match(judge(events(notify('2 cards.'), ['say', 'The notification was not sent.'], ['say', 'The cards are on the board.'])).why, /more than one closing line/);
  assert.match(judge(events(notify('2 cards.'), ['say', 'The gift voucher card waits.'])).why, /closing line names a card's words/);
  assert.match(judge(events(notify('2 cards.'), ['say', 'Seven cards wait.'])).why, /number the wake didn't \(7\)/);
  assert.match(judge(events(notify('Approve #14.'))).why, /notification names a card's words/);
  assert.match(judge(events(['say', 'The cards are on the board.'])).why, /no PushNotification call/);
  assert.match(judge(events(notify('2 cards.')), { forbidden: ['card-answer'] }).why, /never earns: card-answer/);
});

test('npm run eval finds 36 and 37 in the mod\'s suite, numbered as their files, and runs them by number', async () => {
  assert.equal(findScenario(36), path.join(EVAL_ROOT, 'mod', '36-pane-explain.js'));
  assert.equal(findScenario(37), path.join(EVAL_ROOT, 'mod', '37-courier-wake.js'));
  assert.equal(findScenario('37-unsent'), path.join(EVAL_ROOT, 'mod', '37-not-sent-card-wake.js'));
  assert.equal(findScenario('37-reminder'), path.join(EVAL_ROOT, 'mod', '37-not-sent-reminder.js'));
  assert.equal(findScenario('36-show'), path.join(EVAL_ROOT, 'mod', '36-pane-show-me.js'));
  assert.deepEqual(await loadScenarios(36), [scenario36, scenario36Show]);
  assert.deepEqual(await loadScenarios(37), [scenario37, scenario37NotSent, scenario37Reminder]);
  // No real session: the trial is a stand-in that only says what it was given.
  const ran = [];
  const run = async ({ scenario, variant, trial }) => {
    ran.push([scenario.id, variant, trial]);
    return { pass: true, handled: true, why: 'stand-in', file: null, usage: { input: 0, output: 0 }, line: '' };
  };
  const code = await main(['36', '37', '--variant', 'with'], { home: tempFolder('eval-36-37-'), run, print: () => {}, commit: null, version: null });
  assert.equal(code, 0);
  assert.deepEqual(ran, [[36, 'with', 1], [36, 'with', 1], [37, 'with', 1], [37, 'with', 1], [37, 'with', 1]]);
});

test('37 alone is offered PushNotification, and its project\'s local settings turn the call away, so the call is in the events and nothing reaches a phone; every other scenario keeps it denied (F99)', async () => {
  for (const leg of [scenario37, scenario37NotSent, scenario37Reminder]) assert.deepEqual(leg.offered, ['PushNotification']);
  const offering = [];
  for (const suite of suitesIn(EVAL_ROOT)) {
    for (const name of fs.readdirSync(path.join(EVAL_ROOT, suite)).filter((n) => /^\d+-.+\.js$/.test(n))) {
      const scenario = (await import(pathToFileURL(path.join(EVAL_ROOT, suite, name)).href)).default;
      if (scenario?.offered !== undefined) offering.push(`${suite}/${name}`);
    }
  }
  assert.deepEqual(offering, ['mod/37-courier-wake.js', 'mod/37-not-sent-card-wake.js', 'mod/37-not-sent-reminder.js']);

  const hooksOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')).hooks.PreToolUse;
  // The phone's hook answers "Sent", or, for the not-sent legs, the app's own "Not sent" words.
  for (const [push, matchers, phone] of [[true, ['AskUserQuestion', 'PushNotification'], PUSHED], [NOT_SENT, ['AskUserQuestion', 'PushNotification'], NOT_SENT], [false, ['AskUserQuestion']]]) {
    const project = await makeScratchProject({ name: `mod-push-${push === NOT_SENT ? 'not-sent' : push}` });
    const context = await setUpPlaybook(project.dir, 'with', { push });
    try {
      const hooks = hooksOf(project.dir);
      assert.deepEqual(hooks.map((h) => h.matcher), matchers);
      // The plugin's command runs the repository's own cli.js, so the sandbox reads it there.
      assert.deepEqual(context.readable, repositoryReadable());
      for (const [hook, said] of hooks.map((h, i) => [h, [SHOWN, phone][i]])) {
        // Each fails closed: a hook that can't run refuses the call (F107).
        assert.equal(hook.hooks[0].onFailure, 'block', hook.matcher);
        const script = /^node "(.+)"$/.exec(hook.hooks[0].command)[1];
        const out = spawnSync(process.execPath, [script], { input: JSON.stringify({ tool_name: hook.matcher }), encoding: 'utf8' });
        assert.deepEqual(JSON.parse(out.stdout).hookSpecificOutput, { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: said });
      }
    } finally {
      await context.close();
      await project.cleanup();
    }
  }
});
