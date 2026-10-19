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
  assert.deepEqual(allow, [`Bash(${COMMAND}:*)`]);
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
    for (const m of text.matchAll(/\brecord ([a-z]+)(?= <<|`)/g)) assert.ok(RECORD_KINDS.includes(m[1]), `${file}: record ${m[1]}`);
    for (const m of text.matchAll(/`([a-z-]+)` card\b/g)) assert.ok(CARD_KINDS.includes(m[1]), `${file}: ${m[1]} card`);
  }
  // The listed commands are cli.js's own, and the views those `views` takes.
  const listed = /<command>`: (.*?)\. Type/.exec(playbook.replaceAll(ROOT_VARIABLE, '/plugin'))?.[1] ?? '';
  for (const name of known) assert.ok(listed.includes(`\`${name}`), `the playbook lists ${name}`);
  const views = /`views <name>` \(([^)]*)\)/.exec(playbook)?.[1] ?? '';
  assert.deepEqual([...views.matchAll(/`([a-z]+)`/g)].map((m) => m[1]), VIEW_NAMES);
});

test('each example input in the playbook is accepted as written, the approval with its head commit looked up', async () => {
  const blocks = [...playbook.matchAll(/```\nnode "([^"]*)" ([^\n<]*?) <<'EOF'\n([\s\S]*?)\nEOF\n```/g)];
  assert.ok(blocks.length >= 2, 'a record and a card are shown');
  const seen = [];
  for (const [, command, args, input] of blocks) {
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

test('the intake writes a changed approved document in place and marks it as waiting for the click, never as approved (F75)', () => {
  const rule = intake.split('\n').find((line) => line.includes('**A change to what an approved brief or design builds')) ?? '';
  assert.match(rule, /in place, in the one file the work names/);
  assert.match(rule, /approval line/);
  assert.match(rule, /changed since the director's approval and waits for their click on the change card/);
  assert.match(rule, /stays in git at the hash the approval names/);
  assert.match(rule, /`cli\.js record amendment` \(the work, the change, the changed document's hash\)/);
  assert.match(rule, /`amend` card/);
  // The red flags say the same.
  assert.match(intake, /\n\| "[^"\n]*approval line[^"\n]*" \| [^\n]*waits for the director's click[^\n]*\|\n/);
});
