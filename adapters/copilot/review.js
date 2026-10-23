// adapters/copilot/review.js
// Copilot's half of the signed review (rulings P7-14, P7-15, P7-17, P7-20; check 66's route b): the review's own
// Copilot home, the call, Copilot's offline listings, and the clean check a session must pass before its verdict is
// taken. The folder, the prompt and the verdict are the core's (scripts/review/clean-session.js), which names no
// agent; the helper finds this module through scripts/agents/reviews.js and signs what the core gives back.
//
// The session runs in the review's folder, with a home made fresh for the review holding only the sign-in keys of
// config.json and the reviewer agent, no `--trust-folder`, custom instructions and the built-in MCP servers off, and
// its tools held to view, glob and rg. Its environment carries neither COPILOT_CUSTOM_INSTRUCTIONS_DIRS nor
// COPILOT_SKILLS_DIRS. The reviewer's first instruction is to begin its answer with a line holding a nonce made for
// this review and never put in the prompt, which shows the reviewer was the agent in effect.
//
// The clean check is an allow-list that fails closed: a line it needs and can't find is a reason, as is anything it
// doesn't expect. The tool set and the log lines depend on Copilot's version, so a version other than
// COPILOT_VERSION refuses, and the check is run again on each pin.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCommand } from '../../scripts/lib/claude.js';
import { COPILOT_VERSION, REVIEW_SESSION_READY } from '../../scripts/lib/copilot-numbers.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { copilotHome } from './hooks.js';
import { copilotSessionEnv, eventsOf, finalAnswer, signInOf } from './sessions.js';

// The kit's reviewer, whose body the review's agent takes under the name check 66 proved (`reviewer`).
const KIT_REVIEWER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home', 'agents', 'wheelhouse-reviewer.agent.md');
export const REVIEWER = 'reviewer';
export const REVIEW_TOOLS = Object.freeze(['view', 'glob', 'rg']);
// The reviewer's first line, before the review's nonce.
export const FIRST_LINE = 'WHEELHOUSE CLEAN REVIEWER';
// The kind of review this module's sessions give (REVIEW_KINDS).
export const REVIEW_KIND = 'clean-session';

// The "Disabled tools" set of check 66's recorded route b session (a session with the tool limits and no project
// folder), on COPILOT_VERSION. The check compares against it exactly: any other name, or a missing one, means the
// session differs from the one shown clean. probes/66-clean-review/run.js holds the same list; a test holds them equal.
export const EXPECTED_DISABLED_TOOLS = Object.freeze([
  'bash', 'create', 'dynamic_workflows_manage', 'edit', 'fetch_copilot_cli_documentation', 'list_agents', 'list_bash', 'read_agent',
  'read_bash', 'run_dynamic_workflow', 'semantic_code_search', 'session_store_sql', 'skill', 'sql', 'stop_bash', 'task', 'web_fetch', 'write_agent',
]);
// Flags no review ever carries: trust loads a folder's hooks and servers, and the rest lift the tool rules.
const FORBIDDEN_FLAGS = ['--trust-folder', '--allow-all-tools', '--allow-all', '--yolo', '--allow-all-paths', '--allow-all-urls', '--add-dir'];
// The only Copilot variable a review's environment holds.
const OWN_VARIABLE = 'COPILOT_HOME';
// Copilot's own listings, taken from the same home, folder and environment as the session.
const LISTINGS = Object.freeze([
  { id: 'instructions', args: ['instruction', 'list', '--json'], json: true },
  { id: 'lsp', args: ['lsp', 'list', '--json'], json: true },
  { id: 'mcp', args: ['mcp', 'list', '--json'], json: true },
  { id: 'skills', args: ['skill', 'list'], json: false },
]);
// The one section the skills listing may have (ruling P7-17, M1).
const BUILT_IN_SKILLS = 'Builtin skills:';
// The one MCP server the listing may name: Copilot's own, switched off by --disable-builtin-mcps.
const BUILT_IN_MCP = 'github-mcp-server';

const LISTING_MS = 60_000;
const SESSION_MS = 15 * 60_000;
const OUTPUT_BYTES = 8 * 1024 * 1024;

// The session's argv, exactly (ruling P7-17): compared whole by the clean check (M2), so an extra or a missing flag fails.
export function reviewArgs({ prompt, logDir }) {
  return [
    '-p', prompt, '--output-format', 'json', '--no-auto-update', '--no-ask-user', '--log-dir', logDir, '--log-level', 'debug',
    '--agent', REVIEWER, '--no-custom-instructions', '--disable-builtin-mcps', '--available-tools', ...REVIEW_TOOLS,
    ...REVIEW_TOOLS.map((tool) => `--allow-tool=${tool}`),
  ];
}

