// scripts/eval/front-desk.js
// What the front desk scenarios share (tests/eval/front-desk/, and
// tests/eval/build-loop/25, 26, 27's route leg and 35): setting a scratch
// project up as the project's main checkout, where the front desk works, with
// state already holding what the scenario needs; and reading what the session
// did from its stream-json events, its files and the state it wrote to.
//
// The set-up: the project's files committed on `main`; a feature's worktree
// under .claude/worktrees/ when the scenario has one building; a stand-in
// helper (stand-in-helper.js) on a socket in a Wheelhouse home of its own,
// reached through WHEELHOUSE_HOME, whose state starts with the scenario's
// events; and the session's local allow rules. **With Wheelhouse** a scratch
// plugin named `wheelhouse` holds what a real front desk session uses: the
// front desk's command (scripts/frontdesk/cli.js) with what it imports and
// reads, the intake and front-desk skills, and a session start hook that gives
// what the real session start's reload gives a front desk session over the
// state as it stands then (session-start.js, `reload`), asked of the stand-in
// each time it runs, so a resumed or compacted session gets the state the
// run has made. With `lastPrompt`, a prompt hook gives what the board context
// hook gives the front desk on each prompt (board-context.js): the "cards to
// ask" line, and the briefing on the first prompt after the gap, built by the
// hook's own functions from the stand-in's state (promptContext). The real
// session start and the board context hook need a real Wheelhouse home, and
// the card check would never run, as `claude -p` offers no AskUserQuestion,
// so they stay out. **Without**, no plugin of Wheelhouse's and a plain prompt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ATTRIBUTION_OFF, frontDeskCommand } from '../protection/settings.js';
import { helperAddress } from '../lib/paths.js';
import { FRONT_DESK_INPUT } from '../lib/front-desk.js';
import { briefHash } from '../feature/files.js';
import { reload } from '../hooks/session-start.js';
import { HEADINGS, briefingIn, cardsDue, cardsLine } from '../hooks/board-context.js';
import { boardModel } from '../board/model.js';
import { effectiveSettings } from '../settings/effective.js';
import { SETTINGS } from '../settings/catalogue.js';
import { reviewDue } from '../frontdesk/learning.js';
import { BRIEFING_GAP_HOURS, CONTEXT_CHARS } from '../lib/core-numbers.js';
import { locateSuperpowers } from './harness.js';
import { plainEvent, standInViews, startStandInHelper } from './stand-in-helper.js';
import { REPO_ROOT, callsOf, filesWritten } from './feature-project.js';
import { assertUnderTmp } from '../../probes/lib/scratch.js';
import { segments } from '../hooks/shell-words.js';

export { briefHash };

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Wheelhouse eval', '-c', 'user.email=eval@wheelhouse.invalid', ...args], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root, relative, content) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

const PROJECT_FILES = {
  '.gitignore': '.wheelhouse/\n.superpowers/\n.claude/settings.local.json\n.claude/worktrees/\nnode_modules/\n',
};

// What the session may run without asking, in the project's local settings (claude -p ignores
// allow rules in a committed .claude/settings.json; check 25), and, with Wheelhouse, reading
// the scratch plugin's files, as the real plugin's would be read, and the front desk's command
// by the rule the real local settings hold.
function allowRules(plugin) {
  const allow = ['Bash(git *)', 'Bash(node *)', 'Bash(npm *)', 'Bash(ls *)', 'Bash(mkdir *)', 'Bash(pwd)'];
  if (plugin) {
    // An absolute path in a Read rule starts with two slashes; the temporary folder has two spellings on macOS.
    for (const at of new Set([plugin, realOr(plugin)])) {
      allow.push(`Read(/${at.split(path.sep).join('/')}/**)`);
      const command = frontDeskCommand(at);
      if (command !== null) allow.push(`Bash(${command}:*)`, `Edit(/${FRONT_DESK_INPUT})`);
    }
  }
  try {
    const skills = path.join(locateSuperpowers(), 'skills');
    allow.push(`Bash(${skills}/*)`, `Bash(bash ${skills}/*)`);
  } catch { /* Superpowers is not installed here; the run itself will say so */ }
  return allow;
}

