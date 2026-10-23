// scripts/install/survey.js
// The survey: what a project holds before it is switched over to Wheelhouse, read without
// changing anything in it (only `git fetch` moves its remote-tracking refs). Its output feeds the
// private install brief (scripts/install/brief.js); the agent writing the brief decides which parts
// are the first version, from the project's history and what each part does.
//
// What it reads:
// - The project's own parts: each `.claude/skills/*/SKILL.md` and `.claude/agents/*.md` by its
//   front matter's `name`, the `.claude/commands/` files, and the hooks in `.claude/settings.json`.
// - Copies of pinned skills: a project skill whose `name` is a pinned skill's is a copy when its
//   SKILL.md, line endings made LF, has the git blob hash of that skill's SKILL.md at some commit
//   of the upstream (`git log --all --find-object` in a clone given in `upstreams`). Any other
//   name match is kept and named, "same name, own content".
// - Work in flight: how far the checkout's HEAD is behind its remote's default branch (after a
//   fetch), whether the checkout is on that branch, local changes, open pull or merge requests
//   (`gh pr list` or `glab mr list`, read only), and worktrees.
// - The commands the project's `.claude/` files name (gh, glab, git, npm, npx and the deploy
//   tools), each with the files that name it, and those that Standard's deny rules would still
//   refuse once the project is switched back. The sandbox is left out: switching back turns it off.
// - The director's plugins (user settings and synced copies) and personal skills, each with its
//   description, leaving out Wheelhouse, its pins and the copies its settings already switch off.
// - Scheduled tasks: Claude Code records no folder in a scheduled task's own files, so the caller
//   passes the list (`scheduled`, as `{ name, folder, path? }`), and the survey keeps this project's.
//   With no list given, `scheduled` is null: not read, which is not the same as none.
//
// Git never runs the project's own code here: every call goes through the fenced git route
// (scripts/lib/safe-git.js), which shuts out the global and system config, points hooks at the null
// file, turns fsmonitor off, and looks at the repository's own config first, refusing any setting
// that could run a program (the project's, and each worktree's, since an agent can write to both).
// The fetch's ssh never asks for a passphrase.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run as defaultRun } from '../lib/run.js';
import { directorSignIn, reachFor, safeGit } from '../lib/safe-git.js';
import { claudeHome as defaultClaudeHome, MARKETPLACE } from '../lineage/manifest.js';
import { HOST_TOOLS, projectSettings, SWITCHED_OFF_PLUGINS } from '../protection/settings.js';

