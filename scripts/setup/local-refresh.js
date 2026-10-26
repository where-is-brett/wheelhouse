// scripts/setup/local-refresh.js
// Brings this computer's .claude/settings.local.json in a project set up here up to what setup's
// step 7 would write now (localSettings), at each session start. The allow rules for the front
// desk's and setup's commands name the plugin's folder, and Claude Code keeps each version of a
// plugin in a folder of its own (…/plugins/cache/wheelhouse/wheelhouse/0.1.1/), so after an update
// the rules step 7 wrote name a folder no longer used, and every command would be asked about
// again; a rule added in a later version (the work's reports, .wheelhouse/work/) would never come.
//
// A rule can't name every version with a wildcard: in a Bash rule `*` matches any text, `/` and
// `..` included, so `…/wheelhouse/wheelhouse/*/scripts/frontdesk/cli.js` would also allow a cli.js
// anywhere a path that climbs out can reach. So the rules stay exact, and this refreshes them.
//
// It merges localSettings in key by key, as step 7 does (mergeSettings: the director's own entries
// first and kept), and takes out only the rules Wheelhouse itself writes for its commands that name
// another folder of Wheelhouse's (staleRule): exactly the form pluginScriptCommand gives, for
// scripts/frontdesk/cli.js or scripts/setup/cli.js, under a folder whose path names Wheelhouse.
// Nothing else is ever taken out. The front desk's model pin is step 7's and is left as it is.
// Each key that differs is written by the journal's key edit and recorded on the folder's setup run as
// step 7's, as step 7's own were, so uninstall's chain for the key (ruling R85) runs from what the
// refresh wrote back through step 7's to the director's value, and puts back Wheelhouse's rules.
// It writes only when a key differs, so a start with nothing to do reads a few small files; a file
// missing, unreadable or not an object, or a folder with no open run whose step 7 is done, is left
// alone. It informs: a failure changes nothing more.
//
// The session start runs it as its own process, detached (`node local-refresh.js <folder>`): the mod's
// bridge imports the session start, and nothing it imports may reach what writes Claude Code's
// settings. Run so, it refreshes only a registered project's own main folder, and names the plugin's
// folder itself, as the session start names the Wheelhouse command (the managed copy's recorded one
// in a Locked project), so no argument can make it allow another folder's scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSettings, mergeSettings, directorStatusLine, NO_SYSTEM_CA } from '../protection/settings.js';
import { canonicalJson } from '../lib/canonical.js';
import { readJournal, addChanges, applyJsonKey } from './journal.js';
import { helperAddress } from '../lib/paths.js';
import { projectForFolder } from '../lib/projects.js';
import { claudeHome as defaultClaudeHome } from '../lineage/manifest.js';
import { pluginRoots } from '../hooks/kit.js';
import { startedAsScript } from '../lib/started-as-script.js';

const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = path.resolve(path.dirname(SELF), '..', '..');

const LOCAL = path.join('.claude', 'settings.local.json');
const COMMANDS = ['scripts/frontdesk/cli.js', 'scripts/setup/cli.js'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The form of a rule Wheelhouse writes for one of its commands: Bash(node [NO_SYSTEM_CA ]"<root>/<script>":*),
// with the root as a group. The root holds no quote, as pluginScriptCommand refuses one.
const RULE = new RegExp(`^Bash\\(node (?:${escaped(NO_SYSTEM_CA)} )?"([^"]+)/(?:${COMMANDS.map(escaped).join('|')})":\\*\\)$`);

// Whether `rule` is one Wheelhouse wrote for one of its commands under another folder of Wheelhouse's than
// the ones `current` lists (the rules localSettings gives now): its exact form, a root whose path names
// Wheelhouse, and not a rule of now.
export function staleRule(rule, current) {
  if (typeof rule !== 'string' || current.includes(rule)) return false;
  const m = RULE.exec(rule);
  return m !== null && /wheelhouse/i.test(m[1]);
}

// The settings the file should hold: `existing` with localSettings merged in and the stale rules taken out.
export function refreshed(existing, ours) {
  const current = ours.permissions?.allow ?? [];
  const kept = isObject(existing.permissions) && Array.isArray(existing.permissions.allow)
    ? { ...existing, permissions: { ...existing.permissions, allow: existing.permissions.allow.filter((r) => !staleRule(r, current)) } }
    : existing;
  return mergeSettings(kept, ours);
}

// The key edits that make `existing` hold `target`: each key whose value differs, as deep as both
// sides are objects, so a list or a value is one edit and every other key stays as it was. Step 7
// lists its changes the same way.
export function keyEdits(existing, target, prefix = []) {
  const edits = [];
  for (const key of Object.keys(target)) {
    const here = [...prefix, key];
    const has = Object.hasOwn(existing, key);
    if (has && isObject(existing[key]) && isObject(target[key])) edits.push(...keyEdits(existing[key], target[key], here));
    else if (!has || canonicalJson(existing[key]) !== canonicalJson(target[key])) edits.push({ key: here, value: target[key] });
  }
  return edits;
}

// The folder's newest setup run that is open and has done step 7, or null.
const STEP = 7;
function runFor(folder, journal) {
  const runs = (Array.isArray(journal?.runs) ? journal.runs : [])
    .filter((r) => r?.folder === folder && typeof r.closedAt !== 'string' && typeof r.steps?.[STEP]?.doneAt === 'string');
  return runs.at(-1) ?? null;
}

// Refreshes the file in `folder`, the project's main folder as setup's run names it, for this computer:
// `address` the helper's socket, `node` this Node.js, `pluginRoot` the folder the Wheelhouse command is
// named from, `claudeHome` Claude Code's own folder (for a status line of the director's own). Returns
// the number of keys it wrote.
export function refreshLocalSettings({ folder, address, node, pluginRoot, platform = process.platform, claudeHome, journal = readJournal }) {
  const file = path.join(folder, LOCAL);
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
  if (!isObject(existing)) return 0;
  const ownStatusLine = claudeHome ? directorStatusLine({ claudeHome, projectDir: folder }) : null;
  const ours = localSettings({ address, node, pluginRoot, platform, ownStatusLine });
  const edits = keyEdits(existing, refreshed(existing, ours));
  if (edits.length === 0) return 0;
  const run = runFor(folder, journal());
  if (run === null) return 0;
  for (const { key, value } of edits) applyJsonKey({ file, key, value, step: STEP, record: (c) => addChanges(run.id, [c]) });
  return edits.length;
}

// The script's own form: `folder`, a registered project's main folder. Returns the keys it wrote, or
// null when the folder is not one.
export function main([folder] = [], { platform = process.platform, self = SELF, pluginRoot = PLUGIN_ROOT, dir } = {}) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null;
  let found;
  try {
    found = projectForFolder(fs.realpathSync.native(folder));
  } catch {
    return null;
  }
  if (found?.record?.folder !== folder || found.lean === true) return null;
  return refreshLocalSettings({
    folder, address: helperAddress({ platform }), node: process.execPath, pluginRoot: pluginRoots(dir, self, pluginRoot).at(-1), platform, claudeHome: defaultClaudeHome(),
  });
}

if (startedAsScript(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch { /* it informs: the file stays as it was */ }
}