// An event the state holds when the run starts, made as the helper makes one, at `at`.
export function seedEvent(kind, data, at) {
  return plainEvent(kind, data, new Date(at));
}

// The system prompt appended without Wheelhouse: one line with no double quotes (see runSession).
// With Wheelhouse nothing is appended: the session start hook names the playbook.
export const PLAIN_PROMPT = 'You help the director, this project\'s product owner, with the project.';

// The repository's files `entries` import, each import followed, relative to the repository:
// what a copy of them needs to run. An import of a file the repository doesn't hold throws, so a
// copy is never made without it.
export function importClosure(entries, root = REPO_ROOT) {
  const found = new Set();
  const todo = entries.map((file) => [file, null]);
  while (todo.length > 0) {
    const [file, from] = todo.pop();
    if (found.has(file)) continue;
    if (!fs.statSync(path.join(root, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(from === null ? `There is no ${file} to copy` : `${from} imports ${file}, which isn't in the repository`);
    }
    found.add(file);
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of text.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      todo.push([path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1] ?? m[2])), file]);
    }
  }
  return [...found].sort();
}

// What the scratch plugin holds of the repository's: the package file that makes its scripts
// modules, as the real plugin's root does (without it a package file above the temporary folder
// decides), the skills, the front desk's command with what it imports, and the files read beside
// them (the glossary's starter).
export const PLUGIN_FILES = [
  'package.json',
  'skills/intake/SKILL.md',
  'skills/front-desk/SKILL.md',
  ...importClosure(['scripts/frontdesk/cli.js']),
  'templates/glossary.json',
];

// The hooks' script: it hands what Claude Code gave it to the stand-in helper at `address`, which
// works out the text the real hook would add over the state as it stands (onHook), and prints it.
// Nothing is printed when there is no text, or the stand-in can't be reached.
function hookScript(address) {
  return `// hooks/context.js
// What the real session start or board context hook would add, asked of this evaluation's stand-in helper.
import http from 'node:http';
let given = '';
process.stdin.on('data', (chunk) => { given += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(given); } catch { /* nothing to pass on */ }
  const body = JSON.stringify({ event: input.hook_event_name ?? null, source: input.source ?? null, prompt: input.prompt ?? null });
  const req = http.request({ socketPath: ${JSON.stringify(address)}, path: '/eval/hook', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
    let text = '';
    res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => {
      try {
        const answer = JSON.parse(text);
        if (typeof answer.text === 'string' && answer.text !== '') {
          process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: answer.text } }));
        }
      } catch { /* adds nothing */ }
    });
  });
  req.on('error', () => {});
  req.end(body);
});
`;
}

