// vscode/chat-tools.cjs
// The chat's way in to Wheelhouse's state, which binds nothing: two chat tools, an inbox folder for where a company switches
// tools off, and a record of the terminal commands the window runs. A click made through any of these is recorded by the
// helper's /cards/chat-click as a non-binding `chat-click`; nothing here signs, presses or lifts anything, and the proof is
// never taken from the chat (scripts/addon/validate.js holds this file to it, and tests/vscode/chat-tools.test.js).
//
// Key names, read on 2 November 2026 from https://code.visualstudio.com/api/extension-guides/tools (the tools guide):
//   contributes.languageModelTools (name, toolReferenceName, displayName, modelDescription, inputSchema, canBeReferencedInPrompt),
//   vscode.lm.registerTool, vscode.LanguageModelToolResult, vscode.LanguageModelTextPart.
// And from https://code.visualstudio.com/api/references/vscode-api: window.onDidStartTerminalShellExecution, whose event
// carries `execution.commandLine`; this file reads `commandLine.value` (the page shows the property as a command line
// object; the name `value` is not confirmed there, so a plain string is accepted too).
// The terminal record holds every shell execution the window starts, not only the chat's (the event does not say who
// typed it); it lives in Wheelhouse's state folder for the project, never in the workspace.
// All stop cancelling the chat's running request: no way to do it has been found (check 72), so cancelChatRequest below is
// a hook point that does nothing, not a guess at an API.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The scripts this loads, relative to the add-on's `wheelhouse/` folder. The pack walks their imports (scripts/addon/pack.js).
const CHAT_LOADS = Object.freeze({ rules: 'scripts/agents/chat-clicks.js', secrets: 'scripts/state/secret-scan.js' });

// The rules a click is held to and the secret scan, from the add-on's own copy of the scripts; {} where they can't be loaded.
async function loadRules(root) {
  try {
    const { pathToFileURL } = require('node:url');
    const [rules, secrets] = await Promise.all(Object.values(CHAT_LOADS).map((rel) => import(pathToFileURL(path.join(root, rel)).href)));
    return { rules: { hash: rules.CARD_HASH, steps: rules.CONFIRMED_STEPS }, scan: secrets.scanText };
  } catch {
    return {};
  }
}

const RECORD_TOOL = 'wheelhouse_record';
const BOARD_TOOL = 'wheelhouse_board';
const PROOF = 'chat-click';
const INBOX = path.join('.wheelhouse', 'inbox');
const COMMANDS_NAME = 'terminal-commands.jsonl';
// The most an inbox file or a field may hold.
const FILE_BYTES = 16384;
// The terminal record is trimmed to its newest half when it grows past this.
const RECORD_BYTES = 262144;
const HELD_BACK = '[held back: it looked like it held a secret]';
// The rules the helper's /cards/chat-click holds a click to (scripts/host/helper.js doChatClick, scripts/agents/chat-clicks.js):
// a card's hash is its sha256 in full, and these steps are confirmed outside the chat. desk.cjs passes the scripts' own;
// these are the same values for where they were not loaded, and a test holds them to the scripts'.
const CARD_HASH = /^[0-9a-f]{64}$/;
const CONFIRMED_STEPS = Object.freeze(['lift-stop', 'guardrail-change', 'unattended', 'runbook-step', 'ci-push', 'ask-allowance']);
// A card a click in the chat could bind (a Lean merge, a guardrail change, a ruling's confirmation, a confirmed step) is
// never one these tools answer; only a plain question's answer is recorded here.
const BINDING = /^(?:merge|guardrail|ruling)-/;
const REFUSED_BINDING = 'That card can bind something, so it is answered only with its button in the Wheelhouse pane, not from the chat.';
const BAD_HASH = 'Nothing was recorded: the card\'s hash must be its full sha256 as the board shows it.';

function bindsSomething(card, steps = CONFIRMED_STEPS) {
  return BINDING.test(card) || steps.some((step) => card === step || card.startsWith(`${step}-`));
}
const FIELD_CHARS = 4000;
const COMMAND_CHARS = 500;

const text = (value, max = FIELD_CHARS) => (typeof value === 'string' ? value.slice(0, max) : '');

// The one place a chat tool or an inbox file becomes a click. Only these fields are passed on; the proof is always
// chat-click, whatever the input names, and no signature or record travels with it.
async function recordClick({ client, project, folder, input, rules = {} }) {
  const card = text(input?.card, 200);
  const hash = text(input?.hash, 200);
  const label = text(input?.label, 200);
  if (typeof project !== 'string' || project === '' || card === '' || hash === '' || label === '') return { ok: false, says: 'Nothing was recorded: a click needs a card, its hash and a button.' };
  if (!(rules.hash ?? CARD_HASH).test(hash)) return { ok: false, says: BAD_HASH };
  if (bindsSomething(card, rules.steps)) return { ok: false, says: REFUSED_BINDING };
  const commit = text(input?.commit, 200);
  const words = text(input?.text);
  try {
    const got = await client.cards.chatClick({
      project, ...(typeof folder === 'string' ? { cwd: folder } : {}), card, hash, label, proof: PROOF,
      ...(commit === '' ? {} : { commit }), ...(words === '' ? {} : { text: words }),
    });
    return got?.ok === true ? { ok: true, says: 'Recorded as a click in the chat. It does not approve anything by itself.' } : { ok: false, says: `Nothing was recorded${typeof got?.refused === 'string' ? `: ${got.refused}` : ''}.` };
  } catch {
    return { ok: false, says: 'Nothing was recorded: the helper could not be reached.' };
  }
}