export const SAME_NAME = 'same name, own content';
const COMMAND_WORDS = new Set(['gh', 'glab', 'git', 'npm', 'npx', 'bunx', ...HOST_TOOLS]);
// Package runners of two words, which Standard's deny rules also name (`pnpm dlx vercel`).
const RUNNER_FIRSTS = new Map([['pnpm', 'dlx'], ['yarn', 'dlx']]);
// Words after which a command still starts, in a shell line.
const LEADS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'exec', 'command', 'sudo', 'xargs', 'env']);
const OPERATOR = /^[;&|()`]+$/;
const ARGUMENT = /^(?:[A-Za-z0-9@][\w@.:/+=-]*|--?[A-Za-z][\w-]*(?:=[^\s"'`;&|()]*)?)$/;
const MOST_ARGUMENTS = 3;
const GIT_WAIT_MS = 120000;
// How deep the survey walks into .claude/, so a folder link that loops ends.
const MOST_DEPTH = 8;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const posix = (...parts) => parts.join('/');

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
// A folder's entries; a link counts as what it points at.
function entries(dir) {
  let found;
  try { found = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return found.map((e) => {
    if (!e.isSymbolicLink()) return e;
    const target = fs.statSync(path.join(dir, e.name), { throwIfNoEntry: false });
    return { name: e.name, isDirectory: () => Boolean(target?.isDirectory()), isFile: () => Boolean(target?.isFile()) };
  });
}

// The `key: value` lines of a file's front matter, quotes taken off.
export function frontMatter(text) {
  const lf = String(text).replace(/\r\n/g, '\n');
  if (!lf.startsWith('---\n')) return {};
  const end = lf.indexOf('\n---', 3);
  if (end === -1) return {};
  const fields = {};
  for (const line of lf.slice(4, end).split('\n')) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

// Git's blob hash of `bytes` with CRLF line endings made LF, worked out here, not by git.
export function blobHash(bytes) {
  const lf = Buffer.from(Buffer.from(bytes).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha1').update(`blob ${lf.length}\0`).update(lf).digest('hex');
}

// Whether two paths are the same folder: as given and as their real paths, case folded where the
// system folds it.
function sameFolder(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const fold = process.platform === 'win32' || process.platform === 'darwin';
  const forms = (p) => {
    const given = path.resolve(p);
    let real = given;
    try { real = fs.realpathSync.native(given); } catch { /* not there */ }
    return [given, real].map((x) => (fold ? x.toLowerCase() : x));
  };
  const theirs = forms(b);
  return forms(a).some((x) => theirs.includes(x));
}

// --- The project's own parts ---

function readSkills(folder) {
  const dir = path.join(folder, '.claude', 'skills');
  return entries(dir).filter((e) => e.isDirectory()).flatMap((e) => {
    const text = readText(path.join(dir, e.name, 'SKILL.md'));
    if (text === null) return [];
    const fm = frontMatter(text);
    return [{ name: fm.name || e.name, description: fm.description ?? '', path: posix('.claude', 'skills', e.name) }];
  }).sort(byName);
}

function readAgents(folder) {
  const dir = path.join(folder, '.claude', 'agents');
  return entries(dir).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => {
    const fm = frontMatter(readText(path.join(dir, e.name)) ?? '');
    return { name: fm.name || e.name.slice(0, -3), description: fm.description ?? '', path: posix('.claude', 'agents', e.name) };
  }).sort(byName);
}

function readCommands(folder) {
  const found = [];
  const walk = (dir, parts) => {
    for (const e of entries(dir)) {
      if (e.isDirectory()) { if (parts.length < MOST_DEPTH) walk(path.join(dir, e.name), [...parts, e.name]); }
      else if (e.isFile() && e.name.endsWith('.md')) {
        const fm = frontMatter(readText(path.join(dir, e.name)) ?? '');
        found.push({ name: e.name.slice(0, -3), description: fm.description ?? '', path: posix('.claude', 'commands', ...parts, e.name) });
      }
    }
  };
  walk(path.join(folder, '.claude', 'commands'), []);
  return found.sort(byName);
}

function readHooks(folder) {
  const file = path.join(folder, '.claude', 'settings.json');
  const text = readText(file);
  if (text === null) return [];
  let settings;
  try { settings = JSON.parse(text); } catch { throw new Error('The project\'s .claude/settings.json isn\'t JSON'); }
  const hooks = [];
  for (const [event, groups] of Object.entries(isObject(settings?.hooks) ? settings.hooks : {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = typeof hook?.command === 'string' ? hook.command : `a ${hook?.type ?? 'hook'} hook`;
        hooks.push({ event, matcher: typeof group.matcher === 'string' ? group.matcher : null, command, path: '.claude/settings.json' });
      }
    }
  }
  return hooks;
}

// --- Copies of pinned skills ---

// Each pinned skill by name: [{ upstream, folder }]. A manifest's folders are { path } objects;
// the pins in scripts/lineage/manifest.js are plain paths.
function pinnedSkills(manifest) {
  const pinned = new Map();
  for (const upstream of manifest?.upstreams ?? []) {
    for (const entry of upstream.folders ?? []) {
      const folder = typeof entry === 'string' ? entry : entry?.path;
      if (typeof folder !== 'string') continue;
      const name = folder.split('/').at(-1);
      pinned.set(name, [...(pinned.get(name) ?? []), { upstream, folder }]);
    }
  }
  return pinned;
}

// The names of the upstreams whose pinned skills share a name with one of the project's skills in
// `folder`: the only ones the survey needs a clone of.
export function upstreamsNeeded({ folder, manifest }) {
  const pinned = pinnedSkills(manifest);
  const names = new Set();
  for (const skill of readSkills(folder)) for (const { upstream } of pinned.get(skill.name) ?? []) names.add(upstream.name);
  return (manifest?.upstreams ?? []).map((u) => u.name).filter((name) => names.has(name));
}

async function sortCopies({ folder, skills, manifest, upstreams, git }) {
  const pinned = pinnedSkills(manifest);
  const copies = [];
  const keep = [];
  for (const skill of skills) {
    const matches = pinned.get(skill.name);
    if (!matches) continue;
    const blob = blobHash(fs.readFileSync(path.join(folder, ...skill.path.split('/'), 'SKILL.md')));
    let copyOf = null;
    for (const { upstream, folder: pinnedFolder } of matches) {
      const clone = upstreams[upstream.name];
      if (typeof clone !== 'string') throw new Error(`No copy of ${upstream.name} was given to compare the project's ${skill.name} skill with`);
      // The clone is a new temporary folder of Wheelhouse's own, made by the install command, so the
      // look is not needed there.
      const found = await git(['log', '--all', '--format=%H', `--find-object=${blob}`, '--', `${pinnedFolder}/SKILL.md`], clone, { look: 'never' });
      if (found.trim() !== '') { copyOf = upstream; break; }
    }
    if (copyOf) copies.push({ name: skill.name, path: skill.path, plugin: copyOf.plugin });
    else keep.push({ name: skill.name, path: skill.path, why: SAME_NAME });
  }
  return { copies, keep };
}

// --- Commands named ---

// The parts of a Markdown file that are code: fenced blocks' lines and inline code spans.
function codeOf(text) {
  const chunks = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) { chunks.push(line); continue; }
    for (const m of line.matchAll(/(`+)([^`]+?)\1/g)) chunks.push(m[2]);
  }
  return chunks;
}

