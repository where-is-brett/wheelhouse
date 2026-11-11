// adapters/copilot/session-home.js
// The clean Copilot home each background session runs from (design section 3.2; checks 56, 61 and 63): one per target
// (`foreman`, or `feature-<work>`), written by Wheelhouse only, so `--resume` finds its session and two sessions never
// share Copilot's lock files. It holds Wheelhouse's hook registration, the kit's agents (adapters/copilot/home/agents, built by
// scripts/agents/copilot/home.js), the pinned kits' skills, and a config.json with the sign-in keys and nothing else of
// the person's. It imports nothing that reaches the hook kit, the waker or the registry.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitsForSession } from '../../scripts/agents/copilot/kits.js';
import { PLUGIN_ROOT } from '../../scripts/foreman/tools.js';
import { SLUG } from '../../scripts/lib/build-loop.js';
import { copyTree } from '../../scripts/lib/copy-tree.js';
import { stateDir, wheelhouseHome } from '../../scripts/lib/paths.js';
import { fingerprintTree } from '../../scripts/lineage/fingerprint.js';
import { copilotHome, writeRegistration } from './hooks.js';

// The kit's agents, copied into every session's own home.
const KIT_AGENTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home', 'agents');

// The keys of Copilot's config.json that hold the sign-in: the signed-in users, which is how a home finds the keychain
// entry. Nothing else in the person's file reaches a session's home: above all not `trustedFolders`, which would make a
// folder trusted and load its hooks and `.mcp.json`, which run outside the permission rules (checks 56 and 66). Both
// spellings Copilot has used are listed. The first real run records the keys a signed-in file holds and confirms or
// corrects this list (check 61's note).
export const SIGN_IN_KEYS = Object.freeze(['loggedInUsers', 'lastLoggedInUser', 'logged_in_users', 'last_logged_in_user']);

// What may stay at the top of a session's home between runs: Wheelhouse's own four, and Copilot's own state (its sessions,
// which `--resume` reads; its session database and that database's side files; its logs; its lock files). Everything
// else is removed before each start, so no `settings.json`, `mcp-config.json`, `lsp-config.json`, instructions or
// installed plugins survive into a run.
export const COPILOT_STATE = [/^session-state$/, /^logs?$/, /\.(db|sqlite3?)(-wal|-shm|-journal)?$/i, /\.lock$/i];

const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// The project's folder in Wheelhouse's home: `<home>/projects/<p>`, with the name checked as the state's is.
export const projectFolder = (project) => path.dirname(stateDir(project));

export function plainId(value, what) {
  if (typeof value !== 'string' || !PLAIN_ID.test(value) || /^\.+$/.test(value)) throw new Error(`This can't be used as a ${what}: ${JSON.stringify(value)}`);
  return value;
}

// The session's own Copilot home: `<home>/projects/<p>/copilot-home/<target>`.
export function sessionHome(project, target) {
  if (typeof target !== 'string' || !(target === 'foreman' || (target.startsWith('feature-') && SLUG.test(target.slice('feature-'.length))))) {
    throw new Error(`A session's home is the foreman's or a feature's, and this target isn't either: ${JSON.stringify(target)}`);
  }
  let folder;
  try {
    folder = projectFolder(project);
  } catch {
    throw new Error(`This isn't a project's folder name: ${JSON.stringify(project)}`);
  }
  return path.join(folder, 'copilot-home', target);
}

// A Copilot config.json's object: the CLI opens the file with `//` comment lines of its own, which are passed over;
// anything after them must be plain JSON.
export function readCopilotConfig(text) {
  return JSON.parse(String(text).replace(/^(?:[ \t]*\/\/[^\n]*(?:\r?\n|$))+/, ''));
}

// The sign-in keys of the Copilot home `signedInFrom`'s config.json (SIGN_IN_KEYS), and nothing else of the file. Throws,
// in plain words, when it holds none: no session starts unsigned.
export function signInOf(signedInFrom = copilotHome()) {
  let source;
  try {
    source = readCopilotConfig(fs.readFileSync(path.join(signedInFrom, 'config.json'), 'utf8'));
  } catch {
    source = null;
  }
  const signIn = source !== null && typeof source === 'object' && !Array.isArray(source)
    ? Object.fromEntries(SIGN_IN_KEYS.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]))
    : {};
  if (Object.keys(signIn).length === 0) throw new Error("Copilot isn't signed in on this computer, so no session can start: sign in to Copilot CLI first");
  return signIn;
}

