// tests/skills/front-desk.test.js
// The front desk's playbook, and the intake's use of the same command, pinned against the code:
// the playbook's front matter, the command exactly as its allow rule matches it, only the commands,
// views, record kinds and card kinds the command takes, and each example input accepted as written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, RECORD_KINDS, VIEW_NAMES } from '../../scripts/frontdesk/cli.js';
import { frontDeskCommand, localSettings } from '../../scripts/protection/settings.js';
import { FRONT_DESK_INPUT } from '../../scripts/lib/front-desk.js';
import { FRONT_DESK_LINE } from '../../scripts/hooks/session-start.js';
import { FOREMAN_PROMPT_LEAD } from '../../scripts/foreman/start.js';
import { CARD_KINDS } from '../../scripts/lib/front-desk.js';
import { approvalLine } from '../../scripts/state/card-lines.js';
import { decide as stopGuard } from '../../scripts/hooks/stop-guard.js';
import { words } from '../../scripts/hooks/shell-words.js';
import { setStop } from '../../scripts/lib/stop.js';
import { as, shortHome } from '../helpers/homes.js';
import { main as measures } from '../../scripts/measures/cli.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}';
const PLAYBOOK = 'skills/front-desk/SKILL.md';
const INTAKE = 'skills/intake/SKILL.md';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
const playbook = read(PLAYBOOK);
const intake = read(INTAKE);
const COMMAND = frontDeskCommand('/plugin', { platform: 'linux' });
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
// The baseline's command (scripts/measures/cli.js), which the playbook names beside the front desk's.
const MEASURES = COMMAND.replace('/scripts/frontdesk/cli.js', '/scripts/measures/cli.js');
const MEASURES_LINE = /measures\/cli\.js"? [a-z]+/g;

