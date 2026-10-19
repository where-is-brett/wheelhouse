// probes/50-switch-off/run.js
// Check 50: from a project's git-ignored local settings
// (.claude/settings.local.json), how to keep a skill, an agent, a slash command
// and a hook that the project's committed .claude/ folders define out of every
// session on this computer, and put them back, without deleting or moving a
// file; and the plugin, sandbox, same-name, untracked-folder, next-session and
// init-event questions beside it (docs/checks/50-switch-off.md).
//
// Usage: node run.js                 prints what it would do, and exits; it only
//                                    makes (and removes) scratch folders under
//                                    the temporary folder and never runs claude
//        node run.js --go            the trial
// Options: --terminal-only           skip the copy of Claude Code inside the Desktop app
//          --desktop-claude <path>   that copy, when it is not where this looks
//          --model <name>            the model for the sessions (or WHEELHOUSE_PROBE_MODEL);
//                                    never written into the repository
//
// WITH --go THIS CHANGES THIS COMPUTER'S PLUGIN LIST while it runs (it adds a
// scratch marketplace and installs one scratch plugin at project scope) and adds
// one personal skill folder, ~/.claude/skills/wheelhouse-probe-50-personal/, then
// puts both back. Run it only once the director has said yes. It first copies the
// four user files it could touch (known_marketplaces.json, installed_plugins.json,
// settings.json and .claude.json), and git's global ignore file if there is one,
// to a folder under the temporary folder, and at the end compares them with the
// copies. It undoes only what this run added, also on Ctrl-C or a termination
// signal. The findings (JSON) are written to that folder and printed.
//
// Real sessions cost tokens: about 40 short ones in all with both copies of
// Claude Code. Needs no network beyond the sessions themselves: the scratch
// plugin is a local git repository listed as a `url` source with a file://
// address, as check 30 did.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveClaude, invocation, withoutHostVariables } from '../../scripts/lib/claude.js';
import { parseStream, finalText } from '../../scripts/eval/harness.js';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { assertUnderTmp } from '../lib/scratch.js';
import { NAMES, MARKERS, summarise } from './findings.js';

