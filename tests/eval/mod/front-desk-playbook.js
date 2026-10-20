// tests/eval/mod/front-desk-playbook.js
// What the mod's two scenarios (36, the pane's press, and 37, the courier's wake) share: the
// front desk under its own playbook (skills/front-desk/SKILL.md) and its own command
// (scripts/frontdesk/cli.js), in a project's main checkout, against the stand-in helper; the
// cards waiting, composed by that command's `card`; the prompts the bridge submits; and reading
// what the session did from its stream-json events and the events it wrote.
//
// The set-up: scripts/eval/front-desk.js makes the project's main checkout and starts the
// stand-in helper with the scenario's events (its `without` set-up, so its own scratch plugin,
// which holds the front desk's files and hooks, is not made). Then a scratch plugin named `wheelhouse` holds
// the front desk's playbook, the intake skill and the front desk's command, a thin file that runs
// the repository's scripts/frontdesk/cli.js; the session's system prompt carries the session
// start's front desk line, as the session-start hook would add it. **With** the playbook as it
// stands; **without**, the same playbook less the section on the pane's and the courier's prompts
// (THE_LINES), so the two variants differ only by those lines.
//
// The cards. A `claude -p` session has AskUserQuestion only when it is started with
// `--permission-prompt-tool stdio` (Claude Code 2.1.302), so each scenario passes that flag
// (EXTRA_ARGS). With no host on the other end the question can't be answered, so the project's
// local settings hold a PreToolUse hook that stands in for the director's screen: it turns the
// call away with one line saying the cards were shown (SHOWN), as Desktop shows them while the
// director hasn't clicked. The call is in the events either way.
//
// The notification. Every evaluation session is denied PushNotification (ruling F90), but 37 tests
// that very call, so it is offered it (its `offered`, ruling F99), and its set-up (`push`) adds a
// PreToolUse hook in the same local settings that turns the call away with one line (PUSHED): the
// call is in the events and nothing reaches the director's phone. 37's not-sent legs have it answer
// with the app's own "Not sent" words instead (NOT_SENT), as when the director has just been active.
// runSession offers the tool only when that hook is the harness's own, which fails closed (ruling F107).
//
// The sandbox (rulings F94, F102): the plugin's command imports the repository's own cli.js, which
// the sandbox denies, so the context names what that command needs of the repository as
// `readable` (repositoryReadable), and nothing else of it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, callsOf, repositoryReadable } from '../../../scripts/eval/feature-project.js';
import { seedEvent, setUpFrontDesk, writtenEvents } from '../../../scripts/eval/front-desk.js';
import { standInViews } from '../../../scripts/eval/stand-in-helper.js';
import { assertUnderTmp } from '../../../probes/lib/scratch.js';
import { card as composeWithCli } from '../../../scripts/frontdesk/cli.js';
import { asQuestion } from '../../../scripts/cards/visit.js';
import { numberedWaiting } from '../../../scripts/board/model.js';
import { FRONT_DESK_LINE } from '../../../scripts/hooks/session-start.js';
import { PROTECTED_KINDS } from '../../../scripts/state/events.js';
import { TURNED_AWAY, turnAwayEntry, turnAwayScript } from '../../../scripts/eval/harness.js';

// The heading of the playbook's section on the pane's and the courier's prompts: the lines the
// `without` variant leaves out, up to the next heading of the same or a higher level.
export const THE_LINES = '### The pane and the courier';

export const EXTRA_ARGS = Object.freeze(['--permission-prompt-tool', 'stdio']);

// What the stand-in for the director's screen answers an AskUserQuestion call.
export const SHOWN = 'Shown to the director.';

// What the stand-in for the director's phone answers a PushNotification call.
export const PUSHED = TURNED_AWAY.PushNotification;

// A pull request's head commit, as the stand-in host gives it to `card`.
export const HEAD = '3f9c2a1b7d4e5f60718293a4b5c6d7e8f9012345';

