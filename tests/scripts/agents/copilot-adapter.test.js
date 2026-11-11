// tests/scripts/agents/copilot-adapter.test.js
// The Copilot adapter: its parts, the parts not built yet, its tools and tool sheet, the safety lines
// (design section 6.6) and the board's health lines that carry them.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { ADAPTER_PARTS, NOT_BUILT_YET, checkAdapter, isPendingPart, pendingPart } from '../../../scripts/agents/contract.js';
import { AGENTS, adapterFor } from '../../../scripts/agents/index.js';
import { sessionsFor, sessionsOfProject } from '../../../scripts/agents/project-agent.js';
import { TOOL_SHEETS } from '../../../scripts/agents/tool-sheets.js';
import { SAFETY_LINES } from '../../../scripts/agents/safety-lines.js';
import { TOOL_SHEETS as SESSION_START_SHEETS, toolSheetLines } from '../../../scripts/hooks/session-start.js';
import { boardModel } from '../../../scripts/board/model.js';
import { NAMES, glossaryOf, plainWords } from '../../../scripts/frontdesk/glossary.js';
import { frontDeskCommand, knowsNoSystemCa } from '../../../scripts/protection/settings.js';
import { C6_PASSED, COPILOT_VERSION, GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, PROOFS, REVIEW_SESSION_READY } from '../../../scripts/agents/copilot/numbers.js';
import { LINE_CHARS } from '../../../scripts/lib/core-numbers.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import copilot from '../../../adapters/copilot/index.js';
import tools from '../../../adapters/copilot/tools.js';
import safetyLine, { updateWaiting } from '../../../adapters/copilot/safety-line.js';
import copilotSheet from '../../../adapters/copilot/tool-sheet.js';
import identity from '../../../adapters/copilot/identity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The sessions part left the list in part 7 of the return (built, and switched off by its own switch); the evaluation
// runner is built in part 10.
const PENDING = ['evalRunner'];
// A part made pending again, to try the contract's rules on a stub.
const STUBBED = { ...copilot, sessions: claudeCode.sessions, evalRunner: claudeCode.evalRunner, hooks: pendingPart('hooks', ['registration', 'file']) };

// Stand-ins for gh, glab and copilot come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

// ---- The adapter and its parts ----

test('the Copilot adapter passes checkAdapter with its pending parts listed', () => {
  assert.deepEqual(checkAdapter(copilot), []);
  assert.deepEqual(copilot.pending, PENDING);
  for (const part of ADAPTER_PARTS) assert.equal(isPendingPart(copilot[part]), PENDING.includes(part), `${part}`);
  assert.deepEqual(AGENTS, ['claude-code', 'copilot']);
  assert.equal(adapterFor('copilot'), copilot);
  // Claude Code's adapter has nothing pending.
  assert.equal(claudeCode.pending, undefined);
  assert.deepEqual(checkAdapter(claudeCode), []);
});

test('a part not built yet throws NOT_BUILT_YET naming the part', () => {
  for (const part of ['hooks']) {
    for (const [member, fn] of Object.entries(STUBBED[part])) {
      assert.equal(typeof fn, 'function');
      assert.throws(() => fn(), (error) => error.code === NOT_BUILT_YET && error.part === part && error.message.includes(`The ${part} part`) && error.message.includes(member), `${part}.${member}`);
    }
  }
  // The evaluation runner part is the stub part 1 left, and throws the same way.
  for (const part of PENDING) {
    for (const [member, fn] of Object.entries(copilot[part])) {
      assert.throws(() => fn(), (error) => error.code === NOT_BUILT_YET && error.part === part && error.message.includes(member), `${part}.${member}`);
    }
  }
});

test('sessionsFor gives the very object the Copilot adapter holds', () => {
  assert.equal(sessionsFor('copilot'), copilot.sessions);
  assert.equal(sessionsOfProject({}), claudeCode.sessions);
  assert.throws(() => sessionsFor('model-x'), /no adapter for the agent "model-x"; the agents are claude-code, copilot/);
});