// Throws when any folder from Wheelhouse's home down to `dir` is a link, so nothing written or removed under `dir` can
// land outside the home. Folders not made yet are not looked at.
export function refuseLinkedPath(dir) {
  const home = path.resolve(wheelhouseHome());
  const relative = path.relative(home, path.resolve(dir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${dir} isn't inside Wheelhouse's home`);
  let at = home;
  for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
    at = part === '' ? at : path.join(at, part);
    const stat = fs.lstatSync(at, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${at} must be a folder Wheelhouse made, and it is a link or a file, so nothing is written there`);
  }
}

// Copies one verified skill folder into the home's skills/, then checks the copy against the manifest's hash: a link is
// never copied, and a copy that differs refuses the start.
function copySkill(skill, into) {
  const target = path.join(into, skill.name);
  copyTree(skill.dir, target, { overwrite: false });
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`The ${skill.name} skill holds a link, which is never given to a session`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(target);
  if (typeof skill.hash === 'string' && fingerprintTree(target).hash !== skill.hash) throw new Error(`The ${skill.name} skill copied into the session's home doesn't match Wheelhouse's manifest, so no session is started`);
}

// Writes the session's own home before a start, and returns its path: Wheelhouse's hook registration in
// hooks/wheelhouse.json (the only place Wheelhouse's hooks load without trust, check 56), the only hook file there; the
// kit's agents, the only agents there; the pinned kits' skills (`skills`, each `{ name, dir, hash }` from kitSkills), the
// only skills there; config.json holding the sign-in keys only, from the person's Copilot home (`signedInFrom`); and
// nothing else but Copilot's own state. config.json is written last, so a home is never signed in without its guards. A
// source with no sign-in refuses the start before anything in the home is touched, and so does a link anywhere from
// Wheelhouse's home down to the session's.
export function writeSessionHome({ project, target, signedInFrom = copilotHome(), node = process.execPath, root = PLUGIN_ROOT, platform = process.platform, skills = [] }) {
  const home = sessionHome(project, target);
  const signIn = signInOf(signedInFrom);
  if (!Array.isArray(skills) || !skills.every((s) => s !== null && typeof s === 'object' && typeof s.name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(s.name) && typeof s.dir === 'string')) {
    throw new Error("A session's skills are each a plain name and a folder");
  }
  refuseLinkedPath(home);

  const there = fs.lstatSync(home, { throwIfNoEntry: false });
  if (there && !there.isDirectory()) throw new Error(`A session's Copilot home must be a folder Wheelhouse made, and ${home} isn't`);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  refuseLinkedPath(home);
  for (const name of fs.readdirSync(home)) {
    const own = COPILOT_STATE.some((pattern) => pattern.test(name)) && !fs.lstatSync(path.join(home, name)).isSymbolicLink();
    // A link is removed, never followed; Wheelhouse's own four are written afresh.
    if (!own) fs.rmSync(path.join(home, name), { recursive: true, force: true });
  }

  writeRegistration({ home, node, root, platform });
  const agents = path.join(home, 'agents');
  fs.mkdirSync(agents);
  for (const name of fs.readdirSync(KIT_AGENTS).filter((n) => n.endsWith('.agent.md'))) fs.copyFileSync(path.join(KIT_AGENTS, name), path.join(agents, name));
  if (skills.length > 0) {
    const into = path.join(home, 'skills');
    fs.mkdirSync(into);
    for (const skill of skills) copySkill(skill, into);
  }

  const config = path.join(home, 'config.json');
  const temp = `${config}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(signIn, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, config);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return home;
}

// Writes the session's own home with the pinned kits' skills (kitsForSession, then writeSessionHome), as every start does.
// `kits` ({ manifest, fetchTo }) and `home` ({ signedInFrom, node, root, platform }) are for tests. Resolves with the
// home's path and whether the kits' hold was lifted (`lifted`); a kit that differs throws, with the hold's record,
// before the home is touched.
export async function writeHomeWithKits({ project, target, kits = {}, home = {} }) {
  const { skills, lifted } = await kitsForSession({ project, ...kits });
  return { home: writeSessionHome({ project, target, skills, ...home }), lifted };
}
