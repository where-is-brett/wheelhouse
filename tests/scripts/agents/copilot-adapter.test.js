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
import { glossaryOf, plainWords } from '../../../scripts/frontdesk/glossary.js';
import { frontDeskCommand, knowsNoSystemCa } from '../../../scripts/protection/settings.js';
import { COPILOT_VERSION, GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, LEVELS, PROOFS, TIERS, BOARD_FILE, LEAN_RECORD_DIR } from '../../../scripts/lib/copilot-numbers.js';
import { LINE_CHARS } from '../../../scripts/lib/core-numbers.js';
import claudeCode from '../../../adapters/claude-code/index.js';
import copilot from '../../../adapters/copilot/index.js';
import tools from '../../../adapters/copilot/tools.js';
import safetyLine from '../../../adapters/copilot/safety-line.js';
import copilotSheet from '../../../adapters/copilot/tool-sheet.js';
import identity from '../../../adapters/copilot/identity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The sessions part left the list in Part 8 Task 1 (ruling P8-1): built, and switched off by its own switch.
const PENDING = ['settings', 'evalRunner'];

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
  for (const part of PENDING) {
    for (const [member, fn] of Object.entries(copilot[part])) {
      assert.equal(typeof fn, 'function');
      assert.throws(() => fn(), (error) => error.code === NOT_BUILT_YET && error.part === part && error.message.includes(`The ${part} part`) && error.message.includes(member), `${part}.${member}`);
    }
  }
  // The sessions part is built: the contract's six members, and the four the waker asks for when they are there.
  assert.equal(isPendingPart(copilot.sessions), false);
  assert.deepEqual(Object.keys(copilot.sessions).sort(), ['afterRun', 'checkFeature', 'checkForeman', 'featureResumeCall', 'featureStartCall', 'finalAnswer', 'foremanCall', 'grantProofs', 'prepare', 'pruneActivity']);
});

test('sessionsFor gives the very object the Copilot adapter holds', () => {
  assert.equal(sessionsFor('copilot'), copilot.sessions);
  assert.equal(sessionsOfProject({}), claudeCode.sessions);
  assert.throws(() => sessionsFor('model-x'), /no adapter for the agent "model-x"; the agents are claude-code, copilot/);
});