test('the settings and sessions parts are built; the evaluation runner part is pending', () => {
  assert.equal(isPendingPart(copilot.settings), false);
  assert.equal(isPendingPart(copilot.sessions), false);
  assert.equal(isPendingPart(copilot.evalRunner), true);
});

test('checkAdapter accepts a not-built-yet part only when the adapter lists it as pending', () => {
  assert.deepEqual(checkAdapter({ ...STUBBED, pending: [] }), ['The hooks part is not built yet, and the adapter does not list it as pending']);
  assert.deepEqual(checkAdapter({ ...STUBBED, pending: ['hooks'] }), []);
  const { pending, ...unlisted } = STUBBED;
  assert.equal(checkAdapter(unlisted).length, 1);
  assert.ok(checkAdapter(unlisted).every((line) => /is not built yet, and the adapter does not list it as pending$/.test(line)));
  assert.deepEqual(checkAdapter({ ...STUBBED, pending: ['hooks', 'model-x'] }), ['The adapter lists "model-x" as pending, and that is not a part']);
  // A pending list that isn't a list lists nothing, so the stubs are reported as well.
  assert.deepEqual(checkAdapter({ ...STUBBED, pending: 'hooks' }).slice(0, 1), ["The adapter's pending list must be an array of part names, and it is string"]);
  assert.equal(checkAdapter({ ...STUBBED, pending: 'hooks' }).length, 2);
  // Listing a part that is built is no problem; a stub with the wrong members still is.
  assert.deepEqual(checkAdapter({ ...claudeCode, pending: ['hooks'] }), []);
  assert.deepEqual(checkAdapter({ ...STUBBED, hooks: copilot.hooks, settings: pendingPart('settings', ['project']), pending: ['settings'] }), ['The settings part has no local']);
  // A look-alike object is not a stub.
  assert.equal(isPendingPart({ project: () => {}, local: () => {} }), false);
  assert.equal(isPendingPart(null), false);
});

test('pendingPart refuses a name that is no part and members that are no names', () => {
  assert.throws(() => pendingPart('model-x', ['run']), /not a part of an adapter/);
  assert.throws(() => pendingPart('evalRunner', []), /members must be a list of names/);
  assert.throws(() => pendingPart('evalRunner', [3]), /members must be a list of names/);
  assert.equal(Object.isFrozen(pendingPart('evalRunner', ['run'])), true);
});

// ---- Identity ----

test('Copilot\'s identity names it, gives the tested floor and finds the program on the PATH without running it', () => {
  assert.equal(identity.name, 'copilot');
  assert.equal(identity.label, 'Copilot');
  assert.equal(identity.floor, COPILOT_VERSION);
  assert.equal(copilot.identity, identity);
  // The stand-in's folder, as the only folder on the PATH, is found; finding it starts nothing. The env is built
  // for the call alone, so the test runs the same on every system (a stand-in is a shell script, which shadows
  // nothing on Windows, so there the file is named through `exists`).
  const standIn = path.posix.join('/stand-ins', 'copilot');
  assert.deepEqual(identity.find({ platform: 'linux', env: { PATH: '/stand-ins:/elsewhere' }, exists: (file) => file === standIn }), { found: true, version: null });
  assert.deepEqual(identity.find({ platform: 'linux', env: { PATH: '/elsewhere' }, exists: (file) => file === standIn }), { found: false, version: null });
  assert.deepEqual(stand.calls(), []);
  assert.deepEqual(identity.find({ platform: 'linux', env: { PATH: '/empty' }, exists: () => false }), { found: false, version: null });
  assert.deepEqual(identity.find({ platform: 'linux', env: {}, exists: () => true }), { found: false, version: null });
});

test('on Windows the program is copilot.exe or copilot.cmd on the PATH, whichever case the Path variable is spelt in', () => {
  const dir = tempFolder('wh-copilot-win-');
  const has = (names) => (file) => names.some((n) => file === path.win32.join(dir, n));
  const env = { Path: `C:\\other;${dir}` };
  assert.deepEqual(identity.find({ platform: 'win32', env, exists: has(['copilot.cmd']) }), { found: true, version: null });
  assert.deepEqual(identity.find({ platform: 'win32', env, exists: has(['copilot.exe']) }), { found: true, version: null });
  assert.deepEqual(identity.find({ platform: 'win32', env, exists: has(['copilot']) }), { found: false, version: null });
  assert.deepEqual(identity.find({ platform: 'win32', env: { Path: '' }, exists: () => true }), { found: false, version: null });
});