// The reviewer's line for this review.
export const firstLineOf = (nonce) => `${FIRST_LINE} ${nonce}`;

// The review's agent: the kit's reviewer, named `reviewer`, with a first instruction to begin the answer with the
// review's own line. The nonce is in this file only, never in the prompt.
export function reviewerAgent(nonce) {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) throw new Error("A review's nonce is 32 hexadecimal characters");
  const kit = fs.readFileSync(KIT_REVIEWER, 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(kit);
  if (!front || !/^name: "wheelhouse-reviewer"$/m.test(front[1])) throw new Error("The kit's reviewer has no front matter naming it");
  const header = front[1].replace(/^name: "wheelhouse-reviewer"$/m, `name: "${REVIEWER}"`);
  const body = kit.slice(front[0].length).replace(/^<!--.*-->\n/, '');
  return [
    `---\n${header}\n---\n`,
    `Before anything else: begin your last message, the one that ends with your report, with this line, exactly as it is, on a line of its own:\n\n${firstLineOf(nonce)}\n`,
    "In this review the diff is `change.diff` in the working folder, and your dispatch gives the brief and the project's rules; the folder has no `.wheelhouse` folder and no rules files. Where this file names those places, read the dispatch instead.\n",
    body,
  ].join('\n');
}

// Writes the review's own Copilot home: config.json holding only the sign-in keys of `signedInFrom`'s, and
// agents/reviewer.agent.md, and nothing else. `home` must not exist yet.
export function writeReviewHome({ home, signedInFrom = copilotHome(), nonce }) {
  const signIn = signInOf(signedInFrom);
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(path.join(home, 'agents'));
  fs.writeFileSync(path.join(home, 'agents', `${REVIEWER}.agent.md`), reviewerAgent(nonce), { flag: 'wx' });
  fs.writeFileSync(path.join(home, 'config.json'), `${JSON.stringify(signIn, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return home;
}

// The review's environment: a session's (copilotSessionEnv), which keeps no Copilot variable but COPILOT_HOME.
export function reviewEnv(env, { home, platform = process.platform } = {}) {
  return copilotSessionEnv(env, { home, platform });
}

// What the debug logs in `dir` say: every `Plugin activation [agents]` count, and whether repo hooks or workspace
// MCP sources were loaded.
export function debugLogFacts(dir) {
  const facts = { agentCounts: [], repoHooks: false, workspaceMcp: false };
  const walk = (current) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        let text = '';
        try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
        for (const line of text.split('\n')) {
          const loaded = /Plugin activation \[agents\].*\bloaded=(\d+)/.exec(line);
          if (loaded) facts.agentCounts.push(Number(loaded[1]));
          if (/Loading repo hooks in prompt mode/.test(line)) facts.repoHooks = true;
          if (/Loading workspace MCP sources in prompt mode/.test(line)) facts.workspaceMcp = true;
        }
      }
    }
  };
  walk(dir);
  return facts;
}

// What the session's own events say it loaded: the agents and skills named, every "Disabled tools" line, and each
// MCP server's statuses.
export function sessionFacts(events) {
  const facts = { agents: [], skills: [], disabledTools: [], servers: {} };
  const server = (name) => (facts.servers[name] ??= []);
  for (const event of events) {
    const data = event?.data ?? {};
    if (event?.type === 'session.custom_agents_updated') for (const a of data.agents ?? []) facts.agents.push({ name: a?.name ?? null, source: a?.source ?? null });
    if (event?.type === 'session.skills_loaded') for (const k of data.skills ?? []) facts.skills.push({ name: k?.name ?? null, source: k?.source ?? null });
    if (event?.type === 'session.info' && typeof data.message === 'string') {
      const match = /^Disabled tools: (.*)$/.exec(data.message);
      if (match) facts.disabledTools.push(match[1].split(',').map((name) => name.trim()).filter(Boolean));
    }
    if (event?.type === 'session.mcp_server_status_changed' && typeof data.serverName === 'string') server(data.serverName).push(String(data.status));
    if (event?.type === 'session.mcp_servers_loaded') for (const s of data.servers ?? []) if (typeof s?.name === 'string') server(s.name).push(String(s.status));
  }
  return facts;
}

const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && b.every((name) => a.includes(name));

// The clean check (ruling P7-17; modelled on probes/66-clean-review/run.js's, with the parked minors M1 to M3): the
// session's facts and debug log, how it was started (`args` against `expectedArgs`, whole; `environment`, the names
// of its variables), Copilot's own listings from the same home, folder and environment, and its answer, which must
// begin with `firstLine` while the prompt doesn't hold the nonce. Gives `{ clean, reasons }`.
export function cleanCheck({ facts, debug, args, expectedArgs, environment, listings, answer, firstLine, prompt, nonce }) {
  const reasons = [];
  if (!debug || debug.agentCounts.length === 0) reasons.push('the debug log has no agent count');
  else if (debug.agentCounts.some((n) => n !== 1)) reasons.push(`${Math.max(...debug.agentCounts)} agents were loaded, not the reviewer alone`);
  if (debug?.repoHooks !== false) reasons.push('repo hooks were loaded, or the log could not say');
  if (debug?.workspaceMcp !== false) reasons.push('workspace MCP sources were loaded, or the log could not say');

  if (!facts || facts.disabledTools.length === 0) reasons.push('the session has no "Disabled tools" line');
  else if (facts.disabledTools.some((list) => !sameSet(list, EXPECTED_DISABLED_TOOLS))) {
    const seen = [...new Set(facts.disabledTools.flat())];
    const extra = seen.filter((name) => !EXPECTED_DISABLED_TOOLS.includes(name));
    const missing = EXPECTED_DISABLED_TOOLS.filter((name) => facts.disabledTools.some((list) => !list.includes(name)));
    reasons.push(`the disabled tools differ from route b's recorded set${extra.length ? `; beyond it: ${extra.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
  }
  const agents = (facts?.agents ?? []).filter((a) => a.name !== REVIEWER);
  if (agents.length > 0) reasons.push(`agents besides the reviewer: ${agents.map((a) => a.name).join(', ')}`);
  const skills = (facts?.skills ?? []).filter((k) => k.source !== 'builtin');
  if (skills.length > 0) reasons.push(`skills that are not built in: ${skills.map((k) => k.name).join(', ')}`);
  const started = Object.entries(facts?.servers ?? {}).filter(([, statuses]) => statuses.some((s) => /^(connected|pending|connecting)$/.test(s))).map(([name]) => name);
  if (started.length > 0) reasons.push(`MCP servers connected: ${started.join(', ')}`);

  if (!Array.isArray(args) || !Array.isArray(expectedArgs)) reasons.push("the session's arguments were not given");
  else {
    if (args.length !== expectedArgs.length || args.some((arg, i) => arg !== expectedArgs[i])) reasons.push('the session was not started with exactly the review\'s arguments');
    const flags = args.filter((_, i) => args[i - 1] !== '-p');
    for (const flag of FORBIDDEN_FLAGS) if (flags.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) reasons.push(`the session was started with ${flag}`);
  }
  if (!Array.isArray(environment)) reasons.push("the session's environment was not given");
  else {
    const copilotVars = environment.filter((name) => /^copilot_/i.test(name) && name !== OWN_VARIABLE);
    if (copilotVars.length > 0) reasons.push(`the session's environment sets ${copilotVars.join(', ')}`);
    if (!environment.includes(OWN_VARIABLE)) reasons.push("the session's environment doesn't name its own home");
  }

  if (!listings) reasons.push("Copilot's own listings were not taken");
  else {
    const must = (id, ok, what) => {
      const listing = listings[id];
      if (!listing || listing.code !== 0) reasons.push(`the ${id} listing failed or is missing`);
      else if (!ok(listing)) reasons.push(what);
    };
    must('instructions', (l) => Array.isArray(l.json) && l.json.length === 0, 'Copilot lists instruction sources for the review');
    must('lsp', (l) => Array.isArray(l.json) && l.json.length === 0, 'Copilot lists a language server for the review');
    must('mcp', (l) => l.json !== null && typeof l.json === 'object' && !Array.isArray(l.json) && typeof l.json.mcpServers === 'object' && l.json.mcpServers !== null
      && Object.keys(l.json.mcpServers).every((name) => name === BUILT_IN_MCP), 'Copilot lists an MCP server besides its own');
    must('skills', (l) => typeof l.text === 'string' && l.text.split(/\r?\n/).filter((line) => /^\S.*:\s*$/.test(line)).every((line) => line.trim() === BUILT_IN_SKILLS),
      'Copilot lists skills besides the built-in ones');
  }

  if (typeof firstLine !== 'string' || typeof answer !== 'string' || answer.split(/\r?\n/)[0].trim() !== firstLine) {
    reasons.push("the answer doesn't begin with the reviewer's own line, so the reviewer may not have been the agent in effect");
  }
  if (typeof nonce !== 'string' || nonce === '' || String(prompt ?? '').includes(nonce)) reasons.push("the review's nonce is missing or is in the prompt");
  return { clean: reasons.length === 0, reasons };
}