function frontOf(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${file} starts with front matter`);
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { front, body: m[2] };
}

// The commands a text names as cli.js's, by their first word: `node "<root>/…/cli.js" <word>` and `cli.js <word>`.
// The baseline's command is left out: it is scripts/measures/cli.js's, pinned on its own below.
const commandWords = (text) => [...text.replaceAll(ROOT_VARIABLE, '/plugin').replace(MEASURES_LINE, '').matchAll(/cli\.js"? ([a-z]+)/g)].map((m) => m[1]);

// The subcommands cli.js lists in its own refusal.
async function subcommands() {
  let said = '';
  assert.equal(await main([], { client: {}, out: () => {}, err: (t) => { said += t; } }), 1);
  const m = /^Commands: (.*)$/m.exec(said);
  assert.ok(m, said);
  return m[1].split(',').map((w) => w.trim());
}

// The helper as `card` and `record` ask it: no views to speak of, every write taken, and a pull
// request's head commit.
function helper() {
  const writes = [];
  return {
    writes,
    client: {
      state: {
        views: async () => ({ ok: true, views: { waiting: [], glossary: {} } }),
        write: async (body) => { writes.push(body); return { ok: true, id: body.id ?? `e-${writes.length}`, pushed: true }; },
      },
      prState: async () => ({ ok: true, result: { headSha: HEAD, state: 'open' } }),
    },
  };
}

test('the playbook is named front-desk, is used where the session start points, and knows the foreman\'s wake line', () => {
  const { front, body } = frontOf(playbook, PLAYBOOK);
  assert.equal(front.name, 'front-desk');
  assert.deepEqual(Object.keys(front).sort(), ['description', 'name']);
  assert.match(front.description, /^Use when /);
  assert.ok(front.description.length <= 500, 'a short description');
  // The session start's line names this skill, and the description the words that line begins with.
  assert.ok(FRONT_DESK_LINE.includes(`wheelhouse:${front.name}`));
  assert.ok(front.description.includes(`"${FRONT_DESK_LINE.split('.')[0]}"`), front.description);
  assert.ok(body.startsWith(`<!-- ${PLAYBOOK} -->\n`), 'the path comment follows the front matter');
  assert.ok(body.includes(`"${FOREMAN_PROMPT_LEAD}"`), 'the foreman\'s wake line sets the playbook aside');
  assert.ok(body.includes('wheelhouse:foreman'));
});

test('every command is cli.js exactly as its allow rule matches it', () => {
  const allow = localSettings({ address: '/h/helper.sock', pluginRoot: '/plugin', platform: 'linux' }).permissions.allow;
  assert.ok(allow.includes(`Bash(${COMMAND}:*)`), allow.join(', '));
  // Beside it, the one file the front desk writes its input to without a scratchpad, and no other.
  assert.deepEqual(allow.filter((rule) => rule.startsWith('Edit(')), [`Edit(/${FRONT_DESK_INPUT})`]);
  for (const [file, text] of [[PLAYBOOK, playbook], [INTAKE, intake]]) {
    const nodes = [...text.matchAll(/node "[^"]*"/g)].map((m) => m[0].replaceAll(ROOT_VARIABLE, '/plugin'));
    assert.ok(nodes.length > 0, `${file} names the command`);
    for (const command of nodes) {
      if (file === PLAYBOOK && command === MEASURES) continue;
      assert.equal(command, COMMAND, file);
    }
  }
});

test('the playbook and the intake name only commands, views, record kinds and card kinds the command takes', async () => {
  const known = await subcommands();
  for (const [file, text] of [[PLAYBOOK, playbook], [INTAKE, intake]]) {
    const words = commandWords(text);
    assert.ok(words.length > 0, file);
    for (const word of words) assert.ok(known.includes(word), `${file}: ${word}`);
    for (const m of text.matchAll(/\brecord ([a-z]+)(?= <|`)/g)) assert.ok(RECORD_KINDS.includes(m[1]), `${file}: record ${m[1]}`);
    for (const m of text.matchAll(/`([a-z-]+)` card\b/g)) assert.ok(CARD_KINDS.includes(m[1]), `${file}: ${m[1]} card`);
  }
  // The listed commands are cli.js's own, and the views those `views` takes.
  const listed = /<command>`: (.*?)\. Type/.exec(playbook.replaceAll(ROOT_VARIABLE, '/plugin'))?.[1] ?? '';
  for (const name of known) assert.ok(listed.includes(`\`${name}`), `the playbook lists ${name}`);
  const views = /`views <name>` \(([^)]*)\)/.exec(playbook)?.[1] ?? '';
  assert.deepEqual([...views.matchAll(/`([a-z]+)`/g)].map((m) => m[1]), VIEW_NAMES);
});

test('each example input in the playbook is accepted as written, the approval with its head commit looked up', async () => {
  // The JSON, then the command reading it from the file in the scratchpad (ruling F81).
  const blocks = [...playbook.matchAll(/```\n(\{[^\n]*\})\n```\n\n```\nnode "([^"]*)" ([^\n<]*?) < "<your scratchpad>\/front-desk\.json"\n```/g)];
  assert.ok(blocks.length >= 2, 'a record and a card are shown');
  const seen = [];
  for (const [, input, command, args] of blocks) {
    assert.equal(`node "${command.replaceAll(ROOT_VARIABLE, '/plugin')}"`, COMMAND);
    const h = helper();
    let out = '';
    let err = '';
    const code = await main(args.split(' '), { cwd: '/projects/shop', client: h.client, input, out: (t) => { out += t; }, err: (t) => { err += t; } });
    assert.equal(code, 0, `${args}: ${err}`);
    const answered = JSON.parse(out);
    seen.push(args);
    if (args === 'card') {
      assert.ok(answered.question.question.includes(approvalLine(12, HEAD)), answered.question.question);
      assert.equal(h.writes.filter((w) => w.kind === 'card').length, 1);
    }
    if (args === 'record ruling') assert.equal(answered.card.question.question.split('\n')[0], 'Confirm this?');
  }
  assert.deepEqual(seen.sort(), ['card', 'record ruling']);
});

