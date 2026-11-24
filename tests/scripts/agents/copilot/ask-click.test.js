// tests/scripts/agents/copilot/ask-click.test.js
// Reading Copilot's question card and the answer that came back (scripts/agents/copilot/ask-click.js), and the hook entry's
// recording of it (hook-click.js, wired in hook-entry.js). The inputs are written from the shapes in docs/checks/59 and
// docs/checks/97, since no raw capture was kept (the laptop re-check of check 59 replaces them); `choices` stands in
// for the CLI's `requestedSchema`, which the notes name but do not quote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { askOf, answerOf, labelsIn, AUTO_TELL, AUTO_LINE, CLOSED_LINE, VSCODE_ASK } from '../../../../scripts/agents/copilot/ask-click.js';
import { runEntry } from '../../../../scripts/agents/copilot/hook-entry.js';

const PROJECT = '/work/shop';
const MESSAGE = 'Approve this test?';
const OPTIONS = ['Approve', 'Not now'];

// The CLI harness (check 59): the answer is only text.
const cli = (text, { resultType = 'success', args = {} } = {}) => ({
  tool_name: 'ask_user', session_id: 's1', cwd: PROJECT,
  tool_input: { message: MESSAGE, choices: OPTIONS, ...args },
  tool_response: { resultType, textResultForLlm: text },
});
// VS Code's chat (check 59): the response is a JSON string keyed by the question's header.
const vscode = (answer, { question = {} } = {}) => ({
  tool_name: VSCODE_ASK, session_id: 's1', cwd: PROJECT,
  tool_input: { questions: [{ header: MESSAGE, question: MESSAGE, options: OPTIONS.map((label) => ({ label, description: label, recommended: false })), allowFreeformInput: false, ...question }] },
  tool_response: JSON.stringify({ answers: { [MESSAGE]: answer } }),
});

test('a click is an answer naming one of the card\'s own options, in both shapes', () => {
  assert.deepEqual(answerOf(cli('User responded: Approve')), { kind: 'click', label: 'Approve' });
  assert.deepEqual(answerOf(vscode({ selected: ['Not now'], freeText: null, skipped: false })), { kind: 'click', label: 'Not now' });
  assert.deepEqual(askOf(cli('x')), { message: MESSAGE, options: OPTIONS });
  const schema = { tool_name: 'ask_user', tool_input: { message: MESSAGE, requestedSchema: { properties: { choice: { enum: OPTIONS, default: 'Approve' } } } } };
  assert.deepEqual(askOf(schema).options, OPTIONS);
  const oneOf = { tool_name: 'ask_user', tool_input: { message: MESSAGE, requestedSchema: { properties: { choice: { oneOf: OPTIONS.map((c) => ({ const: c, title: c })) } } } } };
  assert.deepEqual(askOf(oneOf).options, OPTIONS);
});

test('free text is not a click, on a binding card', () => {
  assert.equal(answerOf(cli('User responded: Approve, but only the first half')).kind, 'none');
  assert.equal(answerOf(cli('User responded: approve')).kind, 'none');
  assert.equal(answerOf(vscode({ selected: ['Approve'], freeText: 'and also this', skipped: false })).kind, 'none');
  // Words typed with no option chosen are the person's own, not Autopilot's.
  assert.equal(answerOf(vscode({ selected: [], freeText: 'something else', skipped: false })).kind, 'none');
  assert.equal(answerOf(vscode({ selected: ['Elsewhere'], freeText: null, skipped: false })).kind, 'none');
  assert.equal(answerOf(vscode({ selected: ['Approve', 'Not now'], freeText: null, skipped: false })).kind, 'none');
  // A card that allows typed answers takes none as a click: a typed label looks like a click (check 59).
  assert.equal(answerOf(vscode({ selected: ['Approve'], freeText: null, skipped: false }, { question: { allowFreeformInput: true } })).kind, 'none');
});

test('Autopilot\'s answers are not clicks: "not available" and an empty selection with its words', () => {
  // Check 59 (CLI, chat.autoReply) and check 97 (Autopilot).
  const sentence = 'User responded: The user is not available to answer your question. Choose a pragmatic option best aligned with the context of the request.';
  assert.equal(answerOf(cli(sentence)).kind, 'auto');
  // VS Code's own auto-answer: no option, not skipped, with the auto-reply words.
  const auto = { selected: [], freeText: 'The user is not available to respond and will review your work later. Work autonomously and make good decisions.', skipped: false };
  assert.equal(answerOf(vscode(auto)).kind, 'auto');
  assert.equal(answerOf(vscode({ selected: [], freeText: null, skipped: false })).kind, 'auto');
  // Nothing else is a click: an error result, an unreadable response, another tool.
  assert.equal(answerOf(cli('User responded: Approve', { resultType: 'failure' })).kind, 'none');
  assert.equal(answerOf({ ...vscode({ selected: ['Approve'] }), tool_response: '{not json' }).kind, 'none');
  assert.equal(answerOf({ tool_name: 'bash', tool_input: { command: 'ls' }, tool_response: { textResultForLlm: 'User responded: Approve' } }).kind, 'none');
  assert.equal(answerOf({ ...cli('User responded: Approve'), tool_input: { message: MESSAGE } }).kind, 'none');
});

test('a card the person closed is no click and not Autopilot, in both shapes', () => {
  // Check 59: closing the CLI card came back "User cancelled the request."; VS Code marks it skipped.
  assert.deepEqual(answerOf(cli('User cancelled the request.')), { kind: 'closed' });
  assert.deepEqual(answerOf(vscode({ selected: [], freeText: null, skipped: true })), { kind: 'closed' });
  assert.ok(!CLOSED_LINE.includes('\n'));
});

