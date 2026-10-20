// tests/skills/setup.test.js
// Setup's playbook and its command, pinned against the code (ruling R94): the playbook's front
// matter and the session-start lines that send a session to it, its command exactly as the allow
// rule matches it, only the forms cli.js takes, step 9's rule (the push step's number, `waitsFor`
// and the test's words) and Later, the labels it waits for, and the README's two install lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE } from '../../scripts/setup/cli.js';
import { NODE_LINE, INSTALL_LINE } from '../../scripts/setup/tools.js';
import { setupCommand, allowRule, localSettings } from '../../scripts/protection/settings.js';
import { PUSH_TEST_STEP } from '../../scripts/lib/setup-run.js';
import { PUSH_TEST_TEXT, READY } from '../../scripts/setup/notify.js';
import { LEAVE_YOURS } from '../../scripts/setup/project-files.js';
import { SETUP_LABEL, TRUST_LABEL, UNINSTALL_LABEL } from '../../scripts/state/card-lines.js';
import { differentKeyLine } from '../../scripts/lib/trust-clicks.js';
import {
  NOT_SET_UP, partWay, JOURNAL_UNREADABLE, REMOVED, FOREMAN_HELD_UNREADABLE, FOREMAN_HELD_NEWER, TRUST_ASK,
} from '../../scripts/hooks/session-start.js';
import { decide as stopGuard } from '../../scripts/hooks/stop-guard.js';
import { setStop } from '../../scripts/lib/stop.js';
import { as, shortHome } from '../helpers/homes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_VARIABLE = '${CLAUDE_PLUGIN_ROOT}';
const PLAYBOOK = 'skills/setup/SKILL.md';
const COMMAND_FILE = 'commands/setup.md';
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
const playbook = read(PLAYBOOK);
const command = read(COMMAND_FILE);
const readme = read('README.md');
const COMMAND = setupCommand('/plugin', { platform: 'linux' });
const TRIALS = COMMAND.replace('/scripts/setup/cli.js', '/scripts/health/trials.js');
// A code span that names a form: a form's first word, alone or before its arguments (not a field such as `plan: null`).
const FORM_WORDS = /^(?:plan|apply|status|resume|health|uninstall)(?=$| [a-z0-9<[])/;

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

// A form's words before its first argument: `plan <step>` and `plan 9` are both `plan`.
const head = (form) => form.split(' ').filter((w) => /^[a-z]+$/.test(w)).join(' ');
const usageForms = () => USAGE.replace(/^Commands: /, '').split(', ').map((f) => f.trim());

test('the playbook is named setup and is used where the session start points to it', () => {
  const { front, body } = frontOf(playbook, PLAYBOOK);
  assert.equal(front.name, 'setup');
  assert.deepEqual(Object.keys(front).sort(), ['description', 'name']);
  assert.match(front.description, /^Use when /);
  assert.ok(front.description.length <= 500, 'a short description');
  assert.ok(body.startsWith(`<!-- ${PLAYBOOK} -->\n`), 'the path comment follows the front matter');
  // Each session-start line that names the playbook does so by this name.
  for (const line of [NOT_SET_UP, partWay(3, 'The host and the connection'), JOURNAL_UNREADABLE, REMOVED, FOREMAN_HELD_UNREADABLE]) {
    assert.ok(line.includes(`wheelhouse:${front.name}`), line);
  }
  assert.ok(front.description.includes(`"${NOT_SET_UP.split('.')[0]}"`), front.description);
});

test('the playbook knows each session-start line it acts on, as the session start words it', () => {
  for (const words of [
    TRUST_ASK.split(':')[0],
    differentKeyLine('<id>'),
    REMOVED.split('. ')[0],
    FOREMAN_HELD_UNREADABLE.split('. ')[0],
    JOURNAL_UNREADABLE.split(',')[0],
  ]) assert.ok(playbook.includes(words), words);
  // A newer Wheelhouse's journal: the director updates Wheelhouse.
  assert.match(FOREMAN_HELD_NEWER, /update Wheelhouse/);
  assert.match(playbook, /newer Wheelhouse wrote the journal, they update Wheelhouse/);
});

test('every command is cli.js exactly as its allow rule matches it, or step 10\'s trials', () => {
  const allow = localSettings({ address: '/h/helper.sock', pluginRoot: '/plugin', platform: 'linux' }).permissions.allow;
  assert.ok(allow.includes(allowRule(COMMAND)), allow.join(', '));
  for (const [file, text] of [[PLAYBOOK, playbook], [COMMAND_FILE, command]]) {
    const nodes = [...text.matchAll(/node "[^"]*"/g)].map((m) => m[0].replaceAll(ROOT_VARIABLE, '/plugin'));
    assert.ok(nodes.includes(COMMAND), `${file} names the command`);
    for (const named of nodes) assert.ok(named === COMMAND || (file === PLAYBOOK && named === TRIALS), `${file}: ${named}`);
  }
  // The trials as health.js says the session runs them, with the pull request and project health names.
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'health', 'trials.js')));
  assert.ok(playbook.replaceAll(ROOT_VARIABLE, '/plugin').includes(`${TRIALS} --pr <pr> --project <project>`));
  assert.match(playbook, /`trials\.pr` and `trials\.project`/);
});

