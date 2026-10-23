// scripts/survey/look.js
// The survey (design section 15, ruling A1; plan rulings P1 and P2): what a project already holds
// when setup finishes, looked at once and changed in nothing. Work in flight (requests waiting on
// the host, work pushed with no request, work on this computer not on the main line), another agent
// setup's instructions, and scheduled jobs and secret files, counted only. It assumes no shape:
// every part may be empty.
//
// It only reads: git is asked through setup's fenced git (scripts/setup/git.js) for refs, counts,
// subjects and worktrees, never to fetch or write; files are read without following a link.
import fs from 'node:fs';
import path from 'node:path';
import { readStart, isFile } from '../setup/questions.js';
import { STATE_BRANCH } from '../state/clone.js';
import { LOCK_BRANCH } from '../state/lock.js';

// Where another agent setup keeps its instructions, from the project's folder: a list to look in,
// not a shape the project must have. `/**` is every file under that folder.
export const INSTRUCTION_PATHS = Object.freeze([
  '.claude/skills/**', '.claude/agents/**', 'AGENTS.md', '.cursor/rules/**', '.cursorrules',
  '.github/copilot-instructions.md', '.windsurfrules',
]);
// At most this many instruction files are listed, and of CLAUDE.md the first FILE_BYTES are read.
export const INSTRUCTION_FILES = 200;
export const FILE_BYTES = 256 * 1024;
// Secret files are looked for this many levels down (the folder's own files are the first), in at
// most SECRET_FOLDERS folders.
export const SECRET_DEPTH = 4;
export const SECRET_FOLDERS = 5000;

// A heading of CLAUDE.md that sets itself up as the manager of agents.
const MANAGER = /\b(?:agents?|sub-?agents?|orchestrat\w*|delegat\w*|command cent(?:re|er)|manager|dispatch\w*)\b/i;
// The names a secret file may have, and the ones that only show its shape.
const SECRET_NAME = /^\.env/;
const EXAMPLES = new Set(['.env.example', '.env.sample', '.env.template']);
// Folders never gone into for secret files.
const SKIPPED = new Set(['node_modules', '.git']);
// Wheelhouse's own lines of work, never counted as the project's.
const OWN = (name) => name === STATE_BRANCH || name === LOCK_BRANCH || name.startsWith('feature/');

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The entries of a folder, sorted by name, or none when it can't be read.
function entriesOf(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name));
  } catch {
    return [];
  }
}