const CHECK = '50-switch-off';
const MARKETPLACE_NAME = 'wheelhouse-probe-switch';
const PLUGIN_ID = `${NAMES.plugin}@${MARKETPLACE_NAME}`;
const INIT_WAIT_MS = 90_000;
const TURN_MS = 6 * 60_000;
const GIT_IDENTITY = ['-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];

// ------------------------------------------------------------------ options

export function parseOptions(argv, env = process.env) {
  const options = { go: false, terminalOnly: false, desktopClaude: '', model: env.WHEELHOUSE_PROBE_MODEL || '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--go') options.go = true;
    else if (arg === '--terminal-only') options.terminalOnly = true;
    else if (arg === '--desktop-claude') options.desktopClaude = argv[++i] ?? '';
    else if (arg === '--model') options.model = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

// ------------------------------------------------------------- the binaries

// "2.1.299" before "2.1.295": newest first.
function byVersionDescending(a, b) {
  const parts = (text) => text.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
}

// The copy of Claude Code the Desktop app keeps, one folder per version: on the
// Mac ~/Library/Application Support/Claude/claude-code/<version>/<id>/claude.app/
// Contents/MacOS/claude (seen in checks 24, 35 and 37); on Windows expected under
// %APPDATA%\Claude\claude-code\<version>\ as claude.exe (not yet seen). The newest
// version with a program in it.
export function findDesktopClaude({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const root = platform === 'win32'
    ? path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude-code')
    : path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  let versions = [];
  try { versions = fs.readdirSync(root).filter((name) => /^\d+\.\d+\.\d+/.test(name)).sort(byVersionDescending); } catch { return null; }
  const wanted = platform === 'win32' ? 'claude.exe' : 'claude';
  for (const version of versions) {
    const stack = [{ dir: path.join(root, version), depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === wanted && (platform === 'win32' || path.basename(dir) === 'MacOS')) return { version, file: full };
        if (entry.isDirectory() && depth < 6) stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return null;
}

function binaries(options) {
  const list = [];
  try {
    list.push({ label: 'terminal', resolved: resolveClaude() });
  } catch (error) {
    console.error(error.message);
  }
  if (!options.terminalOnly) {
    const file = options.desktopClaude || findDesktopClaude()?.file;
    if (file) list.push({ label: 'desktop', resolved: { kind: 'direct', file } });
  }
  return list;
}

// ------------------------------------------------------------- the fixtures

const slash = (file) => file.split(path.sep).join('/');

function git(dir, args) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

// The hook script, for the project and the plugin alike: writes ran/<name>.txt in
// the folder the session runs in (the hook input's `cwd`).
const MARK_SCRIPT = `// Scratch hook for check 50: records that it ran.
import fs from 'node:fs';
import path from 'node:path';
let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
let cwd = process.cwd();
try { cwd = JSON.parse(raw).cwd || cwd; } catch {}
fs.mkdirSync(path.join(cwd, 'ran'), { recursive: true });
fs.writeFileSync(path.join(cwd, 'ran', process.argv[2] + '.txt'), 'ran\\n');
`;

function skillText(name, marker, project, description) {
  return `---\nname: ${name}\ndescription: ${description} Use only when asked to by name.\n---\n\nWrite the word ran to the file ${slash(path.join(project, 'ran', `${marker}.txt`))} with the Write tool, then say that ${name} is done. Do nothing else.\n`;
}

function agentText(copy, project) {
  return `---\nname: ${NAMES.agent}\ndescription: Scratch agent for check 50 (the ${copy} copy). Use only when asked to by name.\ntools: Write\n---\n\nYour task is one word. Write the word ran to the file ${slash(path.join(project, 'ran'))}/agent-${copy}-<that word>.txt with the Write tool, putting the word in place of <that word>. Do nothing else.\n`;
}

// Everything under one new folder in the temporary folder:
//   project/      the scratch project, a git repository, with its committed parts
//   plugin/       the scratch plugin, a git repository with its own `builder` and SessionStart hook
//   marketplace/  the scratch marketplace, listing the plugin by file:// address, ref and sha
//   off/          where the move fall-back puts parts
//   worktree/     a git worktree of the project (made after the plugin is installed)
export function makeFixtures(root) {
  assertUnderTmp(root);
  const project = path.join(root, 'project');
  const plugin = path.join(root, 'plugin');
  const marketplace = path.join(root, 'marketplace');
  const off = path.join(root, 'off');
  fs.mkdirSync(off, { recursive: true });

  // The plugin.
  fs.mkdirSync(plugin, { recursive: true });
  git(plugin, ['init', '--quiet']);
  write(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: NAMES.plugin, version: '1.0.0', description: 'Scratch plugin for check 50' }, null, 2) + '\n');
  write(path.join(plugin, 'agents', `${NAMES.agent}.md`), agentText('plugin', project));
  write(path.join(plugin, 'hooks', 'mark.mjs'), MARK_SCRIPT);
  write(path.join(plugin, 'hooks', 'hooks.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/mark.mjs" ${MARKERS.pluginHook}` }] }] },
  }, null, 2) + '\n');
  git(plugin, ['add', '--all']);
  git(plugin, ['commit', '--quiet', '-m', 'Scratch plugin for check 50']);
  git(plugin, ['tag', 'v1']);
  const sha = git(plugin, ['rev-parse', 'HEAD']);

  // The marketplace.
  fs.mkdirSync(marketplace, { recursive: true });
  git(marketplace, ['init', '--quiet']);
  write(path.join(marketplace, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: MARKETPLACE_NAME,
    owner: { name: 'Wheelhouse probe' },
    plugins: [{ name: NAMES.plugin, source: { source: 'url', url: pathToFileURL(plugin).href, ref: 'v1', sha } }],
  }, null, 2) + '\n');
  git(marketplace, ['add', '--all']);
  git(marketplace, ['commit', '--quiet', '-m', 'Scratch marketplace for check 50']);

  // The project: one skill, one agent, one command and one SessionStart hook,
  // committed; one skill folder left untracked and listed in .git/info/exclude.
  fs.mkdirSync(project, { recursive: true });
  git(project, ['init', '--quiet']);
  write(path.join(project, '.claude', 'skills', NAMES.skill, 'SKILL.md'), skillText(NAMES.skill, MARKERS.skill, project, 'Scratch skill for check 50.'));
  write(path.join(project, '.claude', 'agents', `${NAMES.agent}.md`), agentText('project', project));
  write(path.join(project, '.claude', 'commands', `${NAMES.command}.md`), `---\ndescription: Scratch command for check 50.\n---\n\nWrite the word ran to the file ${slash(path.join(project, 'ran', `${MARKERS.command}.txt`))} with the Write tool, then say that ${NAMES.command} is done. Do nothing else.\n`);
  write(path.join(project, '.claude', 'hooks', 'mark.mjs'), MARK_SCRIPT);
  write(path.join(project, '.claude', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${slash(path.join(project, '.claude', 'hooks', 'mark.mjs'))}" ${MARKERS.projectHook}` }] }] },
  }, null, 2) + '\n');
  write(path.join(project, 'README.md'), 'Scratch project for check 50.\n');
  git(project, ['add', '--all']);
  git(project, ['commit', '--quiet', '-m', 'Scratch project for check 50']);
  write(path.join(project, '.claude', 'skills', NAMES.untracked, 'SKILL.md'), skillText(NAMES.untracked, `skill-${NAMES.untracked}`, project, 'Untracked scratch skill for check 50.'));
  fs.appendFileSync(path.join(project, '.git', 'info', 'exclude'), `\n/.claude/settings.local.json\n/.claude/skills/${NAMES.untracked}/\n/ran/\n`, 'utf8');

  return { root, project, plugin, marketplace, off, worktree: path.join(root, 'worktree'), sha };
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(slash(path.relative(base, full)));
  }
  return out.sort();
}

