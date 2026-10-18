// tests/skills/foreman.test.js
// The foreman's playbook (build-loop design, sections 2, 8, 11 and 12): its
// front matter, the exact commands its allow rules match, only commands its
// scripts have, no model and no other skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as actMain } from '../../scripts/foreman/act.js';
import { foremanCommands } from '../../scripts/foreman/tools.js';
import { main as wakeMain } from '../../scripts/foreman/wake.js';
import { FOREMAN_PROMPT_LEAD } from '../../scripts/foreman/start.js';
import { PROMPTS } from '../../scripts/watcher/waker.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = 'skills/foreman/SKILL.md';
const raw = fs.readFileSync(path.join(ROOT, FILE), 'utf8').replaceAll('\r\n', '\n');
const ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}';

function frontOf(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, `${FILE} starts with front matter`);
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { front, keys: m[1].split('\n').map((l) => /^([A-Za-z-]+):/.exec(l)?.[1]).filter(Boolean), body: m[2] };
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

const { front, keys, body } = frontOf(raw);

test('the foreman skill is named foreman and is used on the wake line and the long session\'s start', () => {
  assert.equal(front.name, 'foreman');
  assert.deepEqual(keys.sort(), ['description', 'name']);
  assert.match(front.description, /^Use when /);
  assert.ok(front.description.length <= 500, 'a short description');
  // Both shapes' first prompts begin with the line the description names.
  assert.ok(front.description.includes(`"${FOREMAN_PROMPT_LEAD}"`), front.description);
  assert.ok(PROMPTS.foreman('w.json').startsWith(FOREMAN_PROMPT_LEAD));
  // The path comment straight after the front matter.
  assert.ok(body.startsWith(`<!-- ${FILE} -->\n`), 'the path comment follows the front matter');
});

test('the skill types its two commands exactly as the foreman\'s allow rules match them', () => {
  const commands = [...raw.matchAll(/`(node '[^`]*')`/g)].map((m) => m[1]);
  const expected = foremanCommands('/plugin', { platform: 'linux' });
  assert.deepEqual(
    commands.map((c) => c.replaceAll(ROOT_VARIABLE, '/plugin')).sort(),
    [expected.act, expected.wake].sort(),
  );
  // Nothing else is run: no other script, no git, no other program.
  assert.equal([...raw.matchAll(/scripts\//g)].length, 2);
  assert.doesNotMatch(body, /`(git|npm|gh|glab|cd|rm|bash|sh) /);
});

test('every act and wake command the skill names is one the scripts have, and it covers every act command', async () => {
  const act = await subcommands(actMain, [], { client: {} });
  const wake = await subcommands(wakeMain, ['nothing'], { project: 'p', client: {} });
  assert.ok(act.size >= 10 && wake.has('read') && wake.has('done'));

  const actNamed = new Set([...raw.matchAll(/(?:`|Next: )act ([a-z][a-z-]*)/g)].map((m) => m[1]));
  const wakeNamed = new Set([...raw.matchAll(/`wake ([a-z][a-z-]*)/g)].map((m) => m[1]));
  for (const sub of actNamed) assert.ok(act.has(sub), `act ${sub} is one of ${[...act].join(', ')}`);
  for (const sub of wakeNamed) assert.ok(wake.has(sub), `wake ${sub} is one of ${[...wake].join(', ')}`);
  assert.deepEqual([...act].filter((sub) => !actNamed.has(sub)), [], 'the playbook says when to run each act command');
  assert.ok(wakeNamed.has('read') && wakeNamed.has('done'));
  assert.match(raw, /`wake done <file> --acted`/);
  assert.match(raw, /`wake done <file> --idle`/);

  // Each flag it gives is one act.js takes.
  const source = fs.readFileSync(path.join(ROOT, 'scripts/foreman/act.js'), 'utf8');
  const flags = new Set([...raw.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]).filter((f) => !['acted', 'idle'].includes(f)));
  assert.ok(flags.size >= 8);
  for (const flag of flags) assert.ok(source.includes(`'${flag}'`), `act.js takes --${flag}`);
});

test('the skill names no model and starts no other skill', () => {
  assert.doesNotMatch(raw, /\b(opus|sonnet|haiku|fable|claude-[a-z0-9-]+|gpt-[0-9a-z.-]+)\b/i);
  assert.equal(front.model, undefined);
  assert.doesNotMatch(raw, /\b(superpowers|mattpocock-skills|anthropic-skills|wheelhouse|feature-dev):[a-z]/i);
  assert.doesNotMatch(raw, /\bSkill tool\b|\binvoke\b|writing-plans|brainstorming|subagent/i);
});