// The cards on the board as the chat may see them: what each is, its id and hash (to name it in a click), and its buttons.
function boardText(pane) {
  const cards = Array.isArray(pane?.cards) ? pane.cards : [];
  if (cards.length === 0) return typeof pane?.verdict === 'string' ? pane.verdict : 'Nothing is on the board.';
  return cards.map((c) => `${c.id} (hash ${c.hash}): ${c.header ?? ''}. ${c.text ?? ''} Buttons: ${(Array.isArray(c.buttons) ? c.buttons : []).map((b) => b?.label).filter(Boolean).join(', ')}`).join('\n');
}

// Registers the two chat tools. `client` is the helper's; `desk` reads the board. The tools press nothing.
function registerChatTools({ vscode, client, desk, project, folder, subscriptions, rules }) {
  if (typeof vscode?.lm?.registerTool !== 'function') return [];
  const result = (message) => {
    const part = vscode.LanguageModelTextPart ? new vscode.LanguageModelTextPart(message) : { value: message };
    return vscode.LanguageModelToolResult ? new vscode.LanguageModelToolResult([part]) : { content: [part] };
  };
  const projectNow = () => (typeof project === 'function' ? project() : project);
  const made = [
    vscode.lm.registerTool(RECORD_TOOL, {
      async invoke(options) {
        const got = await recordClick({ client, project: projectNow(), folder, input: options?.input, rules });
        return result(got.says);
      },
    }),
    vscode.lm.registerTool(BOARD_TOOL, {
      async invoke() {
        try {
          const got = await desk?.read('glance', { pane: true, helperUp: true, at: new Date().toISOString() });
          if (got?.ok === true && got.data?.pane) return result(boardText(got.data.pane));
        } catch { /* Said below. */ }
        return result('The board could not be read just now.');
      },
    }),
  ];
  if (Array.isArray(subscriptions)) subscriptions.push(...made);
  return made;
}

// The text of a plain file at most FILE_BYTES long, or null: opened without following a link, checked on the open file.
function readCapped(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > FILE_BYTES) return null;
    const buffer = Buffer.alloc(FILE_BYTES + 1);
    const got = fs.readSync(fd, buffer, 0, FILE_BYTES + 1, 0);
    return got > FILE_BYTES ? null : buffer.toString('utf8', 0, got);
  } finally {
    fs.closeSync(fd);
  }
}

// Reads the inbox once: each file is removed as it is read, and is a click only the way a chat tool's is, as a chat-click.
// An inbox file can't approve: the same fields, the same proof, nothing signed. Files over the size, links and anything but
// a plain .json file are removed without being read.
async function drainInbox({ folder, client, project, rules }) {
  const dir = typeof folder === 'string' ? path.join(folder, INBOX) : null;
  const out = { read: 0, recorded: 0 };
  if (dir === null) return out;
  let names;
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    const file = path.join(dir, name);
    let body = null;
    try {
      const stat = fs.lstatSync(file);
      // Only a plain .json file is opened, never followed through a link, and read up to the size cap from the open file.
      if (stat.isFile() && name.endsWith('.json')) body = readCapped(file);
      fs.rmSync(file, { force: true, recursive: stat.isDirectory() });
    } catch { continue; }
    out.read += 1;
    let input = null;
    try { input = body === null ? null : JSON.parse(body); } catch { input = null; }
    if (input === null || typeof input !== 'object') continue;
    if ((await recordClick({ client, project, folder, input, rules })).ok) out.recorded += 1;
  }
  return out;
}

// Records each terminal command the window starts (the chat's among them: the event does not say who typed it).
function watchTerminal({ vscode, record, now = () => new Date() }) {
  if (typeof vscode?.window?.onDidStartTerminalShellExecution !== 'function') return null;
  return vscode.window.onDidStartTerminalShellExecution((event) => {
    try {
      const line = event?.execution?.commandLine;
      const command = text(typeof line === 'string' ? line : line?.value, COMMAND_CHARS);
      if (command !== '') record({ at: now().toISOString(), command });
    } catch { /* A record is not a need. */ }
  });
}

// Appends a recorded command to `file` (in Wheelhouse's state folder for the project). A command that looks like it holds
// a secret (`scan`, the state's own secret scan) is written as a held-back note instead. The file is trimmed to its newest
// half past RECORD_BYTES. A failure to write is swallowed: it never reaches the terminal.
function commandFile(file, { scan = () => [] } = {}) {
  return (line) => {
    try {
      if (typeof file !== 'string' || file === '') return;
      const held = scan(line.command).length > 0;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify({ at: line.at, command: held ? HELD_BACK : line.command })}\n`);
      if (fs.statSync(file).size > RECORD_BYTES) {
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        fs.writeFileSync(file, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`);
      }
    } catch { /* A record is not a need. */ }
  };
}

// The hook point for All stop to cancel the chat's running request. No way is known (check 72): it does nothing.
async function cancelChatRequest() {}

module.exports = { CHAT_LOADS, loadRules, RECORD_TOOL, BOARD_TOOL, INBOX, COMMANDS_NAME, RECORD_BYTES, HELD_BACK, CARD_HASH, CONFIRMED_STEPS, REFUSED_BINDING, BAD_HASH, bindsSomething, recordClick, boardText, registerChatTools, drainInbox, watchTerminal, commandFile, cancelChatRequest };