// ------------------------------------------------------------------ the trials

// What each trial writes, and what it asks. `local` is the whole of the
// project's .claude/settings.local.json (null: no file); `project` is merged
// into the committed .claude/settings.json for the trial and put back after.
// `asks`: model (one turn asking Claude to use the skills and dispatch
// `builder`), typed-skill / typed-command / typed-personal (the prompt is
// `/<name>`, as the director would type it), sandbox (one Bash command writing
// outside the project).
const MODEL = 'model';
export const TRIALS = [
  { name: 'baseline', local: null, asks: [MODEL, 'typed-skill', 'typed-command'] },
  { name: 'skill-overrides', local: { skillOverrides: { [NAMES.skill]: 'off', [NAMES.command]: 'off' } }, asks: [MODEL, 'typed-skill', 'typed-command'] },
  { name: 'skill-deny', local: { permissions: { deny: [`Skill(${NAMES.skill})`, `Skill(${NAMES.command})`] } }, asks: [MODEL, 'typed-skill', 'typed-command'] },
  { name: 'skill-deny-param', local: { permissions: { deny: [`Skill(skill:${NAMES.skill})`, `Skill(skill:${NAMES.command})`] } }, asks: [MODEL, 'typed-skill', 'typed-command'] },
  { name: 'agent-deny', local: { permissions: { deny: [`Agent(${NAMES.agent})`] } }, asks: [MODEL] },
  { name: 'hooks-off', local: { disableAllHooks: true }, asks: [] },
  { name: 'plugin-off', local: { enabledPlugins: { [PLUGIN_ID]: false } }, asks: [] },
  { name: 'sandbox-project', local: null, project: { sandbox: { enabled: true, allowUnsandboxedCommands: false } }, asks: ['sandbox'], unixOnly: true },
  { name: 'sandbox-local-off', local: { sandbox: { enabled: false } }, project: { sandbox: { enabled: true, allowUnsandboxedCommands: false } }, asks: ['sandbox'], unixOnly: true },
  { name: 'personal-overrides', local: null, project: { skillOverrides: { [NAMES.personal]: 'off' } }, asks: [MODEL, 'typed-personal'] },
  { name: 'personal-deny', local: null, project: { permissions: { deny: [`Skill(${NAMES.personal})`] } }, asks: [MODEL, 'typed-personal'] },
  { name: 'next-session-off', local: { skillOverrides: { [NAMES.skill]: 'off' } }, asks: [] },
  { name: 'next-session-on', local: null, asks: [] },
  { name: 'next-session-off-again', local: { skillOverrides: { [NAMES.skill]: 'off' } }, asks: [] },
  { name: 'worktree-control', local: null, asks: [], where: 'worktree' },
  { name: 'worktree-local', local: { skillOverrides: { [NAMES.skill]: 'off', [NAMES.command]: 'off' }, permissions: { deny: [`Agent(${NAMES.agent})`] }, enabledPlugins: { [PLUGIN_ID]: false } }, asks: [MODEL], where: 'worktree' },
  { name: 'move-skip-worktree', local: null, asks: [], move: 'parts', where: ['main', 'worktree'] },
  { name: 'hook-skip-worktree', local: null, asks: [], move: 'hook' },
];

const MODEL_PROMPT = [
  'This is an automated check in a scratch folder; nothing here matters outside it.',
  'Do these four steps in order. If a step is refused or fails, note it and go on to the next. Do nothing else.',
  `1. Call the Skill tool with the skill "${NAMES.skill}".`,
  `2. Call the Skill tool with the skill "${NAMES.personal}".`,
  `3. Call the Agent tool with subagent_type "${NAMES.agent}" and the prompt "step3".`,
  `4. Call the Agent tool with subagent_type "${NAMES.plugin}:${NAMES.agent}" and the prompt "step4".`,
  'Then reply with one line per step: the step number and what happened.',
].join('\n');

function sandboxPrompt(target) {
  return `This is an automated check in a scratch folder. Run exactly this command with the Bash tool, once, and do not retry it any other way: node -e "require('fs').writeFileSync(process.argv[1], 'x')" "${slash(target)}"\nThen reply with its output or its error.`;
}

