// probes/35-node/run.js
// Check 35: Node.js and the hooks. Makes a scratch project whose settings carry
// two logging hooks on every tool call and at the session start, copies the
// Wheelhouse plugin beside it for installing, and reads the hooks' log back.
//   node run.js setup [--root <folder>] [--plugin-from <repository>]  (root: a wheelhouse-check35* folder under the temporary folder or /Users/Shared)
//   node run.js hook <log folder>        (what the logging hook runs; reads stdin)
//   node run.js read <log folder>        (prints what the hooks logged)
//   node run.js cleanup <root>           (removes a scratch root)
// The node hook records process.env.PATH, process.execPath and the Node.js
// version, as a hook sees them. The second hook is a shell one (not Node.js), so
// it still logs when `node` cannot be found; it records PATH and where `command
// -v node` finds node. On Windows the second hook is a PowerShell one doing the
// same with `Get-Command node` (written from the documentation; not yet run on
// Windows).
//
// `setup` needs Node.js, so for the macOS sitting it is run from the director's
// own account, into /Users/Shared/wheelhouse-check35, which the throwaway
// account can read and write. It copies this script and run.md into that folder,
// and the hooks run the copy, and starts notes.md for the sitting's results. See run.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const NODE_LOG = 'hook-node.jsonl';
const SH_LOG = 'hook-sh.log';
const COPIED = ['.claude-plugin', 'hooks', 'commands', 'agents', 'skills', 'scripts', 'templates', 'lineage', 'reference', 'package.json'];

function option(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function assertScratch(dir) {
  const resolved = path.resolve(dir);
  const allowed = [os.tmpdir(), fs.realpathSync(os.tmpdir()), '/Users/Shared'].map((root) => path.resolve(root));
  const inside = allowed.some((root) => resolved !== root && resolved.startsWith(root + path.sep));
  if (!inside || !path.basename(resolved).startsWith('wheelhouse-check35')) {
    throw new Error(`Refusing to touch ${resolved}: not a wheelhouse-check35 folder in a temporary place`);
  }
}

// What the project's settings carry for the logging hooks. `script` is the copy
// of this file the hooks run.
export function hooksFor(logDir, { script = SELF, windows = process.platform === 'win32' } = {}) {
  const nodeHook = { type: 'command', command: `node "${script}" hook "${logDir}"`, timeout: 10 };
  const shellHook = (event) => {
    if (windows) {
      const log = path.join(logDir, SH_LOG);
      return {
        type: 'command',
        shell: 'powershell',
        command: `@("at $((Get-Date).ToUniversalTime().ToString('o')) ${event}", "PATH=$env:Path", "node=$((Get-Command node -ErrorAction SilentlyContinue).Source)") | Add-Content -Path "${log}"`,
        timeout: 10,
      };
    }
    return {
      type: 'command',
      command: `{ echo "at $(date -u +%FT%TZ) ${event}"; echo "PATH=$PATH"; echo "node=$(command -v node || echo none)"; } >> "${path.join(logDir, SH_LOG)}"`,
      timeout: 10,
    };
  };
  const forEvent = (event) => [nodeHook, shellHook(event)];
  return {
    SessionStart: [{ hooks: forEvent('SessionStart') }],
    PreToolUse: [{ matcher: '*', hooks: forEvent('PreToolUse') }],
  };
}

function setup(args) {
  const root = path.resolve(option(args, '--root') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check35-')));
  assertScratch(root);
  fs.mkdirSync(root, { recursive: true });
  const logDir = path.join(root, 'log');
  const project = path.join(root, 'project');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(project, 'hello.txt'), 'hello from check 35\n');
  const script = path.join(root, 'run.js');
  fs.copyFileSync(SELF, script);
  const guide = path.join(path.dirname(SELF), 'run.md');
  if (fs.existsSync(guide)) fs.copyFileSync(guide, path.join(root, 'run.md'));
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ hooks: hooksFor(logDir, { script }) }, null, 2) + '\n');
  const from = option(args, '--plugin-from');
  if (from) {
    const market = path.join(root, 'marketplace');
    const plugin = path.join(market, 'plugin');
    fs.mkdirSync(plugin, { recursive: true });
    for (const name of COPIED) {
      const source = path.join(path.resolve(from), name);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(plugin, name), { recursive: true });
    }
    fs.mkdirSync(path.join(market, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      name: 'wheelhouse-check35',
      owner: { name: 'Wheelhouse probe' },
      plugins: [{ name: 'wheelhouse', source: './plugin', description: 'Scratch copy for check 35.' }],
    }, null, 2) + '\n');
  }
  const notes = path.join(root, 'notes.md');
  if (!fs.existsSync(notes)) fs.writeFileSync(notes, '# Check 35 notes\n\nResults of each trial, appended as they are made (see run.md).\n');
  // Readable and writable by any account on this computer, so another account's
  // session can use the folder (the logs are written by that account).
  if (process.platform !== 'win32') execFileSync('chmod', ['-R', 'a+rwX', root]);
  console.log(JSON.stringify({ root, project, logDir, marketplace: from ? path.join(root, 'marketplace') : null }, null, 2));
}

async function hook(args) {
  const logDir = args[0];
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw); } catch { input = {}; }
  const record = {
    at: new Date().toISOString(),
    event: input.hook_event_name ?? null,
    tool: input.tool_name ?? null,
    platform: process.platform,
    execPath: process.execPath,
    nodeVersion: process.version,
    path: process.env.PATH ?? process.env.Path ?? null,
  };
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, NODE_LOG), JSON.stringify(record) + '\n');
  try { fs.chmodSync(path.join(logDir, NODE_LOG), 0o666); } catch { /* not ours to change */ }
}

function read(args) {
  const logDir = args[0];
  const nodeLog = path.join(logDir, NODE_LOG);
  const shLog = path.join(logDir, SH_LOG);
  if (fs.existsSync(nodeLog)) {
    console.log('Node hook (it ran, so node was found):');
    for (const line of fs.readFileSync(nodeLog, 'utf8').trim().split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      console.log(`- ${r.at} ${r.event}${r.tool ? ' ' + r.tool : ''}: execPath ${r.execPath}, node ${r.nodeVersion}`);
      console.log(`  PATH: ${(r.path ?? '').split(path.delimiter).join('  |  ')}`);
    }
  } else {
    console.log('Node hook: no log (it never ran, or node was not found).');
  }
  console.log(fs.existsSync(shLog) ? `\nShell hook:\n${fs.readFileSync(shLog, 'utf8')}` : '\nShell hook: no log.');
}

function cleanup(args) {
  assertScratch(args[0]);
  fs.rmSync(path.resolve(args[0]), { recursive: true, force: true });
  console.log(`removed ${path.resolve(args[0])}`);
}

const [command, ...rest] = process.argv.slice(2);
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  const commands = { setup, hook, read, cleanup };
  if (!commands[command]) {
    console.error('Usage: node run.js setup | hook <log folder> | read <log folder> | cleanup <root>');
    process.exit(2);
  }
  await commands[command](rest);
}