test('checkAdapter accepts a not-built-yet part only when the adapter lists it as pending', () => {
  assert.deepEqual(checkAdapter({ ...copilot, pending: PENDING.filter((p) => p !== 'settings') }), ['The settings part is not built yet, and the adapter does not list it as pending']);
  const { pending, ...unlisted } = copilot;
  assert.equal(checkAdapter(unlisted).length, PENDING.length);
  assert.ok(checkAdapter(unlisted).every((line) => /is not built yet, and the adapter does not list it as pending$/.test(line)));
  assert.deepEqual(checkAdapter({ ...copilot, pending: [...PENDING, 'model-x'] }), ['The adapter lists "model-x" as pending, and that is not a part']);
  // A pending list that isn't a list lists nothing, so the stubs are reported as well.
  assert.deepEqual(checkAdapter({ ...copilot, pending: 'hooks' }).slice(0, 1), ["The adapter's pending list must be an array of part names, and it is string"]);
  assert.equal(checkAdapter({ ...copilot, pending: 'hooks' }).length, 1 + PENDING.length);
  // Listing a part that is built is no problem; a stub with the wrong members still is.
  assert.deepEqual(checkAdapter({ ...claudeCode, pending: ['hooks'] }), []);
  assert.deepEqual(checkAdapter({ ...copilot, settings: pendingPart('settings', ['project']) }), ['The settings part has no local']);
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
  if (process.platform !== 'win32') assert.deepEqual(identity.find({ platform: process.platform, env: { PATH: stand.dir } }), { found: true, version: null });
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

test('Copilot\'s cards bind only from outside the agent, and its packaging is what Lean\'s setup writes in a project', () => {
  assert.deepEqual(copilot.cards.binding, ['policy-hook', 'window', 'add-on', 'host']);
  for (const proof of copilot.cards.binding) assert.ok(PROOFS.includes(proof));
  for (const proof of ['chat-click', 'hook-click', 'signed-hook']) assert.ok(!copilot.cards.binding.includes(proof), `${proof} does not bind on Copilot`);
  // The first commit's list (setup-lean's block "first-commit"): the board is ignored and never committed, and no
  // .claude/wheelhouse.json is written at Lean. The setup-lean test holds the block to this same list.
  assert.deepEqual(copilot.packaging.files(), ['.gitignore', '.vscode/settings.json', `${LEAN_RECORD_DIR}/.gitkeep`]);
  assert.ok(!copilot.packaging.files().includes(BOARD_FILE));
  const first = copilot.packaging.files();
  first.length = 0;
  assert.equal(copilot.packaging.files().length, 3);
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

test('at Lean with nothing added the line says approvals are not proven and STOP is not enforced', () => {
  const out = lines({ tier: 'lean', platform: 'darwin' });
  assert.equal(out[0], 'Nothing is held off this computer except the copy in your folder');
  assert.equal(out[1], 'Approvals are clicks in the chat, recorded as not proven');
  assert.ok(out.includes('STOP isn\'t enforced: agents are told to stop, and VS Code\'s stop button ends the running request'));
  assert.ok(out.includes('Copilot\'s command prompts aren\'t a control'));
  assert.ok(out.includes('Tests and second looks at a change aren\'t independent of the agent that built it'));
  assert.ok(out.includes('Not for projects with real users'));
  assert.ok(out.includes('A command you allow can change anything Wheelhouse keeps, history and record included'));
  // Nothing was added, so no guard runs and none can time out.
  assert.ok(!out.some((line) => /time-out|seconds/.test(line)));
  assert.deepEqual(lines({ platform: 'darwin' }), out, 'Lean is the default tier');
});

test('at Lean without Node.js the guard line follows the system and whether the kit holds a shell guard', () => {
  const mac = lines({ tier: 'lean', platform: 'darwin' });
  assert.ok(mac.includes('No Wheelhouse guards run on this computer yet'));
  const macGuard = lines({ tier: 'lean', platform: 'darwin', shellGuard: true });
  // Ruling P5-35: what the shell guard keeps, in the line's own words.
  assert.ok(macGuard.includes('Wheelhouse\'s shell guard runs on this Mac: it keeps the files that steer agents, and refuses a tool it doesn\'t know'));
  assert.ok(!macGuard.includes('No Wheelhouse guards run on this computer yet'));
  // The shell guard still answers inside the time Copilot allows, so the time-out sentence is there.
  assert.ok(macGuard.includes(`Copilot lets a guard through if it runs past ${GUARD_TIMEOUT_SEC} seconds, so every guard answers within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`));
  const windows = lines({ tier: 'lean', platform: 'win32', shellGuard: true });
  assert.ok(windows.includes('No Wheelhouse guards run on Windows without Node.js, until a way is found'));
  assert.ok(!windows.some((line) => /shell guard/.test(line)), 'the shell guard is the Mac\'s only (check 69)');
  assert.ok(!windows.some((line) => /time-out|seconds/.test(line)));
  // The approvals and STOP lines are the same on both systems.
  assert.deepEqual(windows.slice(0, 2), mac.slice(0, 2));
  assert.ok(lines({ tier: 'lean', platform: 'linux' }).includes('No Wheelhouse guards run on this computer without Node.js'));
});

test('at Lean with the helper or the add-on, approvals and STOP are no longer the bare chat\'s', () => {
  const node = lines({ tier: 'lean', platform: 'darwin', node: true, helper: true });
  assert.equal(node[0], 'Nothing is held off this computer except the copy in your folder');
  assert.ok(!node.includes('Approvals are clicks in the chat, recorded as not proven'));
  assert.ok(node.includes('Everyday approvals are clicks in the chat; the steps that matter most are confirmed outside it'));
  assert.ok(!node.includes('STOP isn\'t enforced: agents are told to stop, and VS Code\'s stop button ends the running request'));
  assert.ok(node.includes('STOP is enforced by Wheelhouse\'s guards, which run as Copilot hooks'));
  assert.ok(node.includes(`Copilot lets a guard through if it runs past ${GUARD_TIMEOUT_SEC} seconds, so every guard answers within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`));
  assert.ok(!node.some((line) => /^No Wheelhouse guards|shell guard/.test(line)));
  const addOn = lines({ tier: 'lean', platform: 'win32', addOn: true });
  assert.ok(addOn.includes('Everyday approvals are clicks in the chat; the steps that matter most are confirmed outside it'));
  assert.ok(addOn.includes('STOP is enforced by the add-on, which also cancels the chat\'s running request'));
  // The things Lean never holds are said whatever is added.
  for (const out of [node, addOn]) {
    for (const line of ['Copilot\'s command prompts aren\'t a control', 'Tests and second looks at a change aren\'t independent of the agent that built it', 'Not for projects with real users']) assert.ok(out.includes(line), line);
  }
});

test('at Lean the helper\'s lines follow whether the helper answers, never whether Node.js runs (ruling P5-31)', () => {
  const helperBlock = lines({ tier: 'lean', platform: 'darwin', node: true, helper: true });
  assert.ok(helperBlock.includes('STOP is enforced by Wheelhouse\'s guards, which run as Copilot hooks'));
  // Node.js runs but no helper answers: the lines of a computer with no guard, on either system.
  const macNode = lines({ tier: 'lean', platform: 'darwin', node: true, helper: false });
  assert.deepEqual(macNode, lines({ tier: 'lean', platform: 'darwin', node: false }));
  const winNode = lines({ tier: 'lean', platform: 'win32', node: true });
  assert.ok(winNode.includes('No Wheelhouse guards run on this computer yet'), 'where Node.js runs, Windows waits only for the helper');
  assert.ok(!winNode.some((line) => /without Node\.js/.test(line)));
  assert.ok(winNode.includes('Approvals are clicks in the chat, recorded as not proven'));
  assert.ok(winNode.includes('STOP isn\'t enforced: agents are told to stop, and VS Code\'s stop button ends the running request'));
  assert.ok(!winNode.some((line) => /time-out|seconds/.test(line)));
  // Without Node.js the Windows line stays as it was.
  assert.ok(lines({ tier: 'lean', platform: 'win32', node: false }).includes('No Wheelhouse guards run on Windows without Node.js, until a way is found'));
  // The helper answering is the helper's block whatever `node` says, on Windows as on the Mac.
  assert.deepEqual(lines({ tier: 'lean', platform: 'win32', node: true, helper: true }), helperBlock);
  assert.deepEqual(lines({ tier: 'lean', platform: 'darwin', helper: true }), helperBlock);
});

// Spec section 6.6's ten items, by the first words each line must begin or contain.
const ITEMS = {
  1: /^Without Copilot's sandbox, /,
  2: /^Your sign-ins and Wheelhouse's keys stay on this computer/,
  3: /^The approval check, the second looks at changes and the activity record run on this computer/,
  4: /^Copilot's permission rules are rules, not a fence/,
  5: /^At Standard, Wheelhouse's hooks run beside the agent/,
  6: /network/,
  7: /^You can lower the level/,
  8: /^Phone STOP isn't available/,
  9: /^Wheelhouse can't pin VS Code/,
  10: /^Your company's own settings win/,
};
const itemsIn = (out) => Object.entries(ITEMS).filter(([, pattern]) => out.some((line) => pattern.test(line))).map(([n]) => Number(n));

test('at Middle on Windows at Guarded every 6.6 item that applies is given, item 8 only while no phone route exists', () => {
  const out = lines({ tier: 'middle', level: 'guarded', platform: 'win32', node: true });
  assert.deepEqual(itemsIn(out), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(out.length, 10, 'one line per item');
  assert.equal(out[0], 'Without Copilot\'s sandbox, at Guarded the network is open and only labelled folders are unreadable to builds');
  assert.ok(out.includes('On Windows nothing on this computer holds the network against a program that connects directly'));
  assert.ok(out.includes(`Copilot's permission rules are rules, not a fence; a guard that runs past ${GUARD_TIMEOUT_SEC} seconds is let through, so every guard answers within ${GUARD_DEADLINE_MS / 1000} seconds or refuses`));
  // Lean's lines don't apply once a code host holds a copy.
  assert.ok(!out.some((line) => /Nothing is held off|chat, recorded as not proven|Not for projects with real users/.test(line)));
  const withPhone = lines({ tier: 'middle', level: 'guarded', platform: 'win32', node: true, phoneStop: true });
  assert.deepEqual(itemsIn(withPhone), [1, 2, 3, 4, 5, 6, 7, 9, 10]);
});

test('item 1 follows the level and the sandbox, and item 6 follows the system', () => {
  const at = (level, extra = {}) => lines({ tier: 'middle', level, platform: 'darwin', ...extra });
  assert.ok(at('ask')[0].startsWith('Without Copilot\'s sandbox, at Ask a command you allowed can do whatever your account can, and leave lasting changes'));
  assert.ok(at('unattended')[0].startsWith('Without Copilot\'s sandbox, at Unattended nothing holds on this computer'));
  // With the sandbox in use the item doesn't apply, and the next one comes first.
  for (const out of [at('sandbox'), at('guarded', { sandbox: true })]) {
    assert.ok(!itemsIn(out).includes(1));
    assert.match(out[0], ITEMS[2]);
  }
  assert.ok(at('sandbox').includes('The network is narrowed only by Copilot\'s sandbox, and listed hosts could still carry code out'));
  assert.ok(lines({ tier: 'full', level: 'sandbox', platform: 'linux' }).includes('Nothing on this computer holds the network against a program that connects directly'));
  // Full gives the same items as Middle for the same level and system.
  assert.deepEqual(lines({ tier: 'full', level: 'ask', platform: 'darwin' }), at('ask'));
  // A level left out is the one every computer can have.
  assert.deepEqual(lines({ tier: 'middle', platform: 'darwin' }), at('ask'));
});

test('a tier or level that is not one is refused', () => {
  assert.throws(() => lines({ tier: 'gold' }), /not a tier/);
  assert.throws(() => lines({ tier: 'middle', level: 'open' }), /not a level/);
  assert.throws(() => lines({ tier: 'lean', level: 'open' }), /not a level/);
  assert.deepEqual(TIERS, ['lean', 'middle', 'full']);
});

test('every safety line passes plainWords and is one line', () => {
  const glossary = glossaryOf({});
  const seen = new Set();
  for (const tier of TIERS) {
    for (const level of tier === 'lean' ? [undefined] : LEVELS) {
      for (const platform of ['darwin', 'win32', 'linux']) {
        for (const extra of [{}, { node: true }, { addOn: true }, { shellGuard: true }, { sandbox: true }, { phoneStop: true }]) {
          for (const line of lines({ tier, level, platform, ...extra })) seen.add(line);
        }
      }
    }
  }
  assert.ok(seen.size > 20, `${seen.size} lines`);
  for (const line of seen) {
    assert.doesNotMatch(line, /[\r\n]/, line);
    assert.ok(line.length <= LINE_CHARS, `${line.length} characters: ${line}`);
    assert.doesNotMatch(line, /\.$/, 'a line is a phrase with no full stop');
    // Plain words: any glossary term in it is explained in place, never left bare under a Terms line.
    // The director knows Wheelhouse's own names (STOP, Standard, Locked); with those known, no line is rewritten
    // and none carries a Terms footer, so what the director reads is what the adapter says.
    const out = plainWords(line, glossary, { explanations: 'plain', known: ['STOP', 'Standard', 'Locked'] });
    assert.equal(out.text, line);
    // Without them, a name is explained in place and the line is still one line.
    assert.doesNotMatch(plainWords(line, glossary, { explanations: 'plain' }).text, /\n|Terms:/, line);
  }
});

test('Claude Code\'s adapter has no safety line, and the board\'s registry holds each adapter\'s own', () => {
  assert.deepEqual(claudeCode.safetyLine({ tier: 'lean' }), []);
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
  const out = board({ agent: { name: 'copilot', tier: 'lean', platform: 'darwin' } });
  const first = lines({ tier: 'lean', platform: 'darwin' }).slice(0, 2);
  assert.deepEqual(out.director.health.map((l) => l.text), [
    'Protection: Standard',
    `Copilot: ${first[0]}`,
    first[1],
  ]);
  assert.equal(out.director.health[1].level, 'watch');
  assert.equal(out.director.health[2].level, 'watch');
  assert.deepEqual(out.missing.filter((m) => /agent/i.test(m)), []);
  // At Middle the first two are the first two that apply.
  const middle = board({ agent: { name: 'copilot', tier: 'middle', level: 'guarded', platform: 'win32', node: true } });
  const two = lines({ tier: 'middle', level: 'guarded', platform: 'win32', node: true }).slice(0, 2);
  assert.deepEqual(middle.director.health.slice(1).map((l) => l.text), [`Copilot: ${two[0]}`, two[1]]);
  // The agent can be given by name alone, which is Lean with nothing added.
  assert.deepEqual(board({ agent: 'copilot' }).director.health.slice(1).map((l) => l.text), [`Copilot: ${first[0]}`, first[1]]);
});

test('a Claude Code project\'s health line is unchanged', () => {
  const plain = board();
  assert.deepEqual(board({ agent: 'claude-code' }).director.health, plain.director.health);
  assert.deepEqual(board({ agent: { name: 'claude-code', tier: 'lean' } }).director.health, plain.director.health);
  assert.deepEqual(plain.director.health, [{ level: 'ok', text: 'Protection: Standard' }]);
  assert.deepEqual(board({ agent: 'claude-code' }), plain);
});

test('an agent the board does not know is named in what is missing, and the rest of the board stands', () => {
  const out = board({ agent: 'model-x' });
  assert.deepEqual(out.director.health, [{ level: 'ok', text: 'Protection: Standard' }]);
  assert.ok(out.missing.includes('The board\'s agent line couldn\'t be built'));
  // A tier that is no tier does the same, and never throws.
  assert.ok(board({ agent: { name: 'copilot', tier: 'gold' } }).missing.includes('The board\'s agent line couldn\'t be built'));
});

// ---- No host program ran ----

test('none of gh, glab or copilot ran, and the real home was never touched', () => {
  assert.deepEqual(stand.calls(), []);
  const home = process.env.WHEELHOUSE_HOME;
  assert.ok(home);
  assert.ok(fs.realpathSync(home).startsWith(fs.realpathSync(os.tmpdir())), 'the test\'s home is a temporary folder');
  assert.notEqual(path.resolve(home), path.join(os.homedir(), '.wheelhouse'));
});