const PROMPTS = {
  'typed-skill': `/${NAMES.skill}`,
  'typed-command': `/${NAMES.command}`,
  'typed-personal': `/${NAMES.personal}`,
};

export function planText({ options, found, fixtures, personalDir }) {
  const lines = [];
  lines.push('Check 50 would do this with --go (nothing below has been done):');
  lines.push(`  Copies of these user files, compared at the end: ${userFiles().map((file) => file.path).join(', ')}`);
  lines.push(`  Copies of Claude Code: ${found.map((one) => `${one.label} (${one.resolved.file})`).join('; ') || 'none found'}`);
  if (!options.terminalOnly && !found.some((one) => one.label === 'desktop')) lines.push('  The Desktop app\'s copy was not found: pass --desktop-claude <path>, or --terminal-only.');
  lines.push(`  Scratch folders (made and removed just now as a check): ${fixtures.root}`);
  for (const part of ['project', 'plugin']) lines.push(`    ${part}/: ${listFiles(fixtures[part]).join(', ')}`);
  lines.push(`  A personal skill folder, removed at the end: ${personalDir}`);
  lines.push(`  claude plugin marketplace add <marketplace> --scope project; claude plugin install ${PLUGIN_ID} --scope project (in the project), then a git worktree of the project`);
  lines.push('  For each trial and each copy of Claude Code: write the settings, start `claude -p --input-format stream-json --output-format stream-json --verbose`');
  lines.push('  in the project without sending anything, read the init event and stop the session; then the turns the trial asks for:');
  let turns = 0;
  for (const trial of TRIALS) {
    if (trial.unixOnly && process.platform === 'win32') continue;
    turns += trial.asks.length;
    const where = Array.isArray(trial.where) ? trial.where.join(' and ') : (trial.where ?? 'main');
    const writes = [trial.local ? `local ${JSON.stringify(trial.local)}` : 'no local settings', trial.project ? `project + ${JSON.stringify(trial.project)}` : '', trial.move ? `move: ${trial.move}, skip-worktree` : ''].filter(Boolean).join('; ');
    lines.push(`    ${trial.name} (${where}): ${writes}; asks: ${trial.asks.join(', ') || 'init only'}`);
  }
  const sessions = turns * found.length;
  lines.push(`  ${sessions} short model sessions and about ${TRIALS.length * found.length + 4} init reads; about ${Math.round(sessions * 0.75 + 10)} minutes.`);
  lines.push(`  Model: ${options.model || 'the account default'}.`);
  lines.push('  Then: uninstall, remove the marketplace, the scratch cache folder, the personal skill and the scratch folders, and compare the copied files.');
  return lines.join('\n');
}

// ------------------------------------------------------------ user files

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function globalIgnoreFile() {
  try {
    const set = execFileSync('git', ['config', '--global', '--get', 'core.excludesFile'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (set) return set.startsWith('~') ? path.join(os.homedir(), set.slice(1)) : set;
  } catch { /* not set */ }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'git', 'ignore');
}

function userFiles() {
  const plugins = path.join(configDir(), 'plugins');
  return [
    { name: 'known_marketplaces.json', path: path.join(plugins, 'known_marketplaces.json') },
    { name: 'installed_plugins.json', path: path.join(plugins, 'installed_plugins.json') },
    { name: 'settings.json', path: path.join(configDir(), 'settings.json') },
    // Claude Code's own state file: beside the config folder, or inside it when one is set.
    { name: '.claude.json', path: process.env.CLAUDE_CONFIG_DIR ? path.join(configDir(), '.claude.json') : path.join(os.homedir(), '.claude.json'), state: true },
    // Claude Code adds its local settings file here the first time it writes one (settings documentation).
    { name: 'git-global-ignore', path: globalIgnoreFile() },
  ];
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// --------------------------------------------------------------- sessions

const live = new Set();

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  } else {
    child.kill('SIGTERM');
  }
}

function sessionArgs(options, extra = []) {
  return [...extra, ...(options.model ? ['--model', options.model] : [])];
}

const env = withoutHostVariables(process.env);