// ---- Tools ----

test('the tools part names Copilot\'s tools from the union of checks 58, 63 and 66', () => {
  assert.equal(copilot.tools, tools);
  for (const name of ['view', 'glob', 'rg']) assert.ok(tools.read.includes(name), name);
  // Reading, in the sense Claude Code's list means it.
  for (const name of ['web_fetch', 'ask_user', 'read_agent']) assert.ok(tools.read.includes(name), name);
  assert.equal(tools.ask, 'ask_user');
  assert.deepEqual([...tools.shell], ['bash', 'powershell']);
  assert.deepEqual([...tools.notify], []);
  assert.deepEqual([...tools.halt], ['stop_bash']);
});

test('sql takes any statement and was seen to write, so it cannot pass STOP or the lineage hold', () => {
  assert.ok(!tools.read.includes('sql'));
  assert.ok(!tools.halt.includes('sql'));
  assert.ok(!tools.notify.includes('sql'));
  assert.ok(tools.other.includes('sql'));
});

test('every tool seen in checks 58, 63 and 66 has a place, and none that changes or runs things can pass STOP', () => {
  const seen = ['bash', 'view', 'rg', 'glob', 'web_fetch', 'task', 'apply_patch', 'skill', 'read_agent', 'sql', 'multi_tool_use.parallel',
    'edit', 'create', 'powershell', 'ask_user', 'stop_bash'];
  const placed = [...tools.read, ...tools.halt, ...tools.notify, tools.ask, ...tools.shell, ...tools.edit, ...tools.other];
  for (const name of seen) assert.ok(placed.includes(name), `${name} has no place`);
  assert.equal(new Set(placed).size, placed.length - 1, 'only ask_user is in two places (as Claude Code\'s AskUserQuestion is)');
  // What lets a call through while STOP is on or the lineage hold holds: read, halt and notify.
  const passes = [...tools.read, ...tools.halt, ...tools.notify];
  for (const name of ['apply_patch', 'edit', 'create', 'task', 'skill', 'multi_tool_use.parallel', 'bash', 'powershell']) {
    assert.ok(!passes.includes(name), `${name} would pass STOP`);
  }
  assert.deepEqual([...tools.edit], ['apply_patch', 'edit', 'create']);
  for (const list of [tools.read, tools.halt, tools.notify, tools.shell, tools.edit, tools.other]) assert.ok(Object.isFrozen(list));
});

test('Copilot\'s cards bind only from outside the agent, and nothing is packaged into a project yet', () => {
  assert.deepEqual(copilot.cards.binding, ['policy-hook', 'window', 'host']);
  for (const proof of copilot.cards.binding) assert.ok(PROOFS.includes(proof));
  for (const proof of ['chat-click', 'hook-click', 'signed-hook']) assert.ok(!copilot.cards.binding.includes(proof), `${proof} does not bind on Copilot`);
  assert.deepEqual(copilot.packaging.files(), []);
});

// ---- The tool sheet ----