test('the labels are read from the CLI\'s requestedSchema as well as from choices', () => {
  assert.deepEqual(labelsIn({ requestedSchema: { properties: { choice: { enum: OPTIONS } } } }), OPTIONS);
  assert.deepEqual(labelsIn({ choices: [{ label: 'Approve' }, 'Not now'] }), OPTIONS);
  assert.deepEqual(labelsIn({}), []);
});

// The entry: a fake helper client records what it is asked.
function world({ first = true } = {}) {
  const posts = [];
  const post = (name) => async (body) => { posts.push([name, body]); return name === 'hookAuto' ? { ok: true, first } : { ok: true }; };
  const client = { health: async () => ({ ok: true }), session: { mark: async () => ({ ok: true }) }, cards: { hookShown: post('hookShown'), hookClick: post('hookClick'), hookAuto: post('hookAuto') } };
  return { posts, client };
}
const raw = (toolResult) => ({ sessionId: 's1', timestamp: 0, cwd: PROJECT, toolName: 'ask_user', toolArgs: { message: MESSAGE, choices: OPTIONS }, ...(toolResult === undefined ? {} : { toolResult }) });
const entry = (event, input, { client, c6 = true, steps = {} } = {}) => runEntry(event, {
  stdin: Readable.from([JSON.stringify(input)]),
  env: { COPILOT_CLI_BINARY_VERSION: '1.0.105' },
  deps: { client, c6, steps: { stopGuard: async () => undefined, lineageHold: async () => undefined, cardCheck: async () => undefined, featureStatus: async () => undefined, ...steps }, projectOf: () => ({ project: 'shop' }), dir: '/nowhere' },
});

test('the entry posts the card as shown when it is asked, and the click when it comes back, with the session', async () => {
  const w = world();
  await entry('preToolUse', raw(), w);
  assert.deepEqual(w.posts, [['hookShown', { cwd: PROJECT, session: 's1', message: MESSAGE, options: OPTIONS }]]);
  const back = await entry('postToolUse', raw({ resultType: 'success', textResultForLlm: 'User responded: Approve' }), w);
  assert.equal(back.text, '');
  assert.deepEqual(w.posts.at(-1), ['hookClick', { cwd: PROJECT, session: 's1', message: MESSAGE, options: OPTIONS, label: 'Approve' }]);
});

test('a card the guards refuse is not posted as shown, and nothing is recorded before check C6 passes', async () => {
  const refused = world();
  const out = await entry('preToolUse', raw(), { ...refused, steps: { cardCheck: async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } }) } });
  assert.equal(out.code, 2);
  assert.deepEqual(refused.posts, []);
  const early = world();
  await entry('preToolUse', raw(), { ...early, c6: false });
  await entry('postToolUse', raw({ resultType: 'success', textResultForLlm: 'User responded: Approve' }), { ...early, c6: false });
  assert.deepEqual(early.posts, []);
});

test('an answer that is no click posts no click', async () => {
  const w = world();
  for (const text of ['User responded: Approve, and more', 'User responded: Elsewhere']) await entry('postToolUse', raw({ resultType: 'success', textResultForLlm: text }), w);
  assert.deepEqual(w.posts, []);
});

test('the first auto-answer in a session tells the First Mate to stop and say one line; later ones add nothing', async () => {
  const sentence = 'User responded: The user is not available to answer your question. Choose a pragmatic option best aligned with the context of the request.';
  const first = world({ first: true });
  const told = await entry('postToolUse', raw({ resultType: 'success', textResultForLlm: sentence }), first);
  assert.deepEqual(first.posts, [['hookAuto', { cwd: PROJECT, session: 's1' }]]);
  assert.match(told.text, /Autopilot is answering your cards for you; switch it off/);
  assert.ok(AUTO_TELL.includes(AUTO_LINE));
  assert.equal(JSON.parse(told.text).additionalContext?.includes(AUTO_LINE) ?? JSON.stringify(JSON.parse(told.text)).includes(AUTO_LINE), true);
  const later = world({ first: false });
  assert.equal((await entry('postToolUse', raw({ resultType: 'success', textResultForLlm: sentence }), later)).text, '');
});

test('a closed card posts nothing and gives the First Mate one line, not the Autopilot stop', async () => {
  const w = world();
  const told = await entry('postToolUse', raw({ resultType: 'success', textResultForLlm: 'User cancelled the request.' }), w);
  assert.deepEqual(w.posts, []);
  const context = JSON.parse(told.text).hookSpecificOutput?.additionalContext ?? JSON.parse(told.text).additionalContext;
  assert.equal(context, CLOSED_LINE);
  assert.ok(!told.text.includes(AUTO_LINE));
});

test('the guards see the options the CLI\'s requestedSchema offers', async () => {
  const w = world();
  let seen;
  const schemaRaw = { ...raw(), toolArgs: { message: MESSAGE, requestedSchema: { properties: { choice: { enum: OPTIONS, default: 'Approve' } } } } };
  await entry('preToolUse', schemaRaw, { ...w, steps: { cardCheck: async (input) => { seen = input; return undefined; } } });
  assert.deepEqual(seen?.tool_input?.questions?.[0]?.options, OPTIONS.map((label) => ({ label })));
  assert.deepEqual(w.posts, [['hookShown', { cwd: PROJECT, session: 's1', message: MESSAGE, options: OPTIONS }]]);
});