test('the playbook gives JSON input from a file in the scratchpad, written with the Write tool, never a heredoc or a pipe (F81)', () => {
  // Claude Code 2.1.302 refuses a heredoc holding a brace beside a quote whatever the allow rules
  // say, and asks about a pipe; a file read with `<` runs under the command's allow rule.
  assert.doesNotMatch(playbook, /<<'?EOF/);
  assert.doesNotMatch(intake, /<<'?EOF|as a heredoc/);
  const rule = playbook.split('\n').find((line) => line.startsWith('`card` and `record` read their JSON from a file')) ?? '';
  assert.match(rule, /never a heredoc or a pipe/);
  assert.match(rule, /with the Write tool to `front-desk\.json` in your scratchpad folder/);
  assert.match(rule, /outside the project, so nothing reaches git/);
  assert.match(intake, /JSON input from a file in your scratchpad folder/);
  const commands = [...playbook.matchAll(/^node "[^"]*" (?:card|record [a-z]+)\b.*$/gm)].map((m) => m[0]);
  assert.ok(commands.length >= 3);
  for (const line of commands) assert.ok(line.endsWith(' < "<your scratchpad>/front-desk.json"') || line.endsWith(` < "${FRONT_DESK_INPUT}"`), line);
  // With no scratchpad named, the one file in the project the local settings let it write (F85).
  const fallback = playbook.split('\n').find((line) => line.startsWith('When your system prompt names no scratchpad')) ?? '';
  assert.ok(fallback.includes(`\`${FRONT_DESK_INPUT}\``), fallback);
  assert.match(fallback, /git ignores `\.wheelhouse\/`/);
  assert.match(fallback, /without asking/);
  assert.ok(commands.some((line) => line.endsWith(` < "${FRONT_DESK_INPUT}"`)), 'the fallback is shown');
  // A refused input is written again with the Write tool, never edited in the shell (F86).
  assert.match(playbook, /write the file again with the Write tool, never `sed` or another shell edit/);
});

test('the playbook\'s similar, with the request\'s words as arguments, runs, and runs under STOP', async () => {
  const [, line, rest] = /```\n(node "[^"]*" similar ([^\n]+))\n```/.exec(playbook) ?? [];
  assert.ok(line, 'the playbook shows similar with the request\'s words');
  const command = line.replaceAll(ROOT_VARIABLE, '/plugin');
  assert.ok(command.startsWith(`${COMMAND} similar `));
  const argv = ['similar', ...words(rest, false)];
  let out = '';
  let err = '';
  const code = await main(argv, { cwd: '/projects/shop', client: helper().client, input: '', out: (t) => { out += t; }, err: (t) => { err += t; } });
  assert.equal(code, 0, err);
  assert.ok(Array.isArray(JSON.parse(out).similar));
  // The intake names the same form.
  assert.match(intake, /`cli\.js similar "<[^>]+>"`/);
  await as(shortHome(), async () => {
    setStop({ by: 'prompt' });
    const input = { cwd: '/projects/shop', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } };
    assert.equal(await stopGuard(input, { projectOf: () => ({ project: 'o__p' }), pluginRoot: '/plugin', platform: 'linux' }), undefined);
  });
});

test('the playbook says what to do under STOP, with a card already asked, and with a problem `cards` reports', () => {
  assert.match(playbook, /\*\*STOP:\*\*[^\n]*what was in progress[^\n]*`cards`[^\n]*Lift STOP card/);
  assert.match(playbook, /`alreadyAsked`/);
  assert.match(playbook, /`problems`/);
  assert.match(playbook, /`views glossary`/);
  assert.match(intake, /`cli\.js again <n>`/);
});

test('the playbook looks at the work before it says how things stand or what was in progress', () => {
  // "How's it going?" reads `views work` (or sends the director to the board), and never says
  // nothing is running without having looked; under STOP, what was in progress comes from it too.
  const going = playbook.split('\n').find((line) => line.startsWith('| "How\'s it going?"')) ?? '';
  assert.match(going, /`views work`/);
  assert.match(going, /`\/wheelhouse:board`/);
  assert.match(going, /[Nn]ever say nothing is running/);
  assert.match(playbook, /\*\*STOP:\*\*[^\n]*`views work`/);
});

test('the playbook decides a level 2 question itself, and puts the review before the visit\'s other cards', () => {
  // A question card on a topic at level 2 is decided by its recommendation and told in the briefing,
  // never for a kind a signed click decides, and never when a raising trigger applies.
  const rule = playbook.split('\n').find((line) => line.includes('level 2') && line.includes('`views levels`')) ?? '';
  assert.match(rule, /`question` card/);
  assert.match(rule, /`record decision`/);
  assert.match(rule, /recommend/);
  assert.match(rule, /signed click/);
  for (const trigger of ['ambiguous', 'undone', 'money', 'first of its kind', 'rule', 'rejection', 'any other trigger in design section 6']) assert.ok(rule.includes(trigger), trigger);
  // One call per visit: when the review is due it is this visit's call, before `cards`.
  const review = playbook.split('\n').find((line) => line.includes('`review`') && line.includes('before `cards`')) ?? '';
  assert.match(review, /this visit's call/);
  assert.match(review, /When `review` gave questions/);
  assert.match(review, /gave none, run `cards` as usual/);
  assert.match(playbook, /One call per visit/);
});

test('the intake writes a changed approved document in place and marks it as changed since the approval, never as approved (F75, F80)', () => {
  const rule = intake.split('\n').find((line) => line.includes('**A change to what an approved brief or design builds')) ?? '';
  assert.match(rule, /in place, in the one file the work names/);
  assert.match(rule, /approval line/);
  // The line stays true after the click, since the amendment's hash pins its text (ruling F80).
  assert.ok(rule.includes('"Changed since the director\'s approval; the change card decides it."'), 'the timeless line');
  assert.doesNotMatch(rule, /waits for/);
  assert.match(rule, /stays in git at the hash the approval names/);
  assert.match(rule, /`cli\.js record amendment` \(the work and the change; it works out the changed document's hash and prints it\)/);
  assert.match(rule, /`amend` card/);
  // Nothing holds a build for an amendment waiting for its click (ruling F84).
  assert.match(rule, /its meanwhile says the build keeps to the approved design until the click/);
  // The red flags say the same.
  assert.match(intake, /\n\| "[^"\n]*approval line[^"\n]*" \| Replace it: "Changed since the director's approval; the change card decides it\." \|\n/);
});

test('the intake reads running work back before anything else, in the read-back\'s own words, and its red flags say so (F89)', () => {
  const rule = intake.split('\n').find((line) => line.startsWith('3. **Running work.**')) ?? '';
  // The read-back comes first, word for word, ahead of the changed document and the card.
  assert.match(rule, /First, before you write or record anything for it, read it back in one line, in these words: "Doing: X\. Not doing: Y\. Done when: Z\."/);
  assert.match(rule, /A before and after list, or the route in other words, is not the read-back/);
  assert.match(intake, /\n\| "[^"\n]*read-back[^"\n]*" \| Read it back first: "Doing: X\. Not doing: Y\. Done when: Z\." \|\n/);
});

test('the front desk quotes a ruling in force where it applies it, gives a card as printed when it can\'t load AskUserQuestion, and the intake puts a visible change with a choice in the small lane (scenarios 1, 7 and 10)', () => {
  // Scenario 1: the reply applies the ruling, quoted (the front desk plan's Task 13, Step 1; ruling F93).
  assert.match(playbook, /\*\*A ruling in force\*\*[^\n]*quote it, in its own words, where you apply it/);
  // Scenario 10: a card is never in the session's own words (design 5.3).
  // Only when the tool can't be loaded: a Desktop session whose AskUserQuestion is deferred loads it (ruling F93).
  assert.match(playbook, /When `AskUserQuestion` can't be loaded \(ToolSearch finds none\), put each card in your reply as it was printed, word for word with its set line; never in your own words\./);
  // Scenario 7: a visible change with a choice in it has choices to make (design 7.2); no example mirrors the scenario (ruling F93).
  assert.match(intake, /A change users would see that leaves a choice to make is the small lane at least, never quick\./);
});

test('a musing ends on the one line as it stands, brainstorming sizes a change, and a small removal is not shown first (scenarios 2, 7 and 8)', () => {
  // Scenario 2: the musing's offer is the design's one line (design 5.4).
  assert.match(playbook, /then the one line "Want me to go ahead\?", as it stands\. Nothing is built, paused or recorded/);
  assert.match(intake, /then the one line "Want me to go ahead\?", as it stands\./);
  // Brainstorming shapes and sizes a change and the lane follows (build-loop design, sections 3 and 4, which win over
  // main design 7.1; ruling F92): no line asks for the lane before brainstorming.
  assert.doesNotMatch(intake, /add the lane you expect/);
  // Scenario 8: small removals and obvious fixes are reported after, not shown first (design 7.3).
  assert.match(intake, /A small removal or an obvious fix is not shown first: record it with `visible: false` and ask no card; it is reported after\./);
});

test('the playbook records the private note\'s figures only by the baseline command, which takes its example as written', async () => {
  const [, line, rest] = /```\n(node "[^"]*" baseline ([^\n]+))\n```/.exec(playbook) ?? [];
  assert.ok(line, 'the playbook shows the baseline command');
  assert.ok(line.replaceAll(ROOT_VARIABLE, '/plugin').startsWith(`${MEASURES} baseline `));
  const asked = [];
  const client = { measures: { baseline: async (body) => { asked.push(body); return { ok: true, hash: 'a'.repeat(64), card: { question: 'q' } }; } } };
  let out = '';
  let err = '';
  const code = await measures(['baseline', ...words(rest, false)], { client, out: (t) => { out += t; }, err: (t) => { err += t; } });
  assert.equal(code, 0, err);
  assert.deepEqual(Object.keys(asked[0]).sort(), ['counted', 'from', 'merges', 'to', 'usd']);
  assert.deepEqual(Object.keys(JSON.parse(out)).sort(), ['card', 'hash']);
  // The second step, the card's two options, and where the figures must never go.
  for (const words of ['--confirm <hash>', '**Record these**', '**Not now**', 'Never put the figures anywhere else: not in `record`']) {
    assert.ok(playbook.includes(words), words);
  }
});

test('under a courier\'s wake with no AskUserQuestion, the cards are said to be on the board, not put in the reply (merge review of 63d5ceb)', () => {
  const courier = playbook.split('\n').find((line) => line.startsWith('- **"Wheelhouse courier:"**'));
  assert.ok(courier, 'the courier\'s rule');
  assert.match(courier, /When `AskUserQuestion` can't be loaded on a wake, put no card in your reply: the one sentence says the cards are on the board\./);
});

test('a courier\'s card wake whose notification wasn\'t sent asks nothing, and its reminder asks the cards whatever the notification answers (ruling 68)', () => {
  const courier = playbook.split('\n').find((line) => line.startsWith('- **"Wheelhouse courier:"**'));
  assert.ok(courier, 'the courier\'s rule');
  assert.match(courier, /cards still waiting \(by their numbers\)/);
  assert.match(courier, /When the notification answers that it was not sent \("Not sent …"\) and the wake names new cards but no cards still waiting, STOP or incidents, run no `cards` and ask nothing/);
  assert.match(courier, /When the wake names cards still waiting, that is the courier's one reminder: ask the cards whatever the notification answers\./);
  const row = playbook.split('\n').find((line) => line.startsWith('| "The notification wasn\'t sent'));
  assert.ok(row, 'a red flag for asking anyway');
  assert.match(row, /Ask nothing and end the turn: the courier's reminder asks them later/);
});

test('asked what waits, the front desk names each waiting card in one line by its board number and offers to ask one again, never putting an asked card again unasked (ruling F103; scenario 5)', () => {
  // The plan's call 4: "Not now" keeps a card waiting, and the director asks for it again by its number on the board; design 5.3: each card asked once.
  const row = playbook.split('\n').find((line) => line.startsWith('| "Anything waiting on me?"'));
  assert.ok(row, 'a row for what waits');
  assert.match(row, /`views waiting`/);
  // Ruling F104: the line may read as `views waiting` lists the card; it is not asking it again.
  assert.match(row, /name each waiting card in one line, as it lists it \(its number on the board, its question and its choice\)/);
  assert.doesNotMatch(row, /words of your own/);
  // `views waiting` names each card's id too, for matching a press; the director isn't given it (fix G).
  assert.match(row, /but without its id/);
  assert.match(row, /`again <n>`/);
  assert.match(row, /Never put a card already asked to them again unless they ask for that card/);
});

test('a press of Why? finds the pressed card by its id in views waiting, asks it with again, and says only the one sentence (fix G, ruling 71)', () => {
  const lines = playbook.split('\n');
  const press = lines.find((line) => line.startsWith('  - **"pressed Why? on card n (id)"**')) ?? '';
  assert.ok(press, 'the press\'s rule');
  // First `views waiting`, read-only, for the pressed card's number now; then `again` that number.
  assert.match(press, /In this order: first `views waiting`, which names each card's id: the card with the prompt's id is the pressed one, and its number there is the one to use, since the numbers move as cards close; that it moved is not news for the director\./);
  assert.ok(lines.some((line) => line.startsWith('| "I\'ll tell them the pressed card is now number 1" | Say nothing of its number: only the one sentence, or Show me\'s link')), 'a red flag for telling them the number moved');
  assert.match(press, /When no card has that id, it no longer waits: say so in one line and ask nothing\./);
  assert.match(press, /Then `again <its number now>`/);
  assert.ok(press.indexOf('`views waiting`') < press.indexOf('`again <its number now>`'), 'views waiting before again');
  assert.ok(press.indexOf('`again <its number now>`') < press.indexOf('`explain <term>`'), 'again before explain');
  // The one sentence, with the AskUserQuestion call, and nothing else in front of the director.
  assert.match(press, /one sentence to the director, at most 30 words, in the message with the `AskUserQuestion` call, before it/);
  assert.match(press, /Only that one sentence: Claude shows longer text before a card only as a summary\./);
  assert.match(press, /^  - \*\*"pressed Why\? on card n \(id\)"\*\* \(only a card that failed the check sends it\): write no text until the one sentence below, not even a note to yourself\./);
  assert.match(press, /Never a card's id\./);
  assert.doesNotMatch(press, /in the same message as the `again <n>` call|first `again <n>`/);
  // Card ids never reach the director.
  const chat = lines.find((line) => line.startsWith('- **An answer in the chat:**')) ?? '';
  assert.ok(chat, 'a line for an answer in the chat');
  assert.match(chat, /say only what `views waiting` shows of it, without its id, never a guess that the answer wasn't recorded/);
  const chose = lines.find((line) => line.startsWith('  - **"chose "<option>" on card n (id)"**')) ?? '';
  assert.match(chose, /say so in one line, without its id,/);
  // The red flag.
  const row = lines.find((line) => line.startsWith('| "I know which card n is"')) ?? '';
  assert.ok(row, 'a red flag for guessing card n');
  assert.match(row, /Find the prompt's id in `views waiting` first, and `again` the number it has there/);
});

test('a press of Show me and a choice in the pane find the card by its id in views waiting, as Why? does (final fix wave)', () => {
  const lines = playbook.split('\n');
  // Show me: the pressed card's number now, by the prompt's id, then Show me for it and `again` that number.
  const show = lines.find((line) => line.startsWith('  - **"pressed Show me on card n (id)"**')) ?? '';
  assert.ok(show, 'the Show me press\'s rule');
  assert.match(show, /^  - \*\*"pressed Show me on card n \(id\)"\*\*: write no text until the preview's link, not even a note to yourself such as the card's number now or the pull request it names: the director sees every line\./);
  assert.match(show, /First `views waiting`: the card with the prompt's id is the pressed one, and its number there is the one to use, since the numbers move as cards close; that it moved is not news for the director\./);
  assert.match(show, /When no card has that id, it no longer waits: say so in one line and ask nothing\./);
  // The preview is the pull request's the card names, never the card's own number.
  assert.match(show, /Then `preview` with the number of the pull request that card names, never the card's number, and its address as a link, alone; when there is none, as Cards says\. Then `again <its number now>`, and `AskUserQuestion` with what it gave, alone\./);
  assert.match(show, /Never a card's id\./);
  assert.ok(show.indexOf('`views waiting`') < show.indexOf('`again <its number now>`'), 'views waiting before again');
  assert.doesNotMatch(show, /`again <n>`|Show me for card n/);
  // A choice: still waiting by the prompt's id, not by the number or the words.
  const chose = lines.find((line) => line.startsWith('  - **"chose "<option>" on card n (id)"**')) ?? '';
  assert.ok(chose, 'the choice\'s rule');
  assert.match(chose, /Run `views waiting`: if a card with the prompt's id is still there, the choice wasn't noted; say so in one line, without its id, and don't act on it\./);
  assert.doesNotMatch(chose, /card n is still there|with the words you asked it with/);
  // The red flag for a note between the calls (scenario 36's Show me leg wrote one each time).
  const note = lines.find((line) => line.startsWith('| "I\'ll say the card is now number 1 and names pull request #12"')) ?? '';
  assert.match(note, /Write nothing: every line reaches the director\. Run `preview` straight after `views waiting`/);
  // The red flag.
  const row = lines.find((line) => line.startsWith('| "Show me is for card n, as the prompt numbers it"')) ?? '';
  assert.ok(row, 'a red flag for showing card n by its number');
  assert.match(row, /Find the prompt's id in `views waiting` first: show and ask the card with that id, by its number there/);
});

test('the playbooks point at Why? and Suggest a change…, and none offers Explain more as an option (Task 19)', () => {
  const lines = playbook.split('\n');
  // Asked why: `why <n>`, the plain words, an everyday example, then the card again; a failed `why` stops nothing.
  const asked = lines.find((line) => line.startsWith('- **Asked why**')) ?? '';
  assert.ok(asked, 'the Asked why line');
  assert.match(asked, /^- \*\*Asked why\*\* about a card: run `why <n>`, give the plain words \(`explain <term>`\) and an everyday example, then as for a press of Why\?, from `again <n>`\./);
  assert.match(asked, /If `why` fails, go on explaining anyway: the Why\? is for learning only\./);
  // The pane's suggestion steers and never approves.
  const press = lines.find((line) => line.startsWith('  - **"pressed Why? on card n (id)"**')) ?? '';
  assert.match(press, /\(only a card that failed the check sends it\)/);
  const suggested = lines.find((line) => line.startsWith('  - **"suggested a change on card n (id): <words>"**')) ?? '';
  assert.ok(suggested, 'the suggestion\'s rule');
  assert.match(suggested, /the words steer and never approve\./);
  assert.match(suggested, /Find the card by its id in `views waiting`\. For an approval or ci-push card the code must change first: run `record work` as `wheelhouse:intake`'s order does \(the card's work, its `place`\), with the change in your own words, never theirs; no read-back, no card\./);
  assert.match(suggested, /The revised card, with `revises` \(the old card's id\) and `changed` \(one sentence in your own words\), comes once the pull request's head has moved, on a later visit\. For any other kind, revise the proposal as the words ask and compose the new card at once\./);
  assert.match(suggested, /Ask no card now, and never the old one again\. Say only: "Noted\. A new proposal will follow\."/);
  // A pick of Suggest a change… in the chat.
  const pick = lines.find((line) => line.includes('Suggest a change…') && line.startsWith('- **')) ?? '';
  assert.match(pick, /Ask "What would you change\?" in one line, then do as for the pane's suggestion\./);
  // Setup, the foreman and the brief.
  assert.match(read('skills/setup/SKILL.md'), /^- \*\*Asked why:\*\* plain words and an everyday example, then ask the same card again\.$/m);
  assert.match(read('skills/foreman/SKILL.md'), /none called Not now, Why\?, Show me or Suggest a change…/);
  assert.match(read('templates/brief/brief.md'), /an option called Not now, Why\?, Show me or Suggest a change…/);
  for (const file of ['skills/front-desk/SKILL.md', 'skills/setup/SKILL.md', 'skills/foreman/SKILL.md', 'templates/brief/brief.md']) {
    assert.doesNotMatch(read(file), /Explain more/, `${file} offers no Explain more`);
  }
});