// The playbook as the variant loads it. `without` leaves out THE_LINES' section, and is the
// playbook as it stands when the section isn't written yet.
export function playbookFor(variant, text = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'front-desk', 'SKILL.md'), 'utf8')) {
  const start = text.indexOf(`\n${THE_LINES}\n`);
  if (variant === 'with') return text;
  if (start < 0) return text;
  const rest = text.slice(start + 1);
  const next = rest.search(/\n#{1,3} /);
  return next < 0 ? text.slice(0, start + 1) : `${text.slice(0, start + 1)}${rest.slice(next + 1)}`;
}

// A card as `cli.js card` composes it, in the glossary's plain words, against a helper with
// nothing waiting: the card event's data.
export async function composedCard(input) {
  const writes = [];
  const client = {
    state: {
      views: async () => ({ ok: true, views: { waiting: [], glossary: {} } }),
      write: async (body) => { writes.push(body); return { ok: true, id: body.id ?? crypto.randomUUID(), pushed: true }; },
    },
    prState: async () => ({ ok: true, result: { headSha: HEAD, state: 'open' } }),
  };
  await composeWithCli({ client, cwd: '/projects/shop', input, now: () => new Date('2026-10-20T07:00:00.000Z') });
  const made = writes.find((w) => w.kind === 'card');
  if (!made) throw new Error('cli.js card wrote no card');
  return made.data;
}

// The waiting cards' events: each card at its time under its own id, and, for each one already
// asked, the `asked` record a visit wrote a minute later. `cards` are { id, at, input, asked }.
export async function seedCards(cards) {
  const seed = [];
  const made = [];
  for (const { id, at, input, asked } of cards) {
    const data = await composedCard(input);
    seed.push({ ...seedEvent('card', data, at), id });
    if (asked) seed.push(seedEvent('asked', { cards: [id] }, new Date(Date.parse(at) + 60000).toISOString()));
    made.push({ id, data });
  }
  return { seed, cards: made };
}

// The number the board gives each card, from the events as the stand-in helper's views build them.
export function boardNumbers(seed) {
  const views = standInViews(seed);
  return Object.fromEntries(numberedWaiting(views, seed).filter((item) => item.card).map((item) => [item.card, item.n]));
}

function write(root, relative, content) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// Sets `dir` up for the front desk under its playbook, with `seed` in the stand-in helper's
// state, `pullRequests` open on the stand-in host ({ number: head }) and `files` committed on
// main; with `push`, the phone's hook too, for a scenario offered
// PushNotification: `true` answers PUSHED, and a string answers that (NOT_SENT, say). Resolves
// with the context runScenario takes.
export async function setUpPlaybook(dir, variant, { files = {}, seed = [], push = false, pullRequests = {} } = {}) {
  const context = await setUpFrontDesk(dir, 'without', { files, seed, pullRequests });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-eval-mod-'));
  try {
    assertUnderTmp(root);
    const plugin = path.join(root, 'plugin');
    // The command's file is a module, whichever Node the session's shell finds first.
    write(plugin, 'package.json', `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`);
    write(plugin, '.claude-plugin/plugin.json', `${JSON.stringify({ name: 'wheelhouse', version: '0.0.0', description: 'Wheelhouse\'s front desk: its playbook, the intake and its command, for one evaluation run.' }, null, 2)}\n`);
    write(plugin, 'skills/front-desk/SKILL.md', playbookFor(variant));
    write(plugin, 'skills/intake/SKILL.md', fs.readFileSync(path.join(REPO_ROOT, 'skills', 'intake', 'SKILL.md'), 'utf8'));
    const cli = pathToFileURL(path.join(REPO_ROOT, 'scripts', 'frontdesk', 'cli.js')).href;
    write(plugin, 'scripts/frontdesk/cli.js', `// scripts/frontdesk/cli.js\nimport { main } from '${cli}';\nmain(process.argv.slice(2)).then((code) => { process.exitCode = code; });\n`);
    // The hooks turn every call away and fail closed (turnAwayScript, turnAwayEntry): the screen's
    // saying the cards were shown, since no one is there to click; the phone's saying it was sent,
    // or that it wasn't.
    const hook = path.join(root, 'ask-shown.mjs');
    fs.writeFileSync(hook, turnAwayScript(SHOWN), 'utf8');
    const phone = path.join(root, 'push-sent.mjs');
    if (push) fs.writeFileSync(phone, turnAwayScript(push === true ? PUSHED : push), 'utf8');

    // The local settings setUpFrontDesk wrote, with reading the plugin's files, the screen's hook
    // and, with `push`, the phone's.
    const settingsFile = path.join(dir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    for (const at of new Set([plugin, fs.realpathSync(plugin)])) settings.permissions.allow.push(`Read(/${at.split(path.sep).join('/')}/**)`);
    settings.hooks = {
      PreToolUse: [
        turnAwayEntry('AskUserQuestion', hook),
        ...(push ? [turnAwayEntry('PushNotification', phone)] : []),
      ],
    };
    fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

    const close = async () => {
      try {
        await context.close();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    };
    // The Node running the evaluation first on the session's PATH: the command needs Node 22.
    const env = { ...context.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` };
    return { ...context, env, pluginDirs: [plugin], appendSystemPrompt: FRONT_DESK_LINE, readable: repositoryReadable(), close };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    await context.close();
    throw error;
  }
}

// ------------------------------------------------------------ reading a run

// The main session's calls, in order (callsOf), with the event index each came in.
export const mainCalls = (events) => callsOf(events).filter((call) => !call.subagent);

// What the main session wrote to the director, each with the index of its event: its text
// blocks, and its narration. With Claude Code 2.1.302, prose the session writes between tool
// calls reaches the stream only as the server's summary of it, a block of type `thinking` that
// the event names in `narration_block_indexes` (its own description: "server summaries of the
// prose between tool calls, not the model's own reasoning"); it is drawn for the director as a
// summary, so a narration block is the session's words to them, summarised.
export function textBlocks(events) {
  const out = [];
  events.forEach((event, index) => {
    if (event.type !== 'assistant' || event.parent_tool_use_id) return;
    const narration = new Set(Array.isArray(event.narration_block_indexes) ? event.narration_block_indexes : []);
    (Array.isArray(event.message?.content) ? event.message.content : []).forEach((block, i) => {
      const text = block.type === 'text' ? block.text : block.type === 'thinking' && narration.has(i) ? block.thinking : null;
      if (typeof text === 'string' && text.trim() !== '') out.push({ order: index, text });
    });
  });
  return out;
}

// The questions of each AskUserQuestion call.
export const askCalls = (calls) => calls.filter((call) => call.name === 'AskUserQuestion')
  .map((call) => ({ ...call, questions: Array.isArray(call.input.questions) ? call.input.questions : [] }));

// Whether an asked question is the card as it was composed: its text, and its options' labels in order.
export function asItIs(asked, data) {
  const card = asQuestion({ data });
  const labels = (asked?.options ?? []).map((o) => o?.label);
  return asked?.question === card.question && JSON.stringify(labels) === JSON.stringify(card.options.map((o) => o.label));
}

// What the session wrote that a front desk must never write for a press or a wake: a signed
// kind (the stand-in refuses those, so they are looked for among the refused requests too), a
// card's answer, a card, or a request the stand-in doesn't take. Each as `kind`, `kind (refused)`
// or the request's route.
export function forbiddenWrites(context) {
  const written = writtenEvents(context).filter((e) => [...PROTECTED_KINDS, 'card-answer', 'card'].includes(e.kind)).map((e) => e.kind);
  const refused = (context?.helper?.records() ?? []).filter((r) => r.refused && r.route === 'state/write').map((r) => `${r.kind} (refused)`);
  // A request the stand-in doesn't answer, other than a reading (the command asks for the
  // director's profile settings, and does without them).
  const elsewhere = (context?.helper?.records() ?? []).filter((r) => r.unanswered && !/\/views$/.test(r.route)).map((r) => r.route);
  return [...written, ...refused, ...elsewhere];
}

// The card ids the session's `asked` records name.
export const askedIds = (context) => writtenEvents(context).filter((e) => e.kind === 'asked').flatMap((e) => (Array.isArray(e.data?.cards) ? e.data.cards : []));

// The skills the main session started, by name.
export const skillsOf = (calls) => calls.filter((call) => call.name === 'Skill').map((call) => String(call.input.skill ?? ''));
