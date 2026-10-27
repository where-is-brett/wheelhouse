// tests/skills/setup.test.js
// Setup's playbook and its command, pinned against the code (ruling R94): the playbook's front
// matter and the session-start lines that send a session to it, its command exactly as the allow
// rule matches it, only the forms cli.js takes, step 9's rule (the push step's number, `waitsFor`
// and the test's words) and Skip for now, the labels it waits for, and the README's two install lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE } from '../../scripts/setup/cli.js';
import { NODE_LINE, INSTALL_COMMANDS } from '../../scripts/setup/tools.js';
import { setupCommand, frontDeskCommand, allowRule, localSettings } from '../../scripts/protection/settings.js';
import { PUSH_TEST_STEP } from '../../scripts/lib/setup-run.js';
import { PUSH_TEST_TEXT, READY } from '../../scripts/setup/notify.js';
import { LEAVE_YOURS } from '../../scripts/setup/project-files.js';
import { SETUP_LABEL, TRUST_LABEL, UNINSTALL_LABEL } from '../../scripts/state/card-lines.js';
import {
  NOT_SET_UP, partWay, JOURNAL_UNREADABLE, REMOVED, FOREMAN_HELD_UNREADABLE, FOREMAN_HELD_NEWER, importedLine,
} from '../../scripts/hooks/session-start.js';
import { decide as stopGuard } from '../../scripts/hooks/stop-guard.js';
import { NOT_AN_ANSWER } from '../../scripts/setup/engine.js';
import { UNINSTALL_NEEDS_CLICK, UNINSTALL_NEW_SESSION } from '../../scripts/setup/uninstall.js';
import { HEALTH_STEP } from '../../scripts/lib/setup-run.js';
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
const FORM_WORDS = /^(?:plan|apply|status|resume|wait|health|uninstall)(?=$| [a-z0-9<[])/;

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
    importedLine({ imported: 1, what: 'your settings' }).split(':')[0],
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
  // The command file is Claude Code's packaging and names the command as the allow rule matches it; the playbook
  // names it in general words, and the session start's command line (tests/skills/tool-names.test.js) gives it.
  const nodes = [...command.matchAll(/node "[^"]*"/g)].map((m) => m[0].replaceAll(ROOT_VARIABLE, '/plugin'));
  assert.ok(nodes.includes(COMMAND), `${COMMAND_FILE} names the command`);
  for (const named of nodes) assert.equal(named, COMMAND, COMMAND_FILE);
  assert.doesNotMatch(playbook, /node "/);
  assert.match(playbook, /The Wheelhouse command the session start named, with `scripts\/setup\/cli\.js` in place of `scripts\/frontdesk\/cli\.js`/);
  assert.equal(frontDeskCommand('/plugin', { platform: 'linux' }).replace('scripts/frontdesk/cli.js', 'scripts/setup/cli.js'), COMMAND);
  // The trials as health.js says the session runs them, with the pull request and project health names.
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'health', 'trials.js')));
  assert.ok(playbook.includes('The Wheelhouse command the session start named, with `scripts/health/trials.js` in place of `scripts/frontdesk/cli.js`: `<that command> --pr <pr> --project <project>`.'));
  assert.equal(frontDeskCommand('/plugin', { platform: 'linux' }).replace('scripts/frontdesk/cli.js', 'scripts/health/trials.js'), TRIALS);
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