// Runs a program like scripts/lib/run.js's `run`, but keeps the child in `live`
// while it runs, so a stop signal ends it before the undo deletes its folder.
function runLive(file, args, { cwd, input = '', timeoutMs, verbatim = false, limit = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error.message) });
      return;
    }
    live.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      live.delete(child);
      resolve({ stdout, stderr, ...result });
    };
    const timer = setTimeout(() => { stopChild(child); finish({ code: 1, timedOut: true }); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-limit); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-limit); });
    child.on('error', (error) => finish({ code: -1, stderr: `${stderr}${error.message}` }));
    child.on('close', (code) => finish({ code: code ?? 1 }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// The copies of Claude Code whose init event did not come without input: after
// the first such read, the rest of the run goes straight to the prompt, rather
// than waiting INIT_WAIT_MS each time. Recorded in the findings.
const noInputInit = new Map();

// Starts a session that is sent nothing, waits for its init event, and stops it
// there. If no init event comes without input, tries once more with a prompt and
// stops it at the init event, and says so (beforeModel false).
async function readInit(binary, cwd, options) {
  let firstTry = noInputInit.get(binary.label)?.why ?? null;
  if (!noInputInit.has(binary.label)) {
    const first = await initFrom(binary, cwd, options, undefined);
    if (first.init) return first;
    firstTry = first.why;
    noInputInit.set(binary.label, { why: first.why, stderr: first.stderr });
  }
  const second = await initFrom(binary, cwd, options, 'Reply with the word ready.');
  return { ...second, init: second.init ? { ...second.init, beforeModel: false } : null, firstTry };
}

// The init event's plugins as names, whatever shape each entry has.
export function pluginNames(plugins) {
  if (!Array.isArray(plugins)) return null;
  return plugins
    .map((plugin) => (typeof plugin === 'string' ? plugin : (typeof plugin?.name === 'string' ? plugin.name : null)))
    .filter((name) => name !== null);
}

// A list of names from the init event, or null when it is not a list.
function names(list) {
  return Array.isArray(list) ? list.filter((entry) => typeof entry === 'string') : null;
}

function initFrom(binary, cwd, options, prompt) {
  const args = prompt === undefined
    ? sessionArgs(options, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'])
    : sessionArgs(options, ['--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--max-turns', '1']);
  const call = invocation(binary.resolved, [], args, prompt);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(call.file, call.args, { cwd, env, shell: false, windowsHide: true, windowsVerbatimArguments: call.verbatim, stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child);
    let buffer = '';
    let stderr = '';
    const before = [];
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stopChild(child);
      live.delete(child);
      resolve({ ms: Date.now() - started, before, stderr: stderr.slice(-2000), ...result });
    };
    const timer = setTimeout(() => finish({ init: null, why: `no init event in ${INIT_WAIT_MS / 1000} s` }), INIT_WAIT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { before.push('unparsed'); continue; }
        if (event.type === 'system' && event.subtype === 'init') {
          const modelSpoke = before.includes('assistant') || before.includes('result');
          finish({
            init: {
              skills: names(event.skills),
              agents: names(event.agents),
              slashCommands: names(event.slash_commands),
              plugins: pluginNames(event.plugins),
              pluginErrors: event.plugin_errors ?? [],
              version: event.claude_code_version ?? null,
              beforeModel: prompt === undefined && !modelSpoke,
            },
          });
          return;
        }
        before.push(event.subtype ? `${event.type}/${event.subtype}` : event.type);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ init: null, why: String(error.message) }));
    child.on('close', (code) => finish({ init: null, why: `exited with ${code} before an init event` }));
    child.stdin.on('error', () => {});
    if (prompt === undefined) {
      // Stays open and empty: nothing is sent, so no model call can start.
    } else {
      child.stdin.end(call.input);
    }
  });
}

// What each tool call got back, from the tool_result blocks.
function toolResults(events) {
  const out = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
      out.set(block.tool_use_id, { isError: block.is_error === true, text: text.slice(0, 400) });
    }
  }
  return out;
}

async function turn(binary, cwd, prompt, options, extraAllowed = []) {
  const args = sessionArgs(options, [
    '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--max-turns', '12',
    '--allowedTools', 'Skill', 'Agent', 'Write', 'Read', ...extraAllowed,
  ]);
  const call = invocation(binary.resolved, [], args, prompt);
  const result = await runLive(call.file, call.args, { cwd, input: call.input, timeoutMs: TURN_MS, verbatim: call.verbatim });
  const events = parseStream(result.stdout);
  const results = toolResults(events);
  const calls = [];
  for (const event of events) {
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block.type !== 'tool_use') continue;
      calls.push({ name: block.name, input: block.input ?? {}, inSubagent: Boolean(event.parent_tool_use_id), result: results.get(block.id) ?? null });
    }
  }
  return {
    code: result.code,
    timedOut: Boolean(result.timedOut),
    calls,
    text: finalText(events).slice(0, 1500),
    stderr: result.code !== 0 ? result.stderr.slice(-1500) : '',
  };
}

function markers(dir) {
  try { return fs.readdirSync(path.join(dir, 'ran')).map((name) => name.replace(/\.txt$/, '')).sort(); } catch { return []; }
}

function clearMarkers(...dirs) {
  for (const dir of dirs) fs.rmSync(path.join(dir, 'ran'), { recursive: true, force: true });
}

