// scripts/update/install.js
// Installing a Wheelhouse release on this computer for the update, and putting the computer back
// when that fails (design 2026-11-04-update-command-design.md, section 6.4; check 94, U1). The
// catalogue is moved with `claude plugin marketplace add <address>#<tag>` at user or local scope,
// never project scope, which rewrites the project's committed settings. Each install then moves
// with the plugin update, as `reinstall` does it.
import fs from 'node:fs';
import path from 'node:path';
import { resolveClaude } from '../lib/claude.js';
import { run as defaultRun } from '../lib/run.js';
import { LookRefusal, safeGit } from '../lib/safe-git.js';
import { registeredProjects } from '../lib/projects.js';
import { MARKETPLACE, MARKETPLACE_PATH, claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { SETTINGS_FILE, claudeIn, reinstall } from '../lineage/release.js';
import { accountCatalogue, moveAccountRef, restoreAccountRef } from './account-settings.js';
import { backup, restore } from './journal.js';

const FULL_SHA = /^[0-9a-f]{40}$/;
// Any release tag the update names: plain, or a pre-release named on purpose.
const NAMED_TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/;
const LOCAL_SETTINGS = '.claude/settings.local.json';
const INSTALL_NOTE = 'install.json';
const short = (sha) => String(sha).slice(0, 12);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

const sameFolder = (a, b) => typeof a === 'string' && typeof b === 'string'
  && path.resolve(a.replace(/\\/g, '/')).toLowerCase() === path.resolve(b.replace(/\\/g, '/')).toLowerCase();

const pluginsFile = (claudeHome, name) => path.join(claudeHome, 'plugins', name);

// The plugins the catalogue on this computer lists, from the copy Claude Code holds.
function catalogueNames(claudeHome, marketplace) {
  const where = readJson(pluginsFile(claudeHome, 'known_marketplaces.json'))?.[marketplace]?.installLocation;
  if (typeof where !== 'string') return [];
  const listed = readJson(path.join(where, ...MARKETPLACE_PATH.split('/')));
  return Array.isArray(listed?.plugins) ? listed.plugins.map((plugin) => plugin?.name).filter((name) => typeof name === 'string') : [];
}

// The installs of the catalogue's plugins that the update may move: each at user scope, and each at
// project scope for `projectDir` only (other projects' installs are left alone, design 10.3).
// From Claude Code's record of installs. `names` overrides the catalogue's list.
export function installsOf({ claudeHome = defaultClaudeHome(), projectDir, marketplace = MARKETPLACE, names } = {}) {
  const record = readJson(pluginsFile(claudeHome, 'installed_plugins.json'));
  const wanted = names ?? catalogueNames(claudeHome, marketplace);
  const found = [];
  for (const plugin of wanted) {
    const installs = record?.plugins?.[`${plugin}@${marketplace}`];
    if (!Array.isArray(installs)) continue;
    for (const install of installs) {
      if (!isObject(install)) continue;
      if (install.scope === 'user') found.push({ plugin, scope: 'user' });
      else if (install.scope === 'project' && sameFolder(install.projectPath, projectDir)) found.push({ plugin, scope: 'project', projectPath: install.projectPath });
    }
  }
  return found;
}

// The registered projects (their folders) with no project-scope install of Wheelhouse's own, which
// therefore follow the account's install and catalogue.
export function accountFollowers({ claudeHome = defaultClaudeHome(), projects = [], marketplace = MARKETPLACE, plugin = 'wheelhouse' } = {}) {
  const installs = readJson(pluginsFile(claudeHome, 'installed_plugins.json'))?.plugins?.[`${plugin}@${marketplace}`];
  const own = Array.isArray(installs) ? installs.filter((i) => isObject(i) && i.scope === 'project').map((i) => i.projectPath) : [];
  return projects.filter((folder) => !own.some((p) => sameFolder(p, folder)));
}

// The address the catalogue was first added from, in the form Claude Code recorded it.
function addressOf(source) {
  if (!isObject(source)) return null;
  if (source.source === 'github' && typeof source.repo === 'string') return source.repo;
  if ((source.source === 'git' || source.source === 'url') && typeof source.url === 'string') return source.url;
  return null;
}

// The commit the catalogue's copy on this computer is at, or null.
async function cloneHead({ run, installLocation }) {
  try {
    const got = await safeGit({ run, cwd: installLocation, look: 'once', caller: 'reinstall' })(['rev-parse', 'HEAD'], { input: '' });
    return got.code === 0 ? got.stdout.trim() : null;
  } catch (error) {
    if (error instanceof LookRefusal) return null;
    throw error;
  }
}

// Moves this computer's copy of the catalogue to `tag` without uninstalling anything: `claude plugin
// marketplace add <recorded address>#<tag> --scope user|local`. When Claude Code refuses it, the
// `ref` in known_marketplaces.json is set and `claude plugin marketplace update` fetches it. Either
// way the copy's HEAD must be the tag's commit `sha`. Moving it again when it is already there does
// nothing. Resolves { ok, why? }.
export async function moveCatalogue({
  tag, sha, scope, run = defaultRun, resolved = resolveClaude(), projectDir, claudeHome = defaultClaudeHome(), marketplace = MARKETPLACE,
}) {
  if (!NAMED_TAG.test(String(tag)) || !FULL_SHA.test(sha ?? '')) return { ok: false, why: 'the release must be a tag and its full commit' };
  if (scope !== 'user' && scope !== 'local') return { ok: false, why: 'the catalogue moves at user or local scope only, never project scope' };
  const file = pluginsFile(claudeHome, 'known_marketplaces.json');
  const known = readJson(file)?.[marketplace];
  const installLocation = typeof known?.installLocation === 'string' ? known.installLocation : null;
  const address = addressOf(known?.source);
  if (installLocation === null || address === null || address.startsWith('-')) return { ok: false, why: "Claude Code's record of the Wheelhouse catalogue can't be read" };
  if (known.source.ref === tag && await cloneHead({ run, installLocation }) === sha) return { ok: true };
  const ctx = { run, resolved, projectDir };
  const added = await claudeIn(ctx, ['plugin', 'marketplace', 'add', `${address}#${tag}`, '--scope', scope]);
  if (added.code !== 0) {
    const record = readJson(file);
    if (!isObject(record?.[marketplace]?.source)) return { ok: false, why: "Claude Code's record of the Wheelhouse catalogue can't be read" };
    record[marketplace].source.ref = tag;
    writeJson(file, record);
    const updated = await claudeIn(ctx, ['plugin', 'marketplace', 'update', marketplace]);
    if (updated.code !== 0) return { ok: false, why: 'Claude Code would not move the Wheelhouse catalogue to the new release' };
  }
  const at = await cloneHead({ run, installLocation });
  if (at !== sha) return { ok: false, why: `the catalogue is at ${at ? short(at) : 'a commit that could not be read'}, not ${tag} (${short(sha)})` };
  return { ok: true };
}

const noteFile = (journal) => path.join(journal.folder, INSTALL_NOTE);

// The release the computer ran before the move, and the scopes the move reached, kept in the
// journal's folder so a second run after a stop keeps the first run's `previous`.
function readNote(journal) {
  return readJson(noteFile(journal)) ?? {};
}

// The release installed now, as { ref, sha }: the catalogue's recorded ref and Wheelhouse's own
// install commit at project scope for the project, else at user scope.
function currentRelease({ claudeHome, projectDir, marketplace }) {
  const record = readJson(pluginsFile(claudeHome, 'installed_plugins.json'))?.plugins?.[`wheelhouse@${marketplace}`];
  const installs = Array.isArray(record) ? record.filter(isObject) : [];
  const mine = installs.find((i) => i.scope === 'project' && sameFolder(i.projectPath, projectDir)) ?? installs.find((i) => i.scope === 'user');
  const ref = readJson(pluginsFile(claudeHome, 'known_marketplaces.json'))?.[marketplace]?.source?.ref;
  if (!mine || !FULL_SHA.test(mine.gitCommitSha ?? '')) return null;
  const tag = typeof ref === 'string' && NAMED_TAG.test(ref) ? ref : (typeof mine.version === 'string' ? `v${mine.version}` : null);
  return tag && NAMED_TAG.test(tag) ? { ref: tag, sha: mine.gitCommitSha } : null;
}

const folderOf = (project, projectDir) => projectDir ?? (registeredProjects().find((p) => p.project === project)?.record?.folder);

// Spec 6.4, steps 1 to 5. Backs up the files the install may change, moves the catalogue, moves
// every install at the chosen scopes, and checks each install is at the release's pin. When it
// fails after the catalogue moved, the computer is put back (putBack). `target` is { tag, sha }.
// Where the account's settings declare the catalogue at an old ref, Claude Code refuses to add it at
// a new tag, so that one `ref` is changed first (account-settings.js; the director's ruling of 4
// November 2026) and the catalogue is added at user scope; the file is restored by any put-back. The
// account's own installs move only when no registered project follows them; otherwise they stay.
// Without such a declaration the add is at 'local' scope. Safe to run again after a stop.
export async function installRelease({
  project, target, journal, run = defaultRun, resolved = resolveClaude(), projectDir, claudeHome = defaultClaudeHome(),
  marketplace = MARKETPLACE, projects, accountNamed,
}) {
  const dir = folderOf(project, projectDir);
  if (typeof dir !== 'string' || dir === '') return { ok: false, line: "The project's folder is not known, so nothing was installed." };
  const { tag, sha } = target ?? {};
  if (!NAMED_TAG.test(String(tag)) || !FULL_SHA.test(sha ?? '')) return { ok: false, line: 'The release must be named by a tag and its full commit, so nothing was installed.' };

  // The account's settings are kept whole in the journal for reference only; a put-back sets back just the one ref.
  try {
    const kept = path.join(journal.folder, 'account-settings.json');
    if (!fs.existsSync(kept) && fs.existsSync(path.join(claudeHome, 'settings.json'))) {
      fs.mkdirSync(journal.folder, { recursive: true });
      fs.copyFileSync(path.join(claudeHome, 'settings.json'), kept);
    }
  } catch { /* a reference copy only */ }
  backup(journal, [
    pluginsFile(claudeHome, 'known_marketplaces.json'),
    pluginsFile(claudeHome, 'installed_plugins.json'),
    path.join(dir, ...LOCAL_SETTINGS.split('/')),
    path.join(dir, ...SETTINGS_FILE.split('/')),
  ]);

  const folders = projects ?? registeredProjects().map((p) => p.record.folder).filter((f) => typeof f === 'string');
  const followers = accountFollowers({ claudeHome, projects: folders, marketplace });
  // Refused before anything moves: the account's file is not the Wheelhouse repository's, or can't be read.
  const declared = accountCatalogue({ claudeHome, marketplace });
  if (declared?.refused) return { ok: false, line: `${declared.refused} Nothing was installed.` };
  // The card named the account's ref it would change; a different one now means the settings changed since, so nothing is touched.
  if (accountNamed !== undefined && typeof declared?.ref === 'string' && declared.ref !== tag && declared.ref !== (accountNamed?.from ?? null)) {
    return { ok: false, line: 'Your account settings changed since the card; type /wheelhouse:update again. Nothing was installed.' };
  }
  const accountMoves = declared !== null && followers.length === 0;
  const scopeFlag = declared !== null ? 'user' : 'local';
  const scopes = accountMoves ? ['project', 'user'] : ['project'];

  const note = readNote(journal);
  if (!note.previous) note.previous = currentRelease({ claudeHome, projectDir: dir, marketplace });
  if (declared !== null && declared.ref !== tag && !note.accountRef) note.accountRef = { from: declared.ref, to: tag };
  note.scopes = scopes;
  note.projectDir = dir;
  writeJson(noteFile(journal), note);

  const ctx = { run, resolved, projectDir: dir, claudeHome, marketplace };
  const failed = async (line) => {
    const back = await putBack({ previous: note.previous, journal, run, resolved, projectDir: dir, claudeHome, marketplace, scopes });
    return { ok: false, line: `${line} ${back.line}` };
  };

  if (declared !== null) {
    const edited = moveAccountRef({ claudeHome, tag, marketplace });
    if (!edited.ok) return failed(`Wheelhouse ${tag} was not installed: ${edited.why}`);
  }
  const moved = await moveCatalogue({ tag, sha, scope: scopeFlag, ...ctx });
  if (!moved.ok) return failed(`Wheelhouse ${tag} was not installed: ${moved.why}.`);

  const done = await reinstall({ projectDir: dir, release: { ref: tag, sha }, run, marketplace, claudeHome, resolved, scopes });
  if (!done.ok) return failed(`Wheelhouse ${tag} was not fully installed. ${done.line}`);

  const keeps = followers.length === 0 ? ''
    : ` The account's own install and catalogue stay at the earlier release for ${followers.map((f) => path.basename(f)).join(', ')}, which follow it.`;
  return { ok: true, line: `${done.line}${keeps}` };
}

// Puts the computer back after a failed install: the backed-up files are restored, then the earlier
// release `previous` ({ ref, sha }) is installed again at each scope the install reached.
// `scopes` comes from the journal's note when not given. Resolves { ok, line }.
export async function putBack({
  previous, journal, run = defaultRun, resolved = resolveClaude(), projectDir, claudeHome = defaultClaudeHome(), marketplace = MARKETPLACE, scopes,
}) {
  const note = readNote(journal);
  const kept = restore(journal);
  const account = note.accountRef ? restoreAccountRef({ claudeHome, from: note.accountRef.from, to: note.accountRef.to, marketplace }) : { ok: true };
  const aside = account.line ? ` ${account.line}` : '';
  const dir = projectDir ?? note.projectDir;
  const was = previous ?? note.previous;
  if (!was || !NAMED_TAG.test(String(was.ref)) || !FULL_SHA.test(was.sha ?? '')) {
    return { ok: false, line: `${kept > 0 ? "Your settings were put back, but the earlier release isn't known, so it was not installed again." : 'Nothing was put back.'}${aside}` };
  }
  const reinstalled = await reinstall({
    projectDir: dir, release: was, run, marketplace, claudeHome, resolved, scopes: scopes ?? note.scopes ?? ['project'],
  });
  return reinstalled.ok
    ? { ok: true, line: `This computer was put back to ${was.ref}.${aside}` }
    : { ok: false, line: `This computer could not be put back to ${was.ref}: ${reinstalled.line}${aside}` };
}