test('the playbook lists exactly cli.js\'s forms, and names no other', () => {
  const listed = /Its forms: (.*)\.$/m.exec(playbook)?.[1] ?? '';
  const forms = [...listed.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(forms, usageForms());
  const known = new Set(usageForms().map(head));
  for (const [file, text] of [[PLAYBOOK, playbook], [COMMAND_FILE, command]]) {
    const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/^node "[^"]*" /, ''));
    for (const span of spans.filter((s) => FORM_WORDS.test(s))) assert.ok(known.has(head(span)), `${file}: ${span}`);
  }
  assert.match(command, /`wheelhouse:setup`/);
  assert.ok(command.includes(`${COMMAND.replace('/plugin', ROOT_VARIABLE)} resume`));
});

test('step 9\'s rule: a wait with waitsFor sends nothing, one without sends one push with the test\'s words; Later stops', () => {
  const section = playbook.split(`## Step ${PUSH_TEST_STEP}, `)[1]?.split('\n## ')[0] ?? '';
  assert.ok(section, `a section for step ${PUSH_TEST_STEP}`);
  assert.match(section, /wait \*\*with\*\* `waitsFor`[^\n]*no push/);
  assert.match(section, /wait \*\*without\*\* `waitsFor`[^\n]*exactly one test notification/);
  assert.ok(section.includes(`"${PUSH_TEST_TEXT}"`), 'the push says the test\'s words');
  assert.ok(section.includes(`**${READY.later}:**`), 'Later is named');
  assert.match(section.split(`**${READY.later}:**`)[1], /offer to carry on later/);
});

test('the playbook waits for the labels the cards carry', () => {
  for (const label of [SETUP_LABEL, UNINSTALL_LABEL, TRUST_LABEL, LEAVE_YOURS]) assert.ok(playbook.includes(`**${label}**`), label);
  // Apply only after the click, with the hash from that same plan.
  assert.match(playbook, /Only after the director's \*\*Go ahead\*\* on that card, run `apply <step> <hash>`/);
  assert.match(playbook, /Only after \*\*Remove it\*\*, run `uninstall apply <hash>`/);
});

test('the README gives the Node.js line and the install line as they are', () => {
  assert.ok(readme.includes(NODE_LINE), 'NODE_LINE');
  assert.ok(readme.includes(INSTALL_LINE), 'INSTALL_LINE');
  assert.match(readme, /\*\*this project\*\*/);
});

test('the playbook\'s reading forms run under STOP', async () => {
  await as(shortHome(), async () => {
    setStop({ by: 'prompt' });
    for (const form of ['resume', 'status', 'plan 3', 'health', 'uninstall plan', 'uninstall status']) {
      const input = { cwd: '/projects/shop', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `${COMMAND} ${form}` } };
      assert.equal(await stopGuard(input, { projectOf: () => ({ project: 'o__p' }), pluginRoot: '/plugin', platform: 'linux' }), undefined, form);
    }
  });
});