test('step 9\'s rule: a wait with waitsFor sends nothing, one without sends one push with the test\'s words; Skip for now carries on', () => {
  const section = playbook.split(`## Step ${PUSH_TEST_STEP}, `)[1]?.split('\n## ')[0] ?? '';
  assert.ok(section, `a section for step ${PUSH_TEST_STEP}`);
  assert.match(section, /wait \*\*with\*\* `waitsFor`[^\n]*no push/);
  assert.match(section, /wait \*\*without\*\* `waitsFor`[^\n]*exactly one test notification/);
  assert.ok(section.includes(`"${PUSH_TEST_TEXT}"`), 'the push says the test\'s words');
  assert.ok(section.includes(`**${READY.skip}:**`), 'Skip for now is named');
  const skip = section.split(`**${READY.skip}:**`)[1].split('\n')[0];
  assert.match(skip, /settles as skipped/);
  assert.match(skip, /front desk sets up phone notifications/);
  assert.match(skip, /Don't ask the card again/);
  assert.doesNotMatch(section, /don't try step 10/);
  // The phone comes last, once setup is finished, and never holds it up (design section 15.1).
  assert.match(section, /The phone comes once setup is finished: the `resume` after the green board gives its card/);
  assert.match(section, /never holds setup up/);
  // The front desk takes the test when the director asks for it later.
  const desk = read('skills/front-desk/SKILL.md');
  assert.match(desk, /"Set up phone notifications"[^\n]*`scripts\/setup\/cli\.js`[^\n]*`plan 9`/);
});

// The one card (design section 15.1): Go ahead runs every step with no more cards; Customise's cards
// are asked together; an answer is changed through `choices` and `change`, never refused flat.
test('the playbook opens with the one card, applies what its Go ahead covers, asks Customise\'s cards together and changes any answer', () => {
  assert.match(playbook, /## The one card\n/);
  assert.match(playbook, /\*\*`hash` and `covered: true`:\*\* the one card's Go ahead covers it\.[^\n]*then run `apply <step> <hash>` at once/);
  assert.match(playbook, /\*\*`asks`:\*\* ask every card in it together, in one call/);
  assert.match(playbook, /`questions: \[card, card, …\]`/);
  assert.match(playbook, /run `choices`, pick the key whose `about` matches what they said, then `change <key>`/);
  assert.match(playbook, /Never say an answer can't be changed/);
  assert.match(playbook, /\*\*`setUpAgain: true`\*\*, whatever the plan says[^\n]*Follow Uninstall below/);
  assert.match(playbook, /\*\*Change it after setup\*\*: tell them in one line that the front desk starts that change right after setup/);
  assert.match(playbook, /first each of `requests` \(changes they asked for after setup\), then the request they came with/);
  assert.match(USAGE, /choices, change <key>/);
});

test('the playbook waits for the labels the cards carry', () => {
  const uninstall = read('skills/setup/uninstall.md');
  for (const label of [SETUP_LABEL, LEAVE_YOURS]) assert.ok(playbook.includes(`**${label}**`), label);
  assert.ok(uninstall.includes(`**${UNINSTALL_LABEL}**`), UNINSTALL_LABEL);
  // No trust card is handed out now (rulings R80, R81 retired), so the playbook waits for no Trust it.
  assert.equal(playbook.includes(`**${TRUST_LABEL}**`), false);
  // Apply only after the click, with the hash from that same plan.
  assert.match(playbook, /Only after the director's \*\*Go ahead\*\* on that card, run `apply <step> <hash>`/);
  assert.match(uninstall, /Only after \*\*Remove it\*\*, run `uninstall apply <hash>`/);
  // Uninstall's part is read only when it is asked for, so a setup session doesn't carry it.
  assert.match(playbook, /## Uninstall\n\nWhen the director asks to remove Wheelhouse from the project, or types `\/wheelhouse:uninstall`: read `uninstall\.md` in this skill's folder/);
});

// From the pressure runs: a director who stops is not asked again; a typed answer on a card that
// takes one goes back to the helper; a Go-ahead card is asked before any other plan; step 10's
// trials wait for step 10's own checks, through `wait 10`.
test('the playbook closes the gaps its pressure runs found', () => {
  assert.match(playbook, /\*\*The director stops\*\*[^\n]*stop at once[^\n]*don't ask the card again/);
  assert.match(playbook, /\*\*A card whose answer may be typed\*\*[^\n]*taken as their answer[^\n]*run `plan <step>` again/);
  assert.match(playbook, /a Go-ahead card:\*\* ask `card` before anything else; never run `plan` again over it/);
  assert.match(playbook, /run `wait 10`, saying nothing: it waits while step 10 runs and answers `waited: true` once its own checks are done/);
});

// From a new product's setup on v0.1.2: `wait 10` was refused while step 10 ran, and the session's
// own Bash wait loop failed silently for twenty minutes; it told the director it was "running the
// last trials in this session"; and the network check's first run, before a new session, read as
// a failure.
test('step 10 names its wait, forbids a loop of the session\'s own, speaks plainly, and expects one new session', () => {
  const ten = playbook.split('\n## Step 10, the health check\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(ten, /Never write a wait loop of your own, in Bash or otherwise\./);
  assert.match(ten, /When it has run long \(three calls\), tell the director in one line/);
  assert.match(ten, /never "trials", "sandbox" or "session" to the director/);
  assert.match(ten, /\*\*One new session\.\*\*[^\n]*start a new session on this folder, then say "carry on with setup"[^\n]*not a failure/);
  assert.match(ten, /A `Not yet` line saying a new session is needed is not a failure/);
});

// From a new product's setup on v0.1.2: "Setup hasn't started here yet. One card covers the whole
// plan:", said before the one card, headed the message the app showed at setup's end.
test('the playbook says nothing before the one card when setup hasn\'t started', () => {
  assert.match(playbook, /When setup hasn't started, say nothing before the one card: it speaks for itself/);
});

// From the rehearsal: Claude Code refuses a foreground `sleep`, so every wait goes through `wait <step>`.
test('the playbook waits with `wait <step>`, never a sleep of its own', () => {
  assert.match(playbook, /\*\*`wait` with `waitsFor`:\*\* the step waits for step `waitsFor` to finish\. Run `wait <step>`, saying nothing, then `resume`\./);
  const nine = playbook.split('\n## Step 9, phone notifications\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(nine, /Run `wait 9` until it answers `waited: true` \(each call waits up to a minute and a half, then says how long is left\), then send exactly one test notification/);
  assert.doesNotMatch(playbook, /\bsleep\b/);
});

// From the rehearsal on a project under way (docs/evals/rehearsal-project-under-way.md): with the
// folder on a line of unfinished work, the session told the director to stash their changes (the
// install's lines in .claude/settings.json with them) or to make that line the host's default; with
// the helper unreachable, it sent them to a "Wheelhouse app" that doesn't exist.
test('the playbook keeps a project under way safe when step 7 finds the folder on another line, and says how the helper starts', () => {
  const wrong = playbook.split('\n## When something goes wrong\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(read('scripts/setup/project-files.js'), /but this folder is on \$\{current \?\? 'no branch'\}/, 'step 7 words it so');
  assert.match(wrong, /\*\*"this folder is on <line>"\*\*/);
  assert.match(wrong, /Never suggest putting their changes aside \(stash\), undoing, committing or deleting them, or changing the host's default branch/);
  assert.match(wrong, /`git switch <branch>`/);
  assert.match(read('scripts/host/helper-client.js'), /the host helper could not be reached/, 'the client words it so');
  assert.match(wrong, /\*\*"the host helper could not be reached"\*\*[^\n]*session start starts it[^\n]*There is no Wheelhouse app to open/);
});

// Task R N1: uninstall's shortest cards point to `uninstall status` for the list, so the playbook
// runs it and shows its lines before asking the card. Rulings R142, R146: once a stopped uninstall's
// status, or plan, says first to start a new session, the card is not asked again in this one.
test('the playbook shows uninstall\'s list when its card points to status, and stops asking the card when plan or status says to start a new session', () => {
  const uninstall = read('skills/setup/uninstall.md');
  assert.match(uninstall, /When uninstall's card points to `uninstall status`, run it first and show its lines plainly, then ask the card\./);
  assert.match(read('scripts/setup/uninstall.js'), /\$\{head\}[^\n]*What else stays: \$\{STATUS_FORM\}/, 'the card points so');
  assert.ok(UNINSTALL_NEW_SESSION.startsWith('Start a new session on this folder, then ask for uninstall\'s plan again'));
  assert.match(uninstall, /If plan's or status's first line says to start a new session, show its lines and stop there; don't ask the card again in this session\./);
  const command = read('commands/uninstall.md');
  assert.match(command, /If the card points to `uninstall status`, first run `node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/setup\/cli\.js" uninstall status` and show its lines as they are\./);
  assert.match(command, /If plan's or status's first line says to start a new session, show its lines and stop there; don't ask the card again in this session\./);
});

test('the README gives the Node.js line and the install commands as they are, at the plugin\'s release', () => {
  assert.ok(readme.includes(NODE_LINE), 'NODE_LINE');
  const version = JSON.parse(read('.claude-plugin/plugin.json')).version;
  for (const command of INSTALL_COMMANDS) assert.ok(readme.includes(command.replace('<tag>', `v${version}`)), command);
  assert.doesNotMatch(readme, /--marketplace/);
  assert.match(readme, /\*\*this project\*\*/);
});

test('the playbook\'s reading forms run under STOP', async () => {
  await as(shortHome(), async () => {
    setStop({ by: 'prompt' });
    for (const form of ['resume', 'status', 'plan 3', 'wait 9', 'health', 'uninstall plan', 'uninstall status']) {
      const input = { cwd: '/projects/shop', session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `${COMMAND} ${form}` } };
      assert.equal(await stopGuard(input, { projectOf: () => ({ project: 'o__p' }), pluginRoot: '/plugin', platform: 'linux' }), undefined, form);
    }
  });
});

// Rulings R125, R132: a typed question or the choice handed back comes back as `unanswered`, a
// line for the director saying why; the playbook tells them that line as it is, says the choice is
// theirs and gives the card's recommendation before asking it again.
test('the playbook acts on a typed answer the helper did not take, as rulings R125 and R132 say', () => {
  // Ruling R135: after a question, whatever the director types next on that card is taken, and the line says so.
  assert.match(NOT_AN_ANSWER.question, /^What you typed ends with a question mark[^\n]*Whatever you type on this card next is taken as your answer, so ask any question in the chat\.$/);
  assert.match(NOT_AN_ANSWER.handedBack, /^What you typed hands the choice back[^\n]*not taken as your answer/);
  assert.match(playbook, /\*\*A card whose answer may be typed\*\*[^\n]*comes back with `unanswered`, first tell them its line as it is: why what they typed was not taken \(after a question, whatever they type next on that card is taken\)\. Then tell them plainly that the choice is theirs, give the card's own recommendation and reason, then ask the same card again/);
  assert.doesNotMatch(playbook, /whatever they type is their answer, even a question/);
  assert.match(playbook, /\| "They typed a question on the owner\/name card[^\n]*with `unanswered`, tell them its line[^\n]*recommendation/);
});

// Task 16's must-fix Minors 3 to 6: step 10's trials are the never list's one exception; step 10's
// own wait without waitsFor is the session's part; only a refusal twice stops; uninstall's password
// window and its needs-click refusal are named.
test('the playbook names step 10\'s trials and wait, stops on a refusal twice only, and names uninstall\'s password window and click', () => {
  assert.match(playbook, /\*\*You never:\*\*[^\n]*except step 10's trials \(below\)/);
  const health = read('scripts/setup/health.js');
  assert.ok(health.includes(`step ${HEALTH_STEP}'s own checks are done and its trial pull request`), 'step 10\'s plan words its wait so, with no waitsFor');
  assert.match(playbook, /\*\*`wait` without `waitsFor`:\*\*[^\n]*On step 10 it is your part: follow Step 10 below/);
  assert.match(playbook, /\*\*Never retry in a loop\.\*\* The same refusal twice: stop[^\n]*`uninstall status` while uninstall runs, are not refusals/);
  assert.doesNotMatch(playbook, /The same answer twice/);
  const uninstall = read('skills/setup/uninstall.md');
  assert.match(uninstall, /password window/);
  assert.match(read('commands/uninstall.md'), /password window/);
  assert.ok(UNINSTALL_NEEDS_CLICK.startsWith('uninstall needs the director\'s Remove it'));
  assert.match(uninstall, /If it says uninstall needs the director's Remove it, start again at 1 and ask the card again; never apply without its click/);
});

// A green board's verdict and first briefing open the next card `resume` gives (the phone's), which the
// session asks word for word: in every rehearsal run of 27 October 2026 the session went straight on to
// the phone card or the front desk, and the director never saw the briefing it was told to show.
test('step 10\'s green board: the playbook runs resume at once and asks its card, which opens with the briefing', () => {
  const section = playbook.split(`## Step ${HEALTH_STEP}, `)[1]?.split('\n## ')[0] ?? '';
  assert.ok(section, `a section for step ${HEALTH_STEP}`);
  const green = section.split('**Green:**')[1]?.split('**Not green:**')[0] ?? '';
  assert.match(green, /Run `resume` at once\. The card it gives \(the phone's, Step 9 above\) opens with the verdict and the first briefing: ask it exactly as given/);
  assert.match(green, /With no card left, its plan gives step 10 settled, with them as `said`: show that as it is, in a message of its own/);
  assert.ok(section.indexOf('**Green:**') < section.indexOf('When `health` gave a `card`'), 'the briefing\'s card before the carry-on card');
  assert.ok(playbook.includes('| "The board is green; I\'ll sum it up and move on" | `resume` at once'), 'a red flag for it');
  assert.match(playbook.split(`## Step ${PUSH_TEST_STEP}, `)[1], /opens with the verdict and the first briefing/);
});
