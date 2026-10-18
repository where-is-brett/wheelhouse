// tests/skills/foreman.test.js
// The foreman's playbook (build-loop design, sections 2, 8, 11 and 12): its
// front matter, its first command exactly as the allow rules match it, every
// later command copied from the wake (ruling R96), only commands and flags its
// scripts take, the lines it relies on printed by those scripts, no model and
// no other skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as actMain } from '../../scripts/foreman/act.js';
import { FOREMAN_SKILL, foremanCommands, foremanTools } from '../../scripts/foreman/tools.js';
import { main as wakeMain } from '../../scripts/foreman/wake.js';
import { FOREMAN_PROMPT_LEAD } from '../../scripts/foreman/start.js';
import { PROMPTS } from '../../scripts/watcher/waker.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = 'skills/foreman/SKILL.md';
const raw = fs.readFileSync(path.join(ROOT, FILE), 'utf8').replaceAll('\r\n', '\n');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const WAKE_JS = source('scripts/foreman/wake.js');
const ACT_JS = source('scripts/foreman/act.js');
const ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}';

function frontOf(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${FILE} starts with front matter`);
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { front, body: m[2] };
}

// The subcommands a script's usage line lists, from its own refusal.
async function subcommands(main, argv, options) {
  let said = '';
  const code = await main(argv, { ...options, out: () => {}, err: (t) => { said += t; } });
  assert.equal(code, 1);
  const m = /^Commands: (.*)$/m.exec(said);
  assert.ok(m, said);
  return new Set(m[1].replace(/, each .*$/, '').split(',').map((part) => part.trim().split(/\s+/)[0]).filter((w) => /^[a-z][a-z-]*$/.test(w)));
}

// The flags act.js parses for each command.
function actFlags() {
  const out = {};
  for (const m of ACT_JS.matchAll(/flagsOf\(rest, \[([^\]]*)\], '([a-z-]+)'\)/g)) {
    out[m[2]] = new Set([...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]));
  }
  return out;
}

// The skill's sections by heading.
function sections(body) {
  const out = {};
  let name = '';
  for (const line of body.split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) name = h[1];
    else out[name] = `${out[name] ?? ''}${line}\n`;
  }
  return out;
}

const { front, body } = frontOf(raw);

test('the foreman skill is named foreman and is used on the wake line and the long session\'s start', () => {
  assert.equal(front.name, 'foreman');
  assert.deepEqual(Object.keys(front).sort(), ['allowed-tools', 'description', 'name']);
  assert.match(front.description, /^Use when /);
  assert.ok(front.description.length <= 500, 'a short description');
  // Both shapes' first prompts begin with the line the description names, and Shape 1's names this skill (R98).
  assert.ok(front.description.includes(`"${FOREMAN_PROMPT_LEAD}"`), front.description);
  assert.ok(PROMPTS.foreman('w.json').startsWith(FOREMAN_PROMPT_LEAD));
  assert.ok(PROMPTS.foreman('w.json').includes(FOREMAN_SKILL));
  assert.ok(foremanTools('/plugin', { platform: 'linux' }).includes(`Skill(${FOREMAN_SKILL})`));
  assert.equal(FOREMAN_SKILL.split(':')[1], front.name);
  // The path comment straight after the front matter.
  assert.ok(body.startsWith(`<!-- ${FILE} -->\n`), 'the path comment follows the front matter');
});

test('the skill types only its first command itself, exactly as the allow rules match it, and copies the rest from the wake (R96)', () => {
  const commands = [...raw.matchAll(/`(node '[^`']*')/g)].map((m) => m[1]);
  const expected = foremanCommands('/plugin', { platform: 'linux' });
  assert.deepEqual(commands.map((c) => c.replaceAll(ROOT_VARIABLE, '/plugin')), [expected.wake]);
  assert.match(body, new RegExp(`\`${commands[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} read <file>\``));
  // Its one allowed tool is that command, as a rule the same substitution fills in.
  assert.equal(front['allowed-tools'], `Bash(${commands[0]}:*)`);
  // act's path is never written here: it is copied from the wake's own line.
  assert.doesNotMatch(raw, /scripts\/foreman\/act\.js/);
  assert.match(body, /`Run wake as: …`/);
  assert.match(body, /`Run act as: …`/);
  assert.ok(WAKE_JS.includes('`Run wake as: ${commands.wake}`') && WAKE_JS.includes('`Run act as: ${commands.act}`'));
  // Nothing else is run: no git, npm, gh, glab or shell command.
  assert.doesNotMatch(body, /`(git|npm|gh|glab|cd|rm|bash|sh|node -e) /);
});

test('every act and wake command the skill names is one the scripts have, and every Next the wake prints is an act command', async () => {
  const act = await subcommands(actMain, [], { client: {} });
  const wake = await subcommands(wakeMain, ['nothing'], { project: 'p', client: {} });
  assert.ok(act.size >= 10 && wake.has('read') && wake.has('done'));

  const actNamed = new Set([...raw.matchAll(/(?:`|Next: )act ([a-z][a-z-]*)/g)].map((m) => m[1]));
  const wakeNamed = new Set([...raw.matchAll(/(?:`|' )(?:wake )?(read|done|measures) </g)].map((m) => m[1]));
  for (const sub of actNamed) assert.ok(act.has(sub), `act ${sub} is one of ${[...act].join(', ')}`);
  for (const sub of wakeNamed) assert.ok(wake.has(sub), `wake ${sub} is one of ${[...wake].join(', ')}`);
  assert.ok(['start', 'ask'].every((sub) => actNamed.has(sub)));
  assert.match(raw, /`wake done <file> --acted`/);
  assert.match(raw, /`wake done <file> --idle`/);

  // The skill runs whatever the wake says next, so each of those is an act command.
  const next = new Set([...WAKE_JS.matchAll(/Next: act ([a-z][a-z-]*)/g)].map((m) => m[1]));
  assert.ok(next.size >= 8, [...next].join(', '));
  for (const sub of next) assert.ok(act.has(sub), `wake.js prints Next: act ${sub}`);
  // The queue's build and resume lines print their verb.
  assert.ok(WAKE_JS.includes("const verb = step === 'paused' ? 'resume' : 'build';") && WAKE_JS.includes('Next: act ${verb} ${id}'));
  assert.ok(act.has('build') && act.has('resume'));
});

test('each flag the skill gives is one act.js parses for that command', () => {
  const flags = actFlags();
  assert.ok(flags.start.has('goal') && flags.ask.has('what'), 'act.js parses its flags as the test reads them');
  const parts = sections(body);
  const flagsIn = (text) => [...text.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]);
  const start = flagsIn(parts['Starting work']);
  const ask = flagsIn(parts['Asking the director']);
  assert.ok(start.length >= 6 && ask.length >= 5);
  for (const flag of start) assert.ok(flags.start.has(flag), `act start takes --${flag}`);
  for (const flag of ask) assert.ok(flags.ask.has(flag), `act ask takes --${flag}`);
  assert.deepEqual(flagsIn(parts['At each wake']).sort(), ['acted', 'idle']);
  for (const [name, text] of Object.entries(parts)) {
    if (!['Starting work', 'Asking the director', 'At each wake'].includes(name)) {
      for (const flag of flagsIn(text)) assert.ok(['acted', 'idle'].includes(flag), `${name}: --${flag}`);
    }
  }
});

test('the lines the skill acts on are ones the scripts print', () => {
  for (const said of ['Ask the director: act ask', 'Next: act start ', 'which says: ', 'Hold: ', '- ruling ', 'It is an extra plan of ']) {
    assert.ok(WAKE_JS.includes(said), `wake.js prints "${said}"`);
  }
  assert.match(body, /Ask the director: act ask/);
  assert.match(body, /"which says: …"/);
  assert.match(body, /`Hold:` line/);
  // A refusal that needs nothing says so; the skill keys on those words.
  assert.match(body, /"Nothing to do"/);
  assert.ok(ACT_JS.includes('Nothing to do until it is over'));
  // Shape 2's START line, as the waker prints it.
  assert.ok(source('scripts/watcher/waker.js').includes('print(`START feature ${work} ${worktree}`)'));
  assert.match(body, /`START feature W <worktree>`/);
});

test('the skill names no model and starts no other skill', () => {
  assert.doesNotMatch(raw, /\b(opus|sonnet|haiku|fable|claude-[a-z0-9-]+|gpt-[0-9a-z.-]+)\b/i);
  assert.equal(front.model, undefined);
  assert.doesNotMatch(raw, /\b(superpowers|mattpocock-skills|anthropic-skills|wheelhouse|feature-dev):[a-z]/i);
  assert.doesNotMatch(raw, /\bSkill tool\b|\binvoke\b|writing-plans|brainstorming|subagent/i);
});