test('the tool sheet names Copilot\'s tools and carries the lines check 63 asked for', () => {
  const sheet = copilotSheet;
  assert.equal(copilot.toolSheet, sheet);
  assert.match(sheet, /Your clickable-question tool is ask_user \(askQuestions in VS Code\)\./);
  assert.match(sheet, /Run commands with bash \(powershell on Windows\)\./);
  assert.match(sheet, /\bdispatch(?:ing)? a sub-agent with `task`/i);
  for (const word of ['name', 'description', 'prompt', 'agent_type', 'mode']) assert.match(sheet, new RegExp(`\`${word}\``), word);
  assert.match(sheet, /A `name` is required/);
  assert.match(sheet, /`read_agent`/);
  assert.match(sheet, /`skill` with \{"skill": "<name>"\}/);
  assert.match(sheet, /`sql` tool's `todos` table/);
  // The playbooks' other general words are answered too (no notification tool was seen in check 58).
  assert.match(sheet, /Your notification tool: none/);
  assert.match(sheet, /Your tool-search tool: none/);
  assert.match(sheet, /Your message tool/);
  // The path comment is for the file, not for a session.
  assert.ok(fs.readFileSync(path.join(ROOT, 'adapters', 'copilot', 'tool-sheet.md'), 'utf8').startsWith('<!-- adapters/copilot/tool-sheet.md -->'));
  assert.doesNotMatch(sheet, /<!--|-->/);
  assert.ok(!sheet.startsWith('\n') && !sheet.endsWith('\n'));
  assert.doesNotMatch(sheet, /AskUserQuestion|PushNotification|SendMessage|ToolSearch/);
});

test('the session start holds each agent\'s sheet, the adapter\'s own', () => {
  for (const name of AGENTS) {
    assert.equal(TOOL_SHEETS[name], adapterFor(name).toolSheet, name);
    assert.equal(SESSION_START_SHEETS[name], adapterFor(name).toolSheet, name);
  }
  assert.equal(SESSION_START_SHEETS, TOOL_SHEETS);
});

test('toolSheetLines gives an unknown agent only the command line, and Copilot its sheet then the command line', () => {
  const pluginRoot = '/plugin/root';
  // The command is built by the settings' own frontDeskCommand, with the flag the running Node.js knows or not, so the
  // test follows the settings; allowedFlags is given in each call so the sheet and the expected line agree on it.
  const allowedFlags = process.allowedNodeEnvironmentFlags;
  const command = `The Wheelhouse command is ${frontDeskCommand(pluginRoot, { platform: 'darwin', noSystemCa: knowsNoSystemCa(allowedFlags) })}`;
  const sheet = (agent, root = pluginRoot) => toolSheetLines(agent, { pluginRoot: root, platform: 'darwin', allowedFlags });
  assert.deepEqual(sheet('model-x'), [command]);
  assert.deepEqual(sheet(undefined), [command]);
  assert.deepEqual(sheet('copilot'), [...copilotSheet.split('\n'), command]);
  // A plugin folder that can't be typed as a command gives the sheet alone.
  assert.deepEqual(sheet('copilot', '/plugin/$root'), copilotSheet.split('\n'));
});

// ---- The safety lines ----

const lines = (options) => safetyLine(options);

test('the safety lines are design section 3.6\'s items, most important first', () => {
  const darwin = lines({ platform: 'darwin' });
  assert.equal(darwin.length, 4);
  assert.match(darwin[0], new RegExp(`runs past ${GUARD_TIMEOUT_SEC} seconds.*within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`));
  assert.match(darwin[1], /Approvals in Copilot's chat aren't proven until check C6 passes/);
  assert.match(darwin[2], /Second looks .* aren't proven until the clean reviewer passes its check/);
  assert.equal(darwin[3], 'Copilot doesn\'t offer Locked');
  assert.deepEqual(lines({ platform: 'linux' }), darwin);
  assert.deepEqual(lines({ platform: 'win32' }), [...darwin, 'On Windows there is no sandbox, so builds run at Standard with Guarded build commands']);
  // No Lean, tier or level wording is left.
  for (const line of lines({ platform: 'win32' })) assert.doesNotMatch(line, /\b(Lean|Middle|Full|add-on|phone)\b/i, line);
});

test('a proven item drops out of the safety lines', () => {
  assert.ok(!lines({ approvalsProven: true }).some((l) => /check C6/.test(l)));
  assert.ok(!lines({ reviewsProven: true }).some((l) => /clean reviewer/.test(l)));
  assert.equal(lines({ approvalsProven: true, reviewsProven: true }).length, 2);
  assert.deepEqual(lines(), lines({ platform: process.platform, approvalsProven: C6_PASSED, reviewsProven: REVIEW_SESSION_READY }));
});

test('every safety line passes plainWords and is one line', () => {
  const glossary = glossaryOf({});
  const seen = new Set();
  for (const platform of ['darwin', 'win32', 'linux']) {
    for (const extra of [{}, { approvalsProven: true }, { reviewsProven: true }]) for (const line of lines({ platform, ...extra })) seen.add(line);
  }
  assert.ok(seen.size >= 5, `${seen.size} lines`);
  for (const line of seen) {
    assert.doesNotMatch(line, /[\r\n]/, line);
    assert.ok(line.length <= LINE_CHARS, `${line.length} characters: ${line}`);
    assert.doesNotMatch(line, /\.$/, 'a line is a phrase with no full stop');
    // The director knows Wheelhouse's own names (All stop, Standard, Locked); with those known, no line is rewritten.
    const out = plainWords(line, glossary, { explanations: 'plain', names: NAMES });
    assert.equal(out.text, line);
    assert.doesNotMatch(plainWords(line, glossary, { explanations: 'plain' }).text, /\n|Terms:/, line);
  }
});

test('a tool Wheelhouse doesn\'t know is named in the update line', () => {
  assert.equal(updateWaiting('new_tool'), 'Copilot has a tool Wheelhouse doesn\'t know yet, `new_tool`: it is refused until Wheelhouse is updated');
});

test('Claude Code\'s adapter has no safety line, and the board\'s registry holds each adapter\'s own', () => {
  assert.deepEqual(claudeCode.safetyLine({}), []);
  assert.equal(copilot.safetyLine, safetyLine);
  for (const name of AGENTS) {
    assert.equal(SAFETY_LINES[name].safetyLine, adapterFor(name).safetyLine, name);
    assert.equal(SAFETY_LINES[name].label, adapterFor(name).identity.label, name);
  }
});

// ---- The board ----

const NOW = new Date('2026-10-23T12:00:00.000Z');
const board = (over = {}) => boardModel({
  project: 'demo', views: null, events: [], usage: null, health: [{ level: 'ok', text: 'Protection: Standard' }], settings: null, sources: null, now: () => NOW, ...over,
});

test('the board\'s health line for a Copilot project names Copilot and its first two safety lines', () => {
  const out = board({ agent: { name: 'copilot', platform: 'darwin' } });
  const first = lines({ platform: 'darwin' }).slice(0, 2);
  assert.deepEqual(out.director.health.map((l) => l.text), ['Protection: Standard', `Copilot: ${first[0]}`, first[1]]);
  assert.equal(out.director.health[1].level, 'watch');
  assert.equal(out.director.health[2].level, 'watch');
  assert.deepEqual(out.missing.filter((m) => /agent/i.test(m)), []);
  // The agent can be given by name alone.
  assert.equal(board({ agent: 'copilot' }).director.health.length, 3);
});

test('a Claude Code project\'s health line is unchanged', () => {
  const plain = board();
  assert.deepEqual(board({ agent: 'claude-code' }).director.health, plain.director.health);
  assert.deepEqual(board({ agent: { name: 'claude-code' } }).director.health, plain.director.health);
  assert.deepEqual(plain.director.health, [{ level: 'ok', text: 'Protection: Standard' }]);
  assert.deepEqual(board({ agent: 'claude-code' }), plain);
});

test('an agent the board does not know is named in what is missing, and the rest of the board stands', () => {
  const out = board({ agent: 'model-x' });
  assert.deepEqual(out.director.health, [{ level: 'ok', text: 'Protection: Standard' }]);
  assert.ok(out.missing.includes('The Logbook\'s agent line couldn\'t be built'));
});

// ---- No host program ran ----

test('none of gh, glab or copilot ran, and the real home was never touched', () => {
  assert.deepEqual(stand.calls(), []);
  const home = process.env.WHEELHOUSE_HOME;
  assert.ok(home);
  assert.ok(fs.realpathSync(home).startsWith(fs.realpathSync(os.tmpdir())), 'the test\'s home is a temporary folder');
  assert.notEqual(path.resolve(home), path.join(os.homedir(), '.wheelhouse'));
});