// The first version number Copilot gives for `--version`, or null.
export const versionOf = (text) => /\b(\d+\.\d+\.\d+)\b/.exec(String(text ?? ''))?.[1] ?? null;

// One review session in `folder` (ruling P7-17): the review's own home, Copilot's version and its four listings from
// that home, folder and environment, the session, then the clean check. Gives `{ clean, reasons, answer, firstLine }`.
// Everything it made is removed before it returns. `copilot` is the program as resolveCommand finds it; through a
// .cmd shim the review is not started, since its prompt carries the diff, which cmd.exe can't be given whole.
export async function runSession({ folder, prompt, env = process.env, platform = process.platform, copilot = null, run = realRun, signedInFrom = copilotHome(), tmp = os.tmpdir(), timeoutMs = SESSION_MS }) {
  const refused = (why) => ({ clean: false, reasons: [why], answer: null, firstLine: null });
  let resolved;
  try {
    resolved = copilot ?? resolveCommand({ name: 'copilot', platform, env });
  } catch {
    return refused("Copilot CLI isn't on this computer's PATH");
  }
  if (resolved.kind === 'cmd') return refused("Copilot's review can't be started through a .cmd program: its prompt carries the diff, which cmd.exe can't be given whole");
  if (typeof prompt !== 'string' || prompt === '' || prompt.startsWith('-')) return refused("the review's prompt can't be passed to Copilot");

  const nonce = crypto.randomBytes(16).toString('hex');
  const firstLine = firstLineOf(nonce);
  const base = fs.mkdtempSync(path.join(tmp, 'wheelhouse-review-home-'));
  try {
    const home = path.join(base, 'home');
    const logDir = path.join(base, 'logs');
    try {
      writeReviewHome({ home, signedInFrom, nonce });
    } catch (error) {
      return refused(error instanceof Error ? error.message : "the review's home could not be made");
    }
    fs.mkdirSync(logDir);
    const sessionEnv = reviewEnv(env, { home, platform });
    const call = (args, ms) => run(resolved.file, args, { cwd: folder, baseEnv: {}, env: sessionEnv, input: '', timeoutMs: ms, limit: OUTPUT_BYTES, platform });

    const version = await call(['--version'], LISTING_MS);
    const found = version.code === 0 ? versionOf(version.stdout) : null;
    if (found !== COPILOT_VERSION) return refused(`Copilot CLI here is ${found ?? 'of a version that could not be read'}, and the clean review was shown only on ${COPILOT_VERSION}`);

    const listings = {};
    for (const listing of LISTINGS) {
      const answer = await call(listing.args, LISTING_MS);
      let json;
      if (listing.json) {
        try { json = JSON.parse(answer.stdout); } catch { json = undefined; }
      }
      listings[listing.id] = { code: answer.timedOut ? null : answer.code, json, text: listing.json ? undefined : answer.stdout };
    }

    const args = reviewArgs({ prompt, logDir });
    const session = await call(args, timeoutMs);
    if (session.timedOut || session.code !== 0) return refused(session.timedOut ? 'the review session did not finish in time' : `the review session ended with exit code ${session.code}`);
    const answer = finalAnswer(session.stdout);
    const check = cleanCheck({
      facts: sessionFacts(eventsOf(session.stdout)),
      debug: debugLogFacts(logDir),
      args,
      expectedArgs: reviewArgs({ prompt, logDir }),
      environment: Object.keys(sessionEnv),
      listings,
      answer,
      firstLine,
      prompt,
      nonce,
    });
    return { clean: check.clean, reasons: check.reasons, answer, firstLine };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// The review module the helper uses (scripts/agents/reviews.js): its kind, whether it is switched on, the kinds of
// review the gate counts for a Copilot project (none until REVIEW_SESSION_READY), and its session. `ready` and the
// session's options are for tests; the default is the module as shipped.
export function makeReview({ ready = REVIEW_SESSION_READY, ...options } = {}) {
  return Object.freeze({
    reviewKind: REVIEW_KIND,
    ready: () => ready === true,
    kinds: () => (ready === true ? [REVIEW_KIND] : []),
    session: ({ folder, prompt }) => runSession({ ...options, folder, prompt }),
  });
}

export default makeReview();