const HOOK = { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/context.js"', timeout: 10 };
const hooksFor = (prompts) => ({
  hooks: {
    SessionStart: [{ matcher: 'startup|resume|compact|clear|fork', hooks: [HOOK] }],
    ...(prompts ? { UserPromptSubmit: [{ hooks: [HOOK] }] } : {}),
  },
});

// The project the board context hook's functions are given: no project of this name is ever
// registered, so they read nothing of one from the evaluation's home.
const EVAL_PROJECT = 'wheelhouse-eval';

// What the board context hook adds to a front desk prompt at `at` (a Date), over the stand-in's
// `views` and `events`, as board-context.js's decide does: the "cards to ask" line, then, when the
// gap since the director's last prompt (`seen.promptAt`) has passed, the briefing within what is
// left of CONTEXT_CHARS. `usage` is the usage figures the briefing reads (usageFigures' shape), or
// null for none. `seen` ({ promptAt, briefedAt }) is updated as markSeen would. The functions run
// with WHEELHOUSE_HOME naming `home`, the evaluation's own, so they read nothing of the real one;
// the glossary is the starter's. Left out, as no scenario needs them: STOP, learning, the board
// commands and the gap setting. Null when it adds nothing.
export function promptContext({ views, events, seen, at, usage = null, home }) {
  const was = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const last = seen.promptAt === null ? NaN : Date.parse(seen.promptAt);
    const due = Number.isNaN(last) || at.getTime() - last >= BRIEFING_GAP_HOURS * 60 * 60 * 1000;
    const count = cardsDue(views, at);
    const cards = count > 0 ? cardsLine(count) : null;
    let briefing = null;
    if (due) {
      const settings = effectiveSettings({ project: views.settings ?? {}, profile: {}, now: () => at });
      const model = boardModel({ project: EVAL_PROJECT, views, events, usage, health: [], settings, sources: null, now: () => at });
      const days = settings.delegationReviewDays?.value ?? SETTINGS.delegationReviewDays.default;
      const review = { due: reviewDue({ events, now: at, days }), days };
      const room = CONTEXT_CHARS - HEADINGS.briefing.length - 2 - (cards === null ? 0 : cards.length + 2);
      const given = briefingIn({ project: EVAL_PROJECT, model, usage, sources: null, settings, since: seen.briefedAt, weeklySince: null, review, at, room });
      briefing = `${HEADINGS.briefing}\n\n${given.text}`;
    }
    seen.promptAt = at.toISOString();
    if (briefing !== null) seen.briefedAt = seen.promptAt;
    const text = [cards, briefing].filter((part) => part !== null).join('\n\n');
    return text === '' ? null : text;
  } finally {
    if (was === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = was;
  }
}

// What the scratch plugin's hooks add, asked of the stand-in: the session start's reload, or the
// board context hook's text when the scenario has it (`seen` not null).
function hookText({ body, views, events, seen, usage, home }) {
  if (body.event === 'SessionStart') return reload({ views, stop: null, notes: [], frontDesk: true });
  if (body.event === 'UserPromptSubmit' && seen !== null) return promptContext({ views, events, seen, at: new Date(), usage, home });
  return null;
}

// Sets `dir`, the scratch project, up as the project's main checkout for the front desk, and
// starts the stand-in helper. Options:
//   files       the project's files, { relative: text }, committed on main
//   commits     the project's history after that, [{ message, files }], each committed on main
//   seed        the events the state holds when the run starts (seedEvent), or a function that
//               makes them from { head }, the feature worktree's head commit (null without one)
//   approved    { work: hash }: work the director approved before the run (standInViews)
//   worktree    null, or { work, files }: a feature building in .claude/worktrees/<work>,
//               on feature/<work>, its files committed there
//   pullRequests  { number: 'head' }: pull requests open when the run starts, each at the commit
//               the feature's worktree branch holds ('head') or a full commit
//   lastPrompt  undefined for no board context hook (the build loop's scenarios); otherwise the
//               time of the director's last prompt, or null for none, and with Wheelhouse the
//               board context hook's text comes on each prompt (promptContext)
//   usage       the usage figures the briefing reads, or null
// Resolves with the context runScenario takes: { env, pluginDirs, appendSystemPrompt, helper,
// seededIds, evidence, hooksGave, head, close }, with `reload`, the session start's text over the
// seed, with Wheelhouse. `hooksGave()` lists what the plugin's hooks added, in order.
export async function setUpFrontDesk(dir, variant, {
  files = {}, commits = [], seed = [], approved = {}, worktree = null, pullRequests = {}, lastPrompt, usage = null,
} = {}) {
  assertUnderTmp(dir);
  // By its real path: the command runs nothing when started through a link in its path (the
  // temporary folder is one on macOS), as it compares its own address with the one it was given.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-eval-')));
  assertUnderTmp(root);
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });

  let helper = null;
  const close = async () => {
    try {
      await helper?.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  try {
    git(dir, 'branch', '-M', 'main');
    for (const [relative, content] of Object.entries({ ...PROJECT_FILES, ...files })) write(dir, relative, content);
    git(dir, 'add', '--all');
    git(dir, 'commit', '--quiet', '-m', 'The project so far');
    for (const commit of commits) {
      for (const [relative, content] of Object.entries(commit.files ?? {})) write(dir, relative, content);
      git(dir, 'add', '--all');
      git(dir, 'commit', '--quiet', '--allow-empty', '-m', commit.message);
    }

    let head = null;
    if (worktree) {
      const at = path.join(dir, '.claude', 'worktrees', worktree.work);
      git(dir, 'worktree', 'add', '--quiet', '-b', `feature/${worktree.work}`, at, 'main');
      for (const [relative, content] of Object.entries(worktree.files ?? {})) write(at, relative, content);
      git(at, 'add', '--all');
      git(at, 'commit', '--quiet', '-m', 'Build task 1');
      head = git(at, 'rev-parse', 'HEAD');
    }
    if (typeof seed === 'function') seed = seed({ head });
    const pluginDirs = [];
    let appendSystemPrompt = PLAIN_PROMPT;
    let reloadText = null;
    const plugin = variant === 'with' ? path.join(root, 'plugin') : null;
    if (plugin) fs.mkdirSync(plugin, { recursive: true });
    write(dir, '.claude/settings.local.json', `${JSON.stringify({ permissions: { allow: allowRules(plugin) }, ...ATTRIBUTION_OFF }, null, 2)}\n`);
    if (plugin) {
      write(plugin, '.claude-plugin/plugin.json', `${JSON.stringify({ name: 'wheelhouse', version: '0.0.0', description: 'Wheelhouse\'s front desk, for one evaluation run.' }, null, 2)}\n`);
      for (const file of PLUGIN_FILES) write(plugin, file, fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
      reloadText = reload({ views: standInViews(seed, approved), stop: null, notes: [], frontDesk: true });
      write(plugin, 'hooks/hooks.json', `${JSON.stringify(hooksFor(lastPrompt !== undefined), null, 2)}\n`);
      pluginDirs.push(plugin);
      appendSystemPrompt = undefined;
    }

    const address = process.platform === 'win32' ? helperAddress() : path.join(home, 'helper.sock');
    if (plugin) write(plugin, 'hooks/context.js', hookScript(address));
    // What the board context hook keeps in seen.json: the director's last prompt, the last briefing.
    const seen = lastPrompt === undefined ? null : { promptAt: lastPrompt, briefedAt: null };
    const prs = Object.fromEntries(Object.entries(pullRequests).map(([number, sha]) => [number, sha === 'head' ? head : sha]));
    helper = await startStandInHelper({
      address,
      state: { events: seed, approved, pullRequests: prs },
      onHook: ({ body, views, events }) => hookText({ body, views, events, seen, usage, home }),
    });
    const seededIds = new Set(seed.map((e) => e.id));
    const evidence = () => ({ helper: helper.records(), written: helper.events().filter((e) => !seededIds.has(e.id)) });
    // What the hooks added, in order: { event, source, text }.
    const hooksGave = () => helper.records().filter((r) => r.route === 'eval/hook').map(({ event, source, text }) => ({ event, source, text }));
    return {
      env: { WHEELHOUSE_HOME: home }, pluginDirs, ...(appendSystemPrompt ? { appendSystemPrompt } : {}), ...(reloadText === null ? {} : { reload: reloadText }), head,
      helper, seededIds, evidence, hooksGave, close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

// ------------------------------------------------------------ reading a run

// The events the session wrote to the state: everything the state holds that it did not start with.
export function writtenEvents(context) {
  const seeded = context?.seededIds ?? new Set();
  return (context?.helper?.events() ?? []).filter((e) => !seeded.has(e.id));
}

function blocks(event) {
  const content = event?.message?.content;
  return Array.isArray(content) ? content : [];
}

// What the main session said to the director: its text, every turn, in order.
export function replyText(events) {
  return events
    .filter((event) => event.type === 'assistant' && !event.parent_tool_use_id)
    .flatMap((event) => blocks(event).filter((block) => block.type === 'text').map((block) => block.text))
    .join('\n\n');
}

// The cards the session composed and recorded: card events, which only `cli.js card` and `cli.js
// cards` write (`record` refuses the kind), each as its data.
export const cardsRecorded = (written) => written.filter((e) => e.kind === 'card').map((e) => e.data);

const ASK = 'AskUserQuestion';

// How a recorded card was put to the director, or null when it never was: an AskUserQuestion call
// of the main session's holding its question as composed; else, since `claude -p` offers no
// AskUserQuestion (Claude Code 2.1.302), the card in its reply, in the card's own words: its set
// line, its first part, or every one of its options by label together with its first part or what
// the option it recommends says (ruling F83). A search for the tool alone is not asking.
export function howAsked(events, card) {
  const calls = callsOf(events).filter((call) => !call.subagent);
  const questions = calls.filter((call) => call.name === ASK).flatMap((call) => (Array.isArray(call.input.questions) ? call.input.questions : []));
  if (questions.some((q) => q?.question === card.question)) return ASK;
  const reply = replyText(events);
  // A text of the card's, without its closing stop, word for word in the reply.
  const carries = (text) => {
    const words = typeof text === 'string' ? text.trim().replace(/[.!?]$/, '') : '';
    return words !== '' && reply.includes(words);
  };
  const what = String(card.question ?? '').split('\n')[0].replace(/^What this is: /, '');
  const labels = Array.isArray(card.options) ? card.options.filter((l) => typeof l === 'string') : [];
  const says = Array.isArray(card.descriptions) ? card.descriptions[labels.indexOf(card.recommend)] : undefined;
  const decides = typeof says === 'string' ? says.replace(/^Recommended: /, '') : null;
  if ((typeof card.line === 'string' && reply.includes(card.line)) || carries(what)
    || (labels.length > 0 && labels.every((l) => reply.includes(l)) && carries(decides))) return 'in its reply';
  return null;
}

// The skills a call started (`Skill`), by name.
export function skillsStarted(calls) {
  return calls.filter((call) => call.name === 'Skill').map((call) => String(call.input.skill ?? call.input.command ?? ''));
}

const CODE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/;
// The product's own files a page or a style is in, beside its code.
const PAGES = /\.(?:html?|css|svg)$/;

const realOr = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

// `file` relative to the project `dir`, or null when it is outside it. The temporary folder
// has two spellings on macOS (/var and /private/var), so each side is tried both ways.
export function inProject(dir, file) {
  const full = path.resolve(dir, String(file));
  for (const base of [dir, realOr(dir)]) {
    for (const target of [full, realOr(full), path.join(realOr(path.dirname(full)), path.basename(full))]) {
      const relative = path.relative(base, target);
      if (relative === '') return '.';
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
    }
  }
  return null;
}
// The front desk's own papers and tools: never the product's code. A feature's worktree under
// .claude/worktrees/ is the product's code, though .claude/ is not.
const PAPERS = /(?:^|[\\/])(?:\.wheelhouse|\.superpowers|docs|node_modules)[\\/]/;

// A code file of the product inside the project (a test file included): not one of the
// session's papers, and not a file outside the project such as the plugin's scripts.
export function isProductCode(file, dir) {
  if (typeof file !== 'string' || !CODE.test(file)) return false;
  const relative = inProject(dir, file);
  if (relative === null) return false;
  if (PAPERS.test(relative)) return false;
  if (/^\.claude[\\/]/.test(relative) && !/^\.claude[\\/]worktrees[\\/]/.test(relative)) return false;
  return true;
}

// The product's code files the session or its subagents wrote.
export function codeWrites(calls, dir) {
  return calls.flatMap((call) => filesWritten(call).filter((file) => isProductCode(file, dir)));
}

// The product's files the session or its subagents wrote: its code, as codeWrites reads it, and its
// pages and styles, wherever in the project they are but among the front desk's papers.
export function productWrites(calls, dir) {
  return calls.flatMap((call) => filesWritten(call).filter((file) => {
    if (isProductCode(file, dir)) return true;
    if (typeof file !== 'string' || !PAGES.test(file)) return false;
    const relative = inProject(dir, file);
    return relative !== null && !PAPERS.test(relative) && !/^\.claude[\\/](?!worktrees[\\/])/.test(relative);
  }));
}

// Every text the session wrote into a file with a tool: a Write's content, an Edit's new text; with
// `dir`, only into a file in that project (not the scratchpad, say).
export function textsWritten(calls, dir) {
  return calls.filter((call) => dir === undefined || inProject(dir, String(call.input.file_path ?? '')) !== null).flatMap((call) => {
    if (call.name === 'Write') return [String(call.input.content ?? '')];
    if (call.name === 'Edit') return [String(call.input.new_string ?? '')];
    if (call.name === 'MultiEdit') return (Array.isArray(call.input.edits) ? call.input.edits : []).map((e) => String(e?.new_string ?? ''));
    return [];
  });
}

// The skills that build or plan a build: never started at the front desk.
export const BUILD_SKILLS = /writing-plans|executing-plans|subagent-driven-development|test-driven-development|\btdd\b|using-git-worktrees|finishing-a-development-branch/;

// Whether `text` says a lane by name: "the small lane", "a small feature", "a small change" or
// "job"; "the quick lane", "a quick change" or "job"; "the feature lane".
export function laneSaid(text, lane) {
  const said = {
    quick: /\bquick[- ](?:lane|change|fix|job)\b/i,
    small: /\bsmall[- ](?:lane|feature|change|job)\b/i,
    feature: /\bfeature lane\b/i,
    bug: /\bbug lane\b/i,
  }[lane];
  return said !== undefined && said.test(String(text));
}

// The sentences of a text, split after a stop, a question mark or a line's end.
const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

// Whether `text` offers the director a look before the change is built: a sentence naming a
// preview, a mock-up, a prototype, showing them or letting them see it (not users seeing it), as an offer (a question, "I can", "I'll", "want
// me") or as what comes first ("before"), and not a sentence saying there is none (no, not,
// without, n't).
export function previewOffered(text) {
  return sentences(text).some((one) => /\b(?:preview|mock-?ups?|prototype|sample page|show you|you see it|let you see)\b/i.test(one)
    && (/\?$|\b(?:I can|I could|I'll|I will|want me|shall I|should I|before)\b/i.test(one))
    && !/\b(?:no|not|without|never)\b|n't\b/i.test(one));
}

// The worker labels the briefing scenario looks for, each a whole word: "PR", "CI" in their own
// capitals, "slice" in any case, each with its plural.
export const LABELS = { PR: /\bPRs?\b/g, CI: /\bCI\b/g, slice: /\bslices?\b/gi };

// The labels `text` uses bare: used, and nowhere defined: no "<label> means", "<label> (", or
// "(<label>)" in it.
export function bareLabels(text) {
  const said = String(text);
  return Object.entries(LABELS).filter(([label, pattern]) => {
    if (said.match(pattern) === null) return false;
    const word = label === 'slice' ? '[Ss]lices?' : `${label}s?`;
    return !new RegExp(`\\b${word} means\\b|\\b${word} \\(|\\(${word}\\)`).test(said);
  }).map(([label]) => label);
}

// Whether `text` quotes `words`: `n` of its words in a row, as they stand, in any case and with
// any punctuation between them.
export function quotes(text, words, n = 6) {
  const tokens = (t) => String(t).toLowerCase().match(/[$a-z0-9]+(?:[.'][a-z0-9]+)*/g) ?? [];
  const said = ` ${tokens(text).join(' ')} `;
  const own = tokens(words);
  for (let i = 0; i + n <= own.length; i += 1) if (said.includes(` ${own.slice(i, i + n).join(' ')} `)) return true;
  return false;
}

// Lines of a text that are items of a list: "- ", "* ", "• " or "1. ", or a line in bold that starts
// with "Option".
export const listItems = (text) => String(text).split('\n').filter((line) => /^\s*(?:[-*•]\s+|\d+[.)]\s+|\*\*Option\b)/.test(line));

// Whether the session compacted: a compact boundary in its events.
export const compacted = (events) => events.some((e) => e.type === 'system' && e.subtype === 'compact_boundary');

// The product's code files the session read: Read, a Grep or Glob over code, or a shell
// command that shows a code file (cat, head, tail, less, sed -n, grep).
export function codeReads(calls, dir) {
  const read = [];
  for (const call of calls) {
    if (call.name === 'Read' && isProductCode(String(call.input.file_path ?? ''), dir)) read.push(String(call.input.file_path));
    if (call.name === 'Grep' || call.name === 'Glob') {
      const where = inProject(dir, String(call.input.path ?? dir));
      const target = `${call.input.glob ?? ''} ${call.input.type ?? ''} ${call.input.pattern ?? ''}`;
      if (where !== null && !PAPERS.test(`${where}/`) && /\bjs\b|\.[cm]?[jt]sx?\b|\*\*/.test(target)) read.push(`${call.name} ${target.trim()}`);
    }
    if (call.name === 'Bash' && typeof call.input.command === 'string') {
      const command = call.input.command;
      if (/\b(?:cat|head|tail|less|grep|rg|sed\s+-n)\b/.test(command)) {
        // Each word as the shell joins it ("<plugin>/cards/"*.js is one word, outside the project).
        // A word that sets a shell variable (C=/path/cli.js) names a file by what follows the =; a
        // search's --include= or --exclude= names which files to search, not a file.
        const parts = segments(command, false);
        const named = parts === null
          ? [...command.matchAll(/(?:^|[\s"'=])([^\s"'|;&<>=]+\.(?:[cm]?js|jsx|[cm]?ts|tsx))(?![\w.])/g)].map((m) => m[1])
          : parts.flat().filter((word) => !/^--(?:include|exclude)=/.test(word)).map((word) => (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word) ? word.slice(word.indexOf('=') + 1) : word));
        for (const file of named) if (CODE.test(file) && isProductCode(file, dir)) read.push(file);
      }
    }
  }
  return read;
}

// Shell commands that build or test the product.
export const BUILD_COMMAND = /\bnpm\s+(?:run\s+\S+|test|install|ci|i)\b|\bnode\s+--test\b|\bnpx\s+\S+|\bpnpm\b|\byarn\b/;
export const buildCommands = (calls) => calls.filter((call) => call.name === 'Bash' && BUILD_COMMAND.test(String(call.input.command ?? '')));

// Subagents sent to build: Wheelhouse's builder, or any other sent to implement, build or fix.
export function buildDispatches(calls) {
  return calls.filter((call) => (call.name === 'Agent' || call.name === 'Task')
    && (call.input.subagent_type === 'wheelhouse:builder' || /\b(?:implement|build|fix|code)\b/i.test(`${call.input.description ?? ''}`)));
}

// The paragraphs of a text: split on blank lines and headings.
export function paragraphs(text) {
  return String(text).split(/\n\s*\n|\n(?=#{1,6}\s|\*\*\d|\d+\.\s)/).map((p) => p.trim()).filter(Boolean);
}

// Whether `route` (a pattern) is said about a request (a pattern of its words): in a paragraph
// that names the request, or the paragraph after it.
export function saidAbout(text, request, route) {
  const parts = paragraphs(text);
  return parts.some((part, i) => request.test(part) && (route.test(part) || (i + 1 < parts.length && route.test(parts[i + 1]))));
}

// A document the session left in the project whose hash is `hash`, or null.
export function documentWithHash(dir, hash) {
  const visit = (folder, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory() && depth < 6) {
        const found = visit(full, depth + 1);
        if (found) return found;
      } else if (entry.isFile() && /\.(?:md|txt)$/.test(entry.name)) {
        if (briefHash(fs.readFileSync(full, 'utf8')) === hash) return path.relative(dir, full);
      }
    }
    return null;
  };
  return typeof hash === 'string' && hash !== '' ? visit(dir, 0) : null;
}

// The hash of a project file as it stands, or null.
export function hashOfFile(dir, relative) {
  try {
    return briefHash(fs.readFileSync(path.resolve(dir, relative), 'utf8'));
  } catch {
    return null;
  }
}

// The same path, relative to the project, whichever way the session wrote it.
export function sameFile(dir, a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = inProject(dir, a);
  return left !== null && left === inProject(dir, b);
}