// Whether `rel` (with `/`) is a real folder under `folder`, with no link anywhere on the way.
function realFolder(folder, rel) {
  let at = folder;
  for (const part of rel.split('/')) {
    at = path.join(at, part);
    try {
      if (!fs.lstatSync(at).isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// The regular files under `rel`, repository-relative with `/`, sorted, at most `limit`, never
// through a link.
function filesUnder(folder, rel, limit) {
  const out = [];
  if (!realFolder(folder, rel)) return out;
  const walk = (dirRel) => {
    for (const e of entriesOf(path.join(folder, ...dirRel.split('/')))) {
      if (out.length >= limit) return;
      const child = `${dirRel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) out.push(child);
    }
  };
  walk(rel);
  return out;
}

// The headings of CLAUDE.md, outside code blocks, that set it up as the manager, with their line.
function managerSections(folder) {
  const file = path.join(folder, 'CLAUDE.md');
  const text = isFile(file) ? readStart(file, FILE_BYTES) : null;
  if (text === null) return [];
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark && (fence === null || mark.startsWith(fence))) {
      fence = fence === null ? mark : null;
      return;
    }
    const heading = fence === null ? /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1] : undefined;
    if (heading && MANAGER.test(heading)) out.push({ heading, line: i + 1 });
  });
  return out;
}

// instructionsOf(folder) -> { files, sections }: the files of another agent setup found in the
// INSTRUCTION_PATHS (repository-relative with `/`, sorted, regular files only, never through a link,
// at most INSTRUCTION_FILES), and the headings of CLAUDE.md about agents, orchestration, delegation
// or a command centre.
export function instructionsOf(folder) {
  const found = [];
  for (const place of INSTRUCTION_PATHS) {
    if (place.endsWith('/**')) {
      found.push(...filesUnder(folder, place.slice(0, -3), INSTRUCTION_FILES));
    } else {
      const parent = path.posix.dirname(place);
      if ((parent === '.' || realFolder(folder, parent)) && isFile(path.join(folder, ...place.split('/')))) found.push(place);
    }
  }
  const files = found.filter((f) => !f.startsWith('.wheelhouse-archive/')).sort(byName).slice(0, INSTRUCTION_FILES);
  return { files, sections: managerSections(folder) };
}

// The lines of a YAML file as [indent, text], with comments and blank lines left out. Read line by
// line, with no YAML parser: enough to count, not to understand.
function yamlLines(file) {
  const text = isFile(file) ? readStart(file, FILE_BYTES) : null;
  if (text === null) return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    const body = line.trim();
    if (body === '' || body.startsWith('#')) continue;
    out.push([line.length - line.trimStart().length, body]);
  }
  return out;
}

// The `cron` entries under `on.schedule` of one GitHub workflow.
function cronsOf(file) {
  let on = null;
  let schedule = null;
  let count = 0;
  for (const [indent, body] of yamlLines(file)) {
    if (schedule !== null && indent <= schedule) schedule = null;
    if (on !== null && indent <= on) on = null;
    if (/^(?:on|"on"|'on')\s*:\s*$/.test(body)) on = indent;
    else if (on !== null && schedule === null && /^schedule\s*:\s*$/.test(body)) schedule = indent;
    else if (schedule !== null && /^(?:-\s+)?cron\s*:/.test(body)) count += 1;
  }
  return count;
}

// GitLab's top-level keys that are settings, not jobs.
const GITLAB_KEYWORDS = new Set([
  'default', 'include', 'stages', 'variables', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script',
]);

// The jobs of a .gitlab-ci.yml whose `rules` or `only` name a schedule.
function gitlabScheduledOf(file) {
  const jobs = new Set();
  let job = null;
  let within = null;
  for (const [indent, body] of yamlLines(file)) {
    if (indent === 0) {
      const key = /^([^\s:][^:]*?)\s*:/.exec(body)?.[1]?.replace(/^["']|["']$/g, '');
      job = key && !key.startsWith('.') && !GITLAB_KEYWORDS.has(key) ? key : null;
      within = null;
      continue;
    }
    if (job === null) continue;
    if (within !== null && indent <= within) within = null;
    const key = /^(rules|only)\s*:(.*)$/.exec(body);
    if (key) {
      within = indent;
      if (/\bschedules?\b/.test(key[2])) jobs.add(job);
    } else if (within !== null && /\bschedules?\b/.test(body)) {
      jobs.add(job);
    }
  }
  return jobs.size;
}

// scheduledOf(folder) -> number: the `cron` entries under `on.schedule` in the project's GitHub
// workflows (`.github/workflows/*.yml` and `*.yaml`), and the jobs of its `.gitlab-ci.yml` whose
// `rules` or `only` name a schedule.
export function scheduledOf(folder) {
  let count = 0;
  if (realFolder(folder, '.github/workflows')) {
    const dir = path.join(folder, '.github', 'workflows');
    for (const e of entriesOf(dir)) if (e.isFile() && /\.ya?ml$/i.test(e.name)) count += cronsOf(path.join(dir, e.name));
  }
  return count + gitlabScheduledOf(path.join(folder, '.gitlab-ci.yml'));
}

// secretFilesOf(folder) -> number: the files whose names start `.env`, other than the examples of
// one, to SECRET_DEPTH levels down, never in node_modules or .git and never through a link.
export function secretFilesOf(folder) {
  let count = 0;
  let folders = 0;
  const walk = (dir, depth) => {
    folders += 1;
    for (const e of entriesOf(dir)) {
      if (e.isDirectory()) {
        if (depth < SECRET_DEPTH && !SKIPPED.has(e.name) && folders < SECRET_FOLDERS) walk(path.join(dir, e.name), depth + 1);
      } else if (SECRET_NAME.test(e.name) && !EXAMPLES.has(e.name)) {
        count += 1;
      }
    }
  };
  walk(folder, 1);
  return count;
}

// git's answer as text, or null when it failed.
async function out(git, args) {
  const got = await git(args);
  return got.code === 0 ? String(got.stdout ?? '') : null;
}

// The tip each ref under `prefix` names, as [name without its prefix, head].
async function refsOf(git, prefix) {
  const text = await out(git, ['for-each-ref', '--format=%(refname)%00%(objectname)', prefix]);
  return (text ?? '').split('\n').filter(Boolean).map((line) => line.split('\0'))
    .filter(([ref, head]) => ref.startsWith(prefix) && /^[0-9a-f]{40,64}$/.test(head ?? ''))
    .map(([ref, head]) => [ref.slice(prefix.length), head]);
}

// The worktrees other than the main folder that are on no line of their own: [folder name, head].
async function detachedWorktrees(git) {
  const text = await out(git, ['worktree', 'list', '--porcelain']);
  const blocks = (text ?? '').split(/\n\n+/).map((b) => b.split('\n').filter(Boolean)).filter((b) => b.length > 0);
  const found = [];
  for (const block of blocks.slice(1)) {
    const where = block.find((l) => l.startsWith('worktree '))?.slice(9);
    const head = block.find((l) => l.startsWith('HEAD '))?.slice(5);
    if (where && block.includes('detached') && !block.includes('bare') && /^[0-9a-f]{40,64}$/.test(head ?? '')) {
      found.push([path.basename(where.replace(/[\\/]+$/, '')), head]);
    }
  }
  return found;
}

// The ref the main line is counted from: the default branch as last fetched, or as it is here, or
// none in a project that has neither.
async function baseOf(git, defaultBranch) {
  for (const ref of [`refs/remotes/origin/${defaultBranch}`, `refs/heads/${defaultBranch}`]) {
    if (await out(git, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null) return ref;
  }
  return null;
}

// An item of work in flight, or null when it holds nothing off the main line.
async function itemOf(git, base, name, head) {
  const counted = await out(git, ['rev-list', '--count', head, ...(base === null ? [] : [`^${base}`])]);
  const commits = Number.parseInt(counted ?? '', 10);
  if (!Number.isInteger(commits) || commits <= 0) return null;
  const [subject = '', at = ''] = (await out(git, ['log', '-1', '--format=%s%x00%cI', head]) ?? '').trim().split('\0');
  return { name, head, commits, subject, at };
}

// inFlightOf(git, { defaultBranch, requestHeads }) -> { pushed, local }, each a list of
// `{ name, head, commits, subject, at }` sorted by name. `local` is the project's lines here
// (refs/heads/*) and the worktrees other than the main folder on no line of their own, named by
// their folder; `pushed` is the lines on origin as last fetched (refs/remotes/origin/*, ruling P2).
// Each holds commits not on the default branch as last fetched. Left out: the default branch,
// Wheelhouse's own lines, anything at a request's head, and a line here at the same place as one
// pushed (the same work, counted once, as pushed).
export async function inFlightOf(git, { defaultBranch, requestHeads = [] }) {
  const base = await baseOf(git, defaultBranch);
  const skip = new Set(requestHeads);
  const keep = ([name]) => name !== defaultBranch && name !== 'HEAD' && !OWN(name);
  const items = async (pairs) => {
    const got = [];
    for (const [name, head] of pairs.filter(keep)) {
      if (skip.has(head)) continue;
      const item = await itemOf(git, base, name, head);
      if (item !== null) got.push(item);
    }
    return got.sort((a, b) => byName(a.name, b.name));
  };
  const pushed = await items(await refsOf(git, 'refs/remotes/origin/'));
  for (const item of pushed) skip.add(item.head);
  const local = await items([...await refsOf(git, 'refs/heads/'), ...await detachedWorktrees(git)]);
  return { pushed, local };
}

// surveyOf({ folder, git, adapter, defaultBranch, rules }) -> Survey: every part of the survey.
// The host is asked for its open requests; a host that fails, or answers in a shape not expected,
// gives `hostReached: false` and no requests, never a throw. With no adapter (a project in git
// alone) there is no host to reach. `rules` are the rules found (step 5), kept as given.
export async function surveyOf({ folder, git, adapter = null, defaultBranch, rules = [] }) {
  let hostReached = true;
  let open = [];
  if (adapter !== null) {
    try {
      const got = await adapter.openRequests();
      if (!Array.isArray(got)) throw new Error('the host did not answer with a list');
      open = got;
    } catch {
      hostReached = false;
      open = [];
    }
  }
  const requests = open.map(({ number, title, draft }) => ({ number, title, draft }));
  const { pushed, local } = await inFlightOf(git, { defaultBranch, requestHeads: open.map((r) => r.head) });
  return {
    v: 1, hostReached, requests, pushed, local,
    instructions: instructionsOf(folder), scheduled: scheduledOf(folder), secrets: secretFilesOf(folder), rules,
  };
}