function stringsOf(value, into = []) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsOf(v, into));
  else if (isObject(value)) Object.values(value).forEach((v) => stringsOf(v, into));
  return into;
}

// The commands in one piece of shell text: a command word at the start, after an operator or
// after a word such as `if`, with up to three arguments that look like plain words or options.
export function commandsIn(chunk) {
  const tokens = chunk.match(/[;&|()`]+|[^\s;&|()`]+/g) ?? [];
  const found = [];
  let starts = true;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (OPERATOR.test(token)) { starts = true; continue; }
    const word = token.replace(/^[$"']+/, '');
    const runner = starts && RUNNER_FIRSTS.has(word) && RUNNER_FIRSTS.get(word) === tokens[i + 1];
    if (starts && (COMMAND_WORDS.has(word) || runner)) {
      const parts = [word];
      if (runner) parts.push(tokens[(i += 1)]);
      const most = parts.length + MOST_ARGUMENTS - 1;
      // A closing quote ends the command with the argument it follows.
      while (parts.length <= most && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        const bare = next.replace(/["']+$/, '');
        if (!ARGUMENT.test(bare)) break;
        parts.push(bare);
        i += 1;
        if (bare !== next) break;
      }
      found.push(parts.join(' '));
      starts = false;
      continue;
    }
    starts = LEADS.has(word);
  }
  return found;
}

function commandsNamedIn(folder) {
  const named = new Map();
  const walk = (dir, parts) => {
    for (const e of entries(dir)) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (parts.length < MOST_DEPTH) walk(full, [...parts, e.name]); continue; }
      if (!e.isFile() || (parts.length === 1 && e.name === 'settings.local.json')) continue;
      let bytes;
      try { bytes = fs.readFileSync(full); } catch { continue; }
      if (bytes.includes(0)) continue;
      const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
      let chunks;
      if (e.name.endsWith('.md')) chunks = codeOf(text);
      else if (e.name.endsWith('.json')) {
        try { chunks = stringsOf(JSON.parse(text)); } catch { chunks = text.split('\n'); }
      } else chunks = text.split('\n');
      const where = posix(...parts, e.name);
      for (const command of chunks.flatMap(commandsIn)) {
        if (!named.has(command)) named.set(command, new Set());
        named.get(command).add(where);
      }
    }
  };
  walk(path.join(folder, '.claude'), ['.claude']);
  return [...named].map(([command, paths]) => ({ command, paths: [...paths].sort() }))
    .sort((a, b) => (a.command < b.command ? -1 : a.command > b.command ? 1 : 0));
}

// Whether a `Bash(...)` permission rule matches a command, as Claude Code reads one: `x:*` is `x`
// alone or `x` and a space, a trailing `*` any continuation, otherwise the command exactly.
export function bashRuleMatches(rule, command) {
  const m = /^Bash\((.*)\)$/.exec(rule);
  if (!m) return false;
  const body = m[1];
  if (body.endsWith(':*')) {
    const prefix = body.slice(0, -2);
    return command === prefix || command.startsWith(`${prefix} `);
  }
  if (body.endsWith('*')) return command.startsWith(body.slice(0, -1));
  return command === body;
}

// Those of `named` that Standard's deny rules refuse, each with the first rule that does.
export function deniedByStandard(named) {
  const rules = projectSettings({ webDomains: [] }).permissions.deny.filter((r) => r.startsWith('Bash('));
  return named.flatMap(({ command, paths }) => {
    const rule = rules.find((r) => bashRuleMatches(r, command));
    return rule ? [{ command, paths, rule }] : [];
  });
}

// --- Work in flight ---

// The ssh command for the survey's fetch: the director's own GIT_SSH_COMMAND, else plain ssh, with
// BatchMode on, so a passphrase prompt fails at once instead of waiting. The project's own
// core.sshCommand is never read: a repository that sets it is refused by the look.
export function batchSshCommand({ env = process.env } = {}) {
  const own = typeof env.GIT_SSH_COMMAND === 'string' && env.GIT_SSH_COMMAND.trim() !== '' ? env.GIT_SSH_COMMAND.trim() : '';
  return `${own || 'ssh'} -o BatchMode=yes`;
}

// How the fetch reaches an origin's address: 'ssh' for ssh:// and scp-style (user@host:path),
// (the user is optional, as an ~/.ssh/config alias has none; a host of two or more characters keeps
// `C:` a drive letter), else what reachFor says ('https', or 'local' for a path on this computer).
const SCP_STYLE = /^(?:[^\s/\\@:]+@)?[^\s/\\:]{2,}:(?!\/\/|:)/;
export function reachOfOrigin(url, { platform = process.platform } = {}) {
  return /^ssh:\/\//i.test(url) || SCP_STYLE.test(url) ? 'ssh' : reachFor(url, { platform });
}

async function readInFlight({ folder, host, git, run, sshEnv }) {
  const remotes = (await git(['remote'])).split('\n').map((r) => r.trim()).filter(Boolean);
  let behind = 0;
  let onDefault = false;
  let prs = [];
  if (remotes.includes('origin')) {
    const originUrl = (await git(['remote', 'get-url', 'origin'], folder, { allowFail: true })).trim();
    const reach = reachOfOrigin(originUrl);
    // ssh uses the director's own command with BatchMode; https signs in through the host tool.
    const env = reach === 'ssh' ? { GIT_SSH_COMMAND: batchSshCommand({ env: sshEnv }) } : reach === 'https' ? directorSignIn(host) : {};
    await git(['fetch', '--quiet', 'origin'], folder, { env, reach });
    let ref = (await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], folder, { allowFail: true })).trim();
    if (ref === '') {
      for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
        if ((await git(['rev-parse', '--verify', '--quiet', candidate], folder, { allowFail: true })).trim() !== '') { ref = candidate; break; }
      }
    }
    // Counted from HEAD, whichever branch is checked out: `onDefault` says whether that is the
    // default branch, so nothing fast-forwards a checkout on another branch.
    if (ref !== '') {
      behind = Number.parseInt((await git(['rev-list', '--count', `HEAD..${ref}`])).trim(), 10) || 0;
      const branch = (await git(['symbolic-ref', '--quiet', 'HEAD'], folder, { allowFail: true })).trim();
      onDefault = branch !== '' && branch === `refs/heads/${ref.slice('refs/remotes/origin/'.length)}`;
    }
    prs = await openRequests({ originUrl, host, run });
  }
  const dirty = (await git(['status', '--porcelain', '--ignore-submodules=dirty'])).trim() !== '';
  const worktrees = [];
  const blocks = (await git(['worktree', 'list', '--porcelain'])).replace(/\r\n/g, '\n').split('\n\n').filter((b) => b.trim() !== '');
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length);
    // The folder surveyed, and a bare main repository, are not work left in flight.
    if (!at || lines.includes('bare') || sameFolder(at, folder)) continue;
    const branchLine = lines.find((l) => l.startsWith('branch '));
    const branch = branchLine ? branchLine.slice('branch '.length).replace(/^refs\/heads\//, '') : null;
    const there = fs.existsSync(at);
    // Looked at in its own folder: an agent can write a worktree's config too.
    const changed = there ? (await git(['status', '--porcelain', '--ignore-submodules=dirty'], at, { allowFail: true })).trim() !== '' : false;
    worktrees.push({ path: at, branch, dirty: changed });
  }
  return { behind, dirty, onDefault, prs, worktrees };
}

