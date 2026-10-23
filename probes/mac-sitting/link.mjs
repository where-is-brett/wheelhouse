// probes/mac-sitting/link.mjs
// Puts the plugin into the scratch session's own mods folder, which raises Claude Code's "Enable
// hot reloading for this session?" question there. Run by the agent at the sitting, once the
// scratch session has loaded the plugin-authoring skill (which makes the folder), not during
// preparation. The scratch session can't do this itself: its sandbox denies writes under ~/.claude.
//
//   node link.mjs <session id>|found [--observer] [--dry-run]
//
// <session id> is the scratch session's Claude Code session id (its CLAUDE_CODE_SESSION_ID, the
// name of its folder under ~/.claude/dev-mods/); `found` finds it from the scratch project's
// transcripts. The plugin is copied, not linked, from the copy
// prepare.mjs extracted, so the types the engine lays into a loaded folder land in the copy and
// never in the repository. --observer adds the observer mod beside it. The front desk's command is
// then allowed by the copy's full path too, in the project's local settings.
import fs from 'node:fs';
import path from 'node:path';
import { DEV_MODS, MADE, OBSERVER, OBSERVER_NOTES, PLUGIN, readMade, transcriptFolder } from './layout.mjs';

const [given, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry-run');
const made = readMade();
if (made === null) throw new Error('Run prepare.mjs first');
// `found`: the session whose transcript is in the scratch project's folder under ~/.claude/projects
// and whose mods folder exists, the latest if there are several.
function foundSession() {
  const transcripts = transcriptFolder(made.folder);
  const ids = fs.existsSync(transcripts) ? fs.readdirSync(transcripts).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6)) : [];
  const withMods = ids.filter((id) => fs.existsSync(path.join(DEV_MODS, id)));
  withMods.sort((a, b) => fs.statSync(path.join(transcripts, `${a}.jsonl`)).mtimeMs - fs.statSync(path.join(transcripts, `${b}.jsonl`)).mtimeMs);
  return withMods.at(-1);
}
const session = given === 'found' ? foundSession() : given;
if (given === 'found') process.stdout.write(`found: ${session ?? 'none'}\n`);
if (typeof session !== 'string' || !/^[0-9a-f-]{36}$/.test(session)) {
  console.error('Give the scratch session\'s id: node link.mjs <session id>');
  process.exit(2);
}
const folder = path.join(DEV_MODS, session);
if (!fs.existsSync(folder)) {
  console.error(`${folder} isn't there: the scratch session hasn't loaded the plugin-authoring skill yet`);
  process.exit(2);
}
const target = path.join(folder, 'wheelhouse');
const observer = path.join(folder, 'wheelhouse-observer');
const settingsFile = path.join(made.folder, '.claude', 'settings.local.json');
const root = target;
const rule = `Bash(node "${root}/scripts/frontdesk/cli.js":*)`;
// The session start's command line carries --no-use-system-ca where Node.js knows the flag.
const flaggedRule = `Bash(node --no-use-system-ca "${root}/scripts/frontdesk/cli.js":*)`;
const say = (line) => process.stdout.write(`${line}\n`);
say(`copy ${PLUGIN} -> ${target}`);
if (flags.includes('--observer')) say(`copy ${OBSERVER} -> ${observer}`);
say(`allow in ${settingsFile}: ${rule}`);
if (dry) process.exit(0);

// The manifest last, so the engine's question comes once the plugin's files are all there.
fs.cpSync(PLUGIN, target, { recursive: true, filter: (src) => !src.endsWith(path.join('.claude-plugin', 'plugin.json')) });
fs.copyFileSync(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), path.join(target, '.claude-plugin', 'plugin.json'));
if (flags.includes('--observer')) {
  fs.cpSync(OBSERVER, observer, { recursive: true });
  // The copy notes into this scratch folder's observer.d/, whatever the temporary folder's path.
  const hooks = path.join(observer, 'hooks', 'register.ts');
  const notes = path.join(fs.realpathSync.native(path.dirname(OBSERVER_NOTES)), path.basename(OBSERVER_NOTES));
  fs.writeFileSync(hooks, fs.readFileSync(hooks, 'utf8').replace(/^const NOTES = '.*'$/m, `const NOTES = ${JSON.stringify(notes).replace(/^"|"$/g, "'")}`));
  fs.mkdirSync(notes, { recursive: true });
}
const local = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
local.permissions = { ...local.permissions, allow: [...new Set([...(local.permissions?.allow ?? []), rule, flaggedRule])] };
fs.writeFileSync(settingsFile, `${JSON.stringify(local, null, 2)}\n`);
made.devMods = { session, folder, plugin: target, observer: flags.includes('--observer') ? observer : null, at: new Date().toISOString() };
fs.writeFileSync(MADE, `${JSON.stringify(made, null, 2)}\n`);
say('done: the hot-reloading question shows in the scratch session now');
