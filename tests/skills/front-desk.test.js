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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}';
const PLAYBOOK = 'skills/front-desk/SKILL.md';
const INTAKE = 'skills/intake/SKILL.md';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
const playbook = read(PLAYBOOK);
const intake = read(INTAKE);
const COMMAND = frontDeskCommand('/plugin', { platform: 'linux' });
const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';

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
const commandWords = (text) => [...text.replaceAll(ROOT_VARIABLE, '/plugin').matchAll(/cli\.js"? ([a-z]+)/g)].map((m) => m[1]);

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
  assert.deepEqual(allow, [`Bash(${COMMAND}:*)`, `Edit(/${FRONT_DESK_INPUT})`]);
  for (const [file, text] of [[PLAYBOOK, playbook], [INTAKE, intake]]) {
    const nodes = [...text.matchAll(/node "[^"]*"/g)].map((m) => m[0].replaceAll(ROOT_VARIABLE, '/plugin'));
    assert.ok(nodes.length > 0, `${file} names the command`);
    for (const command of nodes) assert.equal(command, COMMAND, file);
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
    if (args === 'record ruling') assert.ok(answered.card.question.question.startsWith('What this is:'));
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