// What `-R` takes: an optional host, then owner and name (GitLab: group, subgroups, name).
const REPOSITORY = /^([a-z0-9.-]+(:[0-9]+)?\/)?[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;

// The repository an origin address names: `{ hostname, repo }` (`hostname` null for a path on this computer;
// `repo` is `[HOST/]OWNER/NAME`, the host written only when it is not the tool's own public host), or null
// when the address names none or holds anything `-R` should not be given.
export function originRepository(originUrl, host) {
  const text = String(originUrl ?? '').trim().replaceAll('\\', '/');
  let hostname = null;
  let rest = text;
  const url = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^/@]*@)?([^/:]+)(?::\d+)?(\/.*)?$/.exec(text);
  if (text.includes('://') && url === null) return null;
  const scp = /^(?:[^/@\s]+@)?([^/:\s]{2,}):(?!\/)(.*)$/.exec(text);
  if (url && !/^file:/i.test(text)) { hostname = url[1].toLowerCase(); rest = url[2] ?? ''; } else if (scp) { hostname = scp[1].toLowerCase(); rest = scp[2]; }
  const parts = rest.replace(/\.git\/?$/i, '').split('/').filter(Boolean);
  const named = host === 'gitlab' && hostname !== null ? parts : parts.slice(-2);
  if (named.length < 2) return null;
  const own = hostname === null || hostname === (host === 'gitlab' ? 'gitlab.com' : 'github.com');
  const repo = `${own ? '' : `${hostname}/`}${named.join('/')}`;
  return REPOSITORY.test(repo) ? { hostname: own ? null : hostname, repo } : null;
}
export const repositoryOf = (originUrl, host) => originRepository(originUrl, host)?.repo ?? null;

