// vscode/desk.cjs
// The add-on's way to Wheelhouse's desk and helper. Wheelhouse's scripts are ES modules, so they are loaded with
// dynamic import() from the add-on's own folder (`wheelhouse/`, which the packed add-on carries: scripts/addon/pack.js),
// never from a project, a checkout or a plugin folder. Where Node.js runs and the helper doesn't answer, the add-on
// starts it (design for other agents, section 8.5); VS Code's own program is never started as a Node.js process.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { pathToFileURL } = require('node:url');

// The scripts the add-on loads, relative to its `wheelhouse/` folder. The pack walks their imports (pack.js).
const LOADS = Object.freeze({
  desk: 'scripts/desk/mod-desk.js',
  helper: 'scripts/host/helper-client.js',
  press: 'scripts/mod/press.js',
  settings: 'scripts/mod/settings-pane.js',
  digest: 'scripts/mod/digest.js',
  versions: 'scripts/agents/copilot/versions.js',
  record: 'scripts/hooks/prompt-record.js',
  kit: 'scripts/hooks/kit.js',
  stop: 'scripts/lib/stop.js',
  cardLines: 'scripts/state/card-lines.js',
  modDesk: 'scripts/desk/mod-desk.js',
});
// Run, not imported: the helper's starter.
const START_HELPER = 'scripts/agents/copilot/start-helper.js';

const HELPER_DOWN = 'Wheelhouse\'s helper isn\'t running, so this is the last view it could read.';
const NOTHING_READ = 'Wheelhouse\'s helper isn\'t running, and nothing has been read yet.';
const NO_NODE = ' Node.js isn\'t available here to start it.';

// The add-on's own copy of Wheelhouse's scripts.
const wheelhouseRoot = (extensionPath) => path.join(extensionPath, 'wheelhouse');

const load = (root, rel) => import(pathToFileURL(path.join(root, rel)).href);

// A Node.js 22 or later on the person's PATH, or null. Nothing is installed and VS Code's own program is not tried.
function findNode({ env = process.env, platform = process.platform, exists = fs.existsSync, run = childProcess.execFileSync } = {}) {
  const names = platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (!exists(file)) continue;
      try {
        const major = Number(/^v(\d+)\./.exec(String(run(file, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true })).trim())?.[1]);
        if (major >= 22) return file;
      } catch {
        // Not a Node.js that runs; try the next.
      }
    }
  }
  return null;
}

// startHelperIfNeeded({ ask, spawn, node, root }) -> Promise<boolean>: true when it started the helper. `ask` says
// whether the helper answers. Where it doesn't and Node.js runs, starts `start-helper.js start` detached; where
// neither, does nothing and the pane says the helper isn't running. Never throws.
async function startHelperIfNeeded({ ask, spawn = childProcess.spawn, node, root } = {}) {
  try {
    if (await ask()) return false;
    if (typeof node !== 'string' || node === '') return false;
    const child = spawn(node, [path.join(root, START_HELPER), 'start'], { detached: true, stdio: 'ignore', windowsHide: true });
    child?.unref?.();
    return true;
  } catch {
    return false;
  }
}

// The real desk, the helper's health check and the scripts the press uses, from the add-on's own folder.
async function realDeps({ root, cwd }) {
  const m = {};
  for (const [name, rel] of Object.entries(LOADS)) m[name] = await load(root, rel);
  const client = m.helper.helperClient({ timeout: 3000 });
  const now = () => new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const project = () => {
    try {
      return m.kit.projectOf(cwd)?.project ?? null;
    } catch {
      return null;
    }
  };
  return {
    desk: m.desk.modDesk({ cwd, client }),
    client,
    ask: async () => (await client.health().catch(() => null))?.ok === true,
    project,
    // The scripts' own exports, merged and handed on whole: this file names none of the functions that press. Only
    // vscode/press.cjs calls them, and only from onPaneMessage (scripts/addon/validate.js).
    press: Object.assign({}, m.press, m.settings, m.digest, m.record, m.desk),
    stopState: m.stop.stopState,
    setStop: m.stop.setStop,
    liftStop: m.stop.liftStop,
    liftQuestion: m.cardLines.LIFT_STOP,
    versionsFile: m.versions.versionsFile(),
    timeZone,
    settingsView: async () => {
      const id = project();
      if (id === null) return { groups: [] };
      const effective = m.settings.effectiveFor({ project: id, now });
      const changes = m.settings.changesFor({ project: id });
      return { groups: m.settings.settingsGroups({ effective, changes, now, timeZone, stop: m.stop.stopState() }) };
    },
  };
}

module.exports = { LOADS, START_HELPER, HELPER_DOWN, NOTHING_READ, NO_NODE, wheelhouseRoot, load, findNode, startHelperIfNeeded, realDeps };