// --------------------------------------------------------------- the --go run

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const found = binaries(options);
  const personalDir = path.join(configDir(), 'skills', NAMES.personal);

  if (!options.go) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-50-dry-'));
    try {
      const fixtures = makeFixtures(root);
      console.log(planText({ options, found, fixtures, personalDir }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    console.log('\nNothing was changed. Run with --go, once the director has said yes.');
    return;
  }

  if (!found.length) {
    console.error('No copy of Claude Code was found (neither `claude` on the path nor the Desktop app\'s copy): nothing was changed.');
    console.error('Install Claude Code, or pass --desktop-claude <path>.');
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = probeLogDir(CHECK);
  const logFile = path.join(logDir, `run-${stamp}.jsonl`);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-50-out-'));
  assertUnderTmp(outDir);
  const note = async (step, data) => {
    console.log(`[${step}] ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 600)}`);
    // The log never stops the run or the undo.
    try { await appendJsonl(logFile, { step, ...(typeof data === 'string' ? { text: data } : data) }); } catch (error) { console.error(`(log not written: ${error.message})`); }
  };

  // 0. Copies of the user's files.
  const files = userFiles();
  const backed = {};
  for (const file of files) {
    const copy = path.join(outDir, file.name);
    backed[file.path] = fs.existsSync(file.path) ? (fs.copyFileSync(file.path, copy), copy) : null;
  }
  console.log(`Copies of your files, and the findings at the end, are in: ${outDir}`);
  console.log(`The log is: ${logFile}`);
  await note('backup', { outDir, files: backed });

  const plugins = path.join(configDir(), 'plugins');
  const knownFile = path.join(plugins, 'known_marketplaces.json');
  const scratchCache = path.join(plugins, 'cache', MARKETPLACE_NAME);
  if ((readJson(knownFile) ?? {})[MARKETPLACE_NAME]) throw new Error(`${MARKETPLACE_NAME} is already registered: stopping so nothing is overwritten`);
  if (fs.existsSync(scratchCache)) throw new Error(`${scratchCache} already exists: stopping so nothing is overwritten`);
  if (fs.existsSync(personalDir)) throw new Error(`${personalDir} already exists: stopping so nothing is overwritten`);

  let fixtures = null;
  let ownsMarketplace = false;
  let ownsPersonal = false;
  let stopping = false;
  let undoPromise = null;
  const trials = [];
  const problems = [];

  const claudeCli = async (step, args, cwd) => {
    const call = invocation(found[0].resolved, [], args, undefined);
    const result = await runLive(call.file, call.args, { cwd, timeoutMs: 300_000, verbatim: call.verbatim });
    await note(step, { command: `claude ${args.join(' ')}`, code: result.code, stdout: result.stdout.slice(0, 4000), stderr: result.stderr.slice(0, 2000) });
    return result;
  };

  const undo = () => {
    undoPromise ??= (async () => {
      const attempt = async (what, work) => {
        try { await work(); } catch (error) { problems.push(`${what}: ${error.message}`); await note(`error: ${what}`, { message: String(error.stack ?? error) }); }
      };
      if (ownsMarketplace && fixtures) {
        await attempt('uninstall', () => claudeCli('uninstall', ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'project'], fixtures.project));
        await attempt('remove marketplace', () => claudeCli('remove marketplace (project scope)', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME, '--scope', 'project'], fixtures.project));
        if ((readJson(knownFile) ?? {})[MARKETPLACE_NAME]) {
          await attempt('remove marketplace everywhere', () => claudeCli('remove marketplace (every scope)', ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME], fixtures.project));
        }
        if (path.basename(scratchCache) === MARKETPLACE_NAME && fs.existsSync(scratchCache)) {
          await attempt('remove the scratch cache folder', () => fs.promises.rm(scratchCache, { recursive: true, force: true }));
        }
      }
      if (ownsPersonal && path.basename(personalDir) === NAMES.personal) {
        await attempt('remove the personal skill', () => fs.promises.rm(personalDir, { recursive: true, force: true }));
      }
      if (fixtures) await attempt('remove the scratch folders', async () => { assertUnderTmp(fixtures.root); await fs.promises.rm(fixtures.root, { recursive: true, force: true }); });
      const differences = [];
      for (const file of files) {
        const now = fs.existsSync(file.path) ? fs.readFileSync(file.path) : null;
        const was = backed[file.path] ? fs.readFileSync(backed[file.path]) : null;
        const same = (now === null && was === null) || (now !== null && was !== null && now.equals(was));
        if (!same) differences.push(file);
        await note(`file compared: ${file.path}`, { same });
      }
      if (fs.existsSync(personalDir)) differences.push({ path: personalDir, name: 'personal skill folder still there' });
      if (differences.length) {
        console.error(`These differ from the copies in ${outDir}; nothing is copied back for you:`);
        for (const file of differences) {
          const back = backed[file.path] ? `cp "${backed[file.path]}" "${file.path}"` : `rm -rf "${file.path}"`;
          console.error(`  ${file.state ? "(Claude Code's own state: copy it back only if you know the probe changed it) " : ''}${back}`);
        }
      }
      if (problems.length) {
        console.error(`Problems while undoing:\n  ${problems.join('\n  ')}`);
        process.exitCode = 1;
      }
      await note('undo finished', { differences: differences.map((file) => file.path), problems });
    })();
    return undoPromise;
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      console.error(`\n${signal}: stopping, then undoing what this run added.`);
      stopping = true;
      for (const child of live) stopChild(child);
      try { await undo(); } catch (error) { console.error(`The undo failed: ${error.message}`); }
      process.exit(signal === 'SIGTERM' ? 143 : 130);
    });
  }
  const keepGoing = () => { if (stopping) throw new Error('stopped by a signal'); };

  try {
    for (const binary of found) {
      const call = invocation(binary.resolved, [], ['--version'], undefined);
      const version = await runLive(call.file, call.args, { timeoutMs: 60_000, verbatim: call.verbatim });
      binary.version = version.stdout.trim();
      await note(`version ${binary.label}`, { file: binary.resolved.file, version: binary.version });
    }

    // 1. The scratch folders, and the personal skill.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-50-'));
    fixtures = makeFixtures(root);
    await note('scratch', { root, files: listFiles(fixtures.project) });
    ownsPersonal = true;
    write(path.join(personalDir, 'SKILL.md'), skillText(NAMES.personal, MARKERS.personal, fixtures.project, 'Personal scratch skill for check 50.'));
    keepGoing();

    // 2. The plugin, installed at project scope; then commit what that wrote so
    // the project's committed settings hold it, and make a worktree.
    console.log('\nAbout to change this computer\'s plugin list. If this run is stopped and the undo does not finish, run these:');
    console.log(`  (cd "${fixtures.project}" && claude plugin uninstall ${PLUGIN_ID} --scope project)`);
    console.log(`  (cd "${fixtures.project}" && claude plugin marketplace remove ${MARKETPLACE_NAME})`);
    console.log(`  rm -rf "${scratchCache}" "${personalDir}"\n`);
    ownsMarketplace = true;
    const added = await claudeCli('marketplace add', ['plugin', 'marketplace', 'add', fixtures.marketplace, '--scope', 'project'], fixtures.project);
    if (added.code !== 0) throw new Error('the marketplace could not be added: stopping');
    const installed = await claudeCli('install', ['plugin', 'install', PLUGIN_ID, '--scope', 'project'], fixtures.project);
    if (installed.code !== 0) throw new Error('the plugin could not be installed: stopping');
    git(fixtures.project, ['add', '--all']);
    git(fixtures.project, ['commit', '--quiet', '-m', 'The scratch plugin at project scope']);
    git(fixtures.project, ['worktree', 'add', '--quiet', fixtures.worktree, '-b', 'probe-worktree']);
    const settingsFile = path.join(fixtures.project, '.claude', 'settings.json');
    const localFile = path.join(fixtures.project, '.claude', 'settings.local.json');
    const baseSettings = fs.readFileSync(settingsFile, 'utf8');
    await note('project settings after install', JSON.parse(baseSettings));

    // 3. The trials.
    for (const trial of TRIALS) {
      if (trial.unixOnly && process.platform === 'win32') {
        await note(`skip ${trial.name}`, 'the sandbox does not run on Windows (check 10)');
        continue;
      }
      keepGoing();
      if (trial.local) write(localFile, JSON.stringify(trial.local, null, 2) + '\n');
      else fs.rmSync(localFile, { force: true });
      if (trial.project) write(settingsFile, JSON.stringify({ ...JSON.parse(baseSettings), ...trial.project }, null, 2) + '\n');
      const moved = [];
      let gitState = null;
      if (trial.move) {
        const parts = trial.move === 'parts'
          ? [path.join('.claude', 'skills', NAMES.skill), path.join('.claude', 'agents', `${NAMES.agent}.md`), path.join('.claude', 'commands', `${NAMES.command}.md`)]
          : [path.join('.claude', 'settings.json')];
        const tracked = git(fixtures.project, ['ls-files', '--', ...parts.map(slash)]).split('\n').filter(Boolean);
        if (trial.move === 'parts') {
          for (const part of parts) {
            const target = path.join(fixtures.off, part);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.renameSync(path.join(fixtures.project, part), target);
            moved.push(part);
          }
        } else {
          const without = JSON.parse(baseSettings);
          delete without.hooks;
          write(settingsFile, JSON.stringify(without, null, 2) + '\n');
        }
        git(fixtures.project, ['update-index', '--skip-worktree', '--', ...tracked]);
        const status = git(fixtures.project, ['status', '--porcelain']);
        git(fixtures.project, ['add', '--all']);
        const staged = git(fixtures.project, ['diff', '--cached', '--name-only']);
        git(fixtures.project, ['reset', '--quiet']);
        gitState = { statusClean: status === '', nothingStaged: staged === '', status, staged, tracked };
        await note(`git after ${trial.name}`, gitState);
      }
      await note(`trial ${trial.name}`, { local: trial.local, project: trial.project ?? null, move: trial.move ?? null });

      const wheres = Array.isArray(trial.where) ? trial.where : [trial.where ?? 'main'];
      for (const where of wheres) {
        const cwd = where === 'worktree' ? fixtures.worktree : fixtures.project;
        for (const binary of found) {
          keepGoing();
          clearMarkers(fixtures.project, fixtures.worktree);
          const init = await readInit(binary, cwd, options);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const record = {
            name: trial.name,
            binary: binary.label,
            version: binary.version,
            where,
            init: init.init,
            initDetail: { ms: init.ms, before: init.before, why: init.why ?? null, firstTry: init.firstTry ?? null, stderr: init.init ? '' : init.stderr },
            hooksRan: markers(cwd).filter((name) => name.startsWith('hook-')),
            turns: {},
            git: gitState,
          };
          for (const ask of trial.asks) {
            keepGoing();
            clearMarkers(fixtures.project, fixtures.worktree);
            if (ask === 'sandbox') {
              const target = path.join(logDir, `sandbox-${stamp}-${binary.label}-${trial.name}.txt`);
              fs.rmSync(target, { force: true });
              const result = await turn(binary, cwd, sandboxPrompt(target), options, ['Bash(node *)']);
              record.turns.sandbox = { wrote: fs.existsSync(target), ...result };
              fs.rmSync(target, { force: true });
            } else {
              const result = await turn(binary, cwd, ask === MODEL ? MODEL_PROMPT : PROMPTS[ask], options);
              // Skills and agents write their markers into the main project, the hooks into the session's folder.
              record.turns[ask] = { markers: [...new Set([...markers(fixtures.project), ...markers(cwd)])].sort(), ...result };
            }
            await note(`${trial.name} ${binary.label} ${where} ${ask}`, { markers: record.turns[ask].markers ?? null, wrote: record.turns[ask].wrote ?? null, code: record.turns[ask].code });
          }
          trials.push(record);
          await note(`${trial.name} ${binary.label} ${where} init`, { init: record.init, hooksRan: record.hooksRan, detail: record.initDetail });
        }
      }

      // Put the trial back.
      if (trial.move) {
        const tracked = gitState?.tracked ?? [];
        git(fixtures.project, ['update-index', '--no-skip-worktree', '--', ...tracked]);
        for (const part of moved) fs.renameSync(path.join(fixtures.off, part), path.join(fixtures.project, part));
        git(fixtures.project, ['checkout', '--', '.claude/settings.json']);
      }
      if (trial.project) write(settingsFile, baseSettings);
      fs.rmSync(localFile, { force: true });
      const after = git(fixtures.project, ['status', '--porcelain']);
      if (after !== '') await note(`project not clean after ${trial.name}`, after);
    }
  } catch (error) {
    problems.push(`the run: ${error.message}`);
    await note('error', { message: String(error.stack ?? error) });
    console.error(`Stopped: ${error.message}`);
  } finally {
    // 4. The findings, in their own try, so the undo below always runs.
    const findingsFile = path.join(outDir, 'findings.json');
    let findings = null;
    try {
      fs.writeFileSync(path.join(outDir, 'trials.json'), JSON.stringify(trials, null, 2) + '\n', 'utf8');
      findings = {
        check: 50,
        ranOn: new Date().toISOString(),
        platform: process.platform,
        claude: Object.fromEntries(found.map((binary) => [binary.label, binary.version ?? null])),
        initWithoutInput: Object.fromEntries(found.map((binary) => [binary.label, noInputInit.has(binary.label)
          ? { fellBack: true, why: noInputInit.get(binary.label).why }
          : { fellBack: false }])),
        ...summarise(trials),
        complete: problems.length === 0,
      };
      fs.writeFileSync(findingsFile, JSON.stringify(findings, null, 2) + '\n', 'utf8');
    } catch (error) {
      problems.push(`the findings: ${error.message}`);
      console.error(`The findings could not be made: ${error.message} (the trials are in ${path.join(outDir, 'trials.json')} if that was written)`);
    }
    await undo();
    if (findings) {
      console.log(`\nFindings (also in ${findingsFile}; every trial in trials.json beside it):`);
      console.log(JSON.stringify({ ...findings, candidates: undefined }, null, 2));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