// Variables that would send the director's own token to the host an origin address names.
const TOKEN_VARIABLES = ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'GITLAB_HOST'];
const withoutTokens = () => ({ ...Object.fromEntries(TOKEN_VARIABLES.map((n) => [n, undefined])), GH_PROMPT_DISABLED: '1', NO_COLOR: '1' });

async function openRequests({ originUrl, host, run }) {
  const named = originRepository(originUrl, host);
  if (named === null) throw new Error('the origin address does not name a repository, so its open requests could not be listed');
  const tool = host === 'gitlab' ? 'glab' : 'gh';
  const [file, args] = host === 'gitlab'
    ? [tool, ['mr', 'list', `--repo=${named.repo}`, '--output', 'json', '--per-page', '100']]
    : [tool, ['pr', 'list', `--repo=${named.repo}`, '--state', 'open', '--json', 'number,headRefName', '--limit', '200']];
  // Run outside the project: gh and glab run git themselves, and would read the project's own config.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-survey-'));
  let result;
  try {
    // A host other than the tool's own public one is named only when the director is signed in to it.
    // The token variables are cleared, so a planted origin cannot make the tool send them anywhere.
    if (named.hostname !== null) {
      const auth = await run(tool, ['auth', 'status', '--hostname', named.hostname], { cwd: outside, env: withoutTokens(), timeoutMs: GIT_WAIT_MS });
      if (auth.code !== 0) throw new Error(`${tool} is not signed in to ${named.hostname}, so the open ${host === 'gitlab' ? 'merge' : 'pull'} requests were not listed`);
    }
    result = await run(file, args, { cwd: outside, env: withoutTokens(), timeoutMs: GIT_WAIT_MS });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
  if (result.code !== 0) throw new Error(`${file} could not list the open ${host === 'gitlab' ? 'merge' : 'pull'} requests: ${String(result.stderr).trim().split('\n').pop()}`);
  let listed;
  try { listed = JSON.parse(result.stdout); } catch { throw new Error(`${file} did not answer with a list`); }
  if (!Array.isArray(listed)) throw new Error(`${file} did not answer with a list`);
  return listed.map((r) => (host === 'gitlab' ? { number: r?.iid, branch: r?.source_branch } : { number: r?.number, branch: r?.headRefName }))
    .filter((r) => Number.isInteger(r.number) && typeof r.branch === 'string');
}

// --- The director's plugins and personal skills ---

function pluginDescription(installPath) {
  for (const file of [['.claude-plugin', 'plugin.json'], ['plugin.json']]) {
    const found = readJson(path.join(installPath, ...file));
    if (typeof found?.description === 'string') return found.description;
  }
  return '';
}

function readPlugins({ claudeHome, manifest }) {
  const enabled = readJson(path.join(claudeHome, 'settings.json'))?.enabledPlugins;
  const settings = isObject(enabled) ? enabled : {};
  const ours = new Set([
    ...SWITCHED_OFF_PLUGINS,
    ...(manifest?.upstreams ?? []).map((u) => `${u.plugin}@${MARKETPLACE}`),
  ]);
  const leftOut = (id) => ours.has(id) || id.split('@')[0] === 'wheelhouse' || settings[id] === false;
  const found = new Map();
  const installs = readJson(path.join(claudeHome, 'plugins', 'installed_plugins.json'))?.plugins ?? {};
  for (const [id, on] of Object.entries(settings)) {
    if (on !== true || leftOut(id)) continue;
    const record = (Array.isArray(installs[id]) ? installs[id] : []).find((i) => typeof i?.installPath === 'string');
    found.set(id, record ? pluginDescription(record.installPath) : '');
  }
  // The synced copies the Desktop app keeps, one manifest per account and organisation.
  for (const e of entries(path.join(claudeHome, 'plugins', 'synced'))) {
    if (!e.isDirectory()) continue;
    const listed = readJson(path.join(claudeHome, 'plugins', 'synced', e.name, 'manifest.json'))?.plugins;
    for (const p of Array.isArray(listed) ? listed : []) {
      if (typeof p?.name !== 'string') continue;
      const id = `${p.name}@synced`;
      if (leftOut(id) || found.has(id)) continue;
      found.set(id, typeof p.description === 'string' ? p.description : '');
    }
  }
  return [...found].map(([id, description]) => ({ id, description })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function readPersonalSkills(claudeHome) {
  const dir = path.join(claudeHome, 'skills');
  return entries(dir).filter((e) => e.isDirectory()).flatMap((e) => {
    const text = readText(path.join(dir, e.name, 'SKILL.md'));
    if (text === null) return [];
    const fm = frontMatter(text);
    return [{ name: fm.name || e.name, description: fm.description ?? '' }];
  }).sort(byName);
}

// --- The survey ---

// Surveys the project in `folder`. `manifest` gives the pinned skills; `upstreams` maps each
// upstream's name to a clone of its repository (bare or not) with its whole history; `host` is
// 'github' or 'gitlab', worked out from the remote's address when not given; `scheduled` is
// Claude's scheduled tasks as `{ name, folder, path? }`, or null when no list was given (the
// survey's `scheduled` is then null too); `claudeHome` is the director's Claude folder; `sshEnv`
// is where an existing GIT_SSH_COMMAND is read from.
export async function surveyProject({ folder, manifest, run = defaultRun, upstreams = {}, host = null, scheduled = null, claudeHome = defaultClaudeHome(), sshEnv = process.env }) {
  if (typeof folder !== 'string' || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error('The project folder is not there');
  if (scheduled !== null && !Array.isArray(scheduled)) throw new Error('The scheduled tasks are not a list');
  const project = path.resolve(folder);
  return surveyIn({ project, manifest, run, upstreams, host, scheduled, claudeHome, sshEnv });
}

async function surveyIn({ project, manifest, run, upstreams, host, scheduled, claudeHome, sshEnv }) {
  // One fenced git for each folder, kind of look and reach. A refusal by the look is thrown as it
  // comes, naming the settings, whatever allowFail says.
  const routes = new Map();
  const git = async (args, cwd = project, { allowFail = false, env = {}, reach = 'https', look = 'each' } = {}) => {
    const key = `${look}|${reach}|${cwd}`;
    if (!routes.has(key)) routes.set(key, safeGit({ run, cwd, env: { GIT_OPTIONAL_LOCKS: '0' }, reach, look, list: 'project', timeoutMs: GIT_WAIT_MS, caller: 'survey' }));
    const result = await routes.get(key)(['-c', 'core.quotepath=off', ...args], { env });
    if (result.code !== 0) {
      if (allowFail) return '';
      throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim().split('\n').pop()}`);
    }
    return result.stdout;
  };
  let hostName = host;
  if (hostName === null) {
    const url = (await git(['remote', 'get-url', 'origin'], project, { allowFail: true })).trim();
    hostName = /gitlab/i.test(url) ? 'gitlab' : 'github';
  }
  if (!['github', 'gitlab'].includes(hostName)) throw new Error(`The host is not github or gitlab: ${JSON.stringify(hostName)}`);

  const skills = readSkills(project);
  const { copies, keep } = await sortCopies({ folder: project, skills, manifest, upstreams, git });
  const commandsNamed = commandsNamedIn(project);
  return {
    folder: project,
    host: hostName,
    skills,
    agents: readAgents(project),
    commands: readCommands(project),
    hooks: readHooks(project),
    scheduled: scheduled === null ? null : scheduled
      .filter((t) => typeof t?.name === 'string' && sameFolder(t.folder, project))
      .map((t) => (typeof t.path === 'string' ? { name: t.name, path: t.path } : { name: t.name })),
    copies,
    keep,
    inFlight: await readInFlight({ folder: project, host: hostName, git, run, sshEnv }),
    commandsNamed,
    deniedAfterSwitchBack: deniedByStandard(commandsNamed),
    plugins: readPlugins({ claudeHome, manifest }),
    personalSkills: readPersonalSkills(claudeHome),
  };
}
