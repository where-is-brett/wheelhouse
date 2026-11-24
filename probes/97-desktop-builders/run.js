// probes/97-desktop-builders/run.js
// Check 97 (builders part 0): what Claude Desktop does with sessions the foreman starts. The pure parts are exported and
// tested; the rest only runs when the file is started directly:
//   node probes/97-desktop-builders/run.js prepare [dir]       make the scratch project the sitting runs in (default: ~/.wheelhouse-trials/desktop-probe)
//   node probes/97-desktop-builders/run.js report <try> [dir]   a started session records what it sees of itself
//   node probes/97-desktop-builders/run.js note <key> <json>    record one finding the foreman read for itself
//   node probes/97-desktop-builders/run.js scan <title>         look in Desktop's own files for a parent field on a session
//   node probes/97-desktop-builders/run.js assemble [out]       write the findings as the sitting's note
// Findings are kept under the probe's own folder in the Wheelhouse home's scratch area, never in the repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---- Pure parts -------------------------------------------------------------------------------------------------

// The points section 4 of the design leaves inferred. A key with no finding is written "not tried".
export const FINDINGS = Object.freeze([
  'cwdOnOffer',
  'worktreePath',
  'worktreeBranch',
  'projectHooks',
  'entrypoint',
  'pluginLoad',
  'sendMessage',
  'wakeWhenDone',
  'quitAndReopen',
  'desktopFlag',
  'nesting',
]);

const asText = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

// The note parts 6 and 7 read. Every key appears; one nobody tried says so.
export function notesFor(findings = {}) {
  const lines = [
    '<!-- docs/specs/notes/2026-11-24-desktop-probe.md -->',
    '# Desktop probe findings',
    '',
    'Recorded on 24 November 2026 by the sitting in `probes/97-desktop-builders/README.md`. Parts 6 and 7 of the builders plan follow these.',
    '',
  ];
  for (const key of FINDINGS) {
    if (key === 'nesting') continue;
    lines.push(`- \`${key}\`: ${key in findings ? asText(findings[key]) : 'not tried'}`);
  }
  lines.push('', '## Nesting', '');
  const nesting = findings.nesting;
  if (!nesting) lines.push('- `nesting`: not tried');
  else if (nesting.nested === true) lines.push(`- The sessions nested under the foreman: yes, by \`${nesting.how}\`.`, `- The sidebar showed: ${nesting.sidebar}`);
  else lines.push('- Desktop did not nest the sessions the foreman started: nested under the foreman: no.', `- The sidebar showed: ${nesting.sidebar}`, '- Parts 6 and 7 build section 7.4\'s top-level titles.');
  return `${lines.join('\n')}\n`;
}

// What a started session can read of itself, with no help from the director.
export function selfReport({ cwd = process.cwd(), env = process.env } = {}) {
  const real = fs.realpathSync(cwd);
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: real, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return {
    cwd: real,
    gitRoot: git('rev-parse', '--show-toplevel'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    inWorktree: git('rev-parse', '--git-common-dir') !== git('rev-parse', '--git-dir'),
    entrypoint: env.CLAUDE_CODE_ENTRYPOINT ?? null,
    hookRan: fs.existsSync(path.join(real, '.probe', 'hook-ran.txt')),
    pluginRoot: env.CLAUDE_PLUGIN_ROOT ?? null,
    at: new Date().toISOString(),
  };
}

// The folder prepare uses when none is given. PowerShell does not expand `~` for node, so the home is read here.
export const defaultScratch = (homedir = os.homedir()) => path.join(homedir, '.wheelhouse-trials', 'desktop-probe');

// What the hook runs: a node script beside the settings file, its path quoted and written with forward slashes so the
// same text works in a POSIX shell and on Windows.
export function hookCommand(dir, platform = process.platform) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return `node "${join(dir, '.claude', 'probe-hook.js').replaceAll('\\', '/')}"`;
}

const HOOK_SCRIPT = `// .claude/probe-hook.js
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', '.probe');
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, 'hook-ran.txt'), \`\${new Date().toISOString()}\\n\`);
`;

// The scratch project: a git repository with a session-start hook that leaves a marker, so a started session can say
// whether the project's own hooks ran.
export function prepareScratch(dir) {
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.probe'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'probe-hook.js'), HOOK_SCRIPT);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), `${JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(dir) }] }] } }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.probe/\n');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Probe scratch project\n');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  if (!fs.existsSync(path.join(dir, '.git'))) git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', 'commit', '-q', '-m', 'Probe scratch project', '--allow-empty');
}

// Where Desktop keeps its own files. The Mac has one folder; Windows has the installer's folder under %APPDATA% and, for a
// Microsoft Store install, a copy under the package's local cache.
export function desktopRoots({ platform = process.platform, homedir = os.homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return [path.join(homedir, 'Library', 'Application Support', 'Claude')];
  if (platform !== 'win32') return [path.join(homedir, '.config', 'Claude')];
  const roaming = env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA ?? path.join(homedir, 'AppData', 'Local');
  const roots = [path.join(roaming, 'Claude')];
  let packages = [];
  try {
    packages = fs.readdirSync(path.join(local, 'Packages'), { withFileTypes: true });
  } catch {
    // no Packages folder: no Store install
  }
  for (const entry of packages) {
    if (entry.isDirectory() && entry.name.startsWith('Claude')) roots.push(path.join(local, 'Packages', entry.name, 'LocalCache', 'Roaming', 'Claude'));
  }
  return roots;
}

// Fields on a record that names the title and look like a parent link. Only the record's own top level is read.
export function parentFields(record, title) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  const names = Object.values(record).some((v) => v === title);
  if (!names) return [];
  return Object.entries(record)
    .filter(([key, value]) => /parent|spawn|origin|owner|started.?by|fork/i.test(key) && value != null && typeof value !== 'object')
    .map(([field, value]) => ({ field, value }));
}

export const mergeFindings = (earlier, later) => {
  const out = { ...earlier };
  for (const key of FINDINGS) if (key in later) out[key] = later[key];
  return out;
};

// ---- The rest: runs only when started directly --------------------------------------------------------------------

const home = () => path.join(process.env.WHEELHOUSE_HOME ?? path.join(os.homedir(), '.wheelhouse'), 'probes', '97-desktop-builders');
const findingsFile = () => path.join(home(), 'findings.json');
const readFindings = () => {
  try {
    return JSON.parse(fs.readFileSync(findingsFile(), 'utf8'));
  } catch {
    return {};
  }
};
const save = (findings) => {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(findingsFile(), `${JSON.stringify(findings, null, 2)}\n`);
};

// Files under Desktop's own folder that hold session records: JSON only, a bounded walk.
function* sessionFiles(root, depth = 4) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && depth > 0 && !/^(Cache|Code Cache|GPUCache|node_modules|Crashpad)/.test(entry.name)) yield* sessionFiles(full, depth - 1);
    else if (entry.isFile() && /\.json$/.test(entry.name)) yield full;
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'prepare') {
    const dir = path.resolve(args[0] ?? defaultScratch());
    prepareScratch(dir);
    console.log(`scratch project ready: ${dir}`);
  } else if (command === 'report') {
    const report = selfReport({ cwd: args[1] ?? process.cwd() });
    const dir = path.join(home(), 'reports');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${args[0]}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
  } else if (command === 'note') {
    save(mergeFindings(readFindings(), { [args[0]]: JSON.parse(args[1]) }));
  } else if (command === 'scan') {
    const found = [];
    const files = desktopRoots().flatMap((root) => [...sessionFiles(root)]);
    for (const file of files) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      for (const record of Array.isArray(data) ? data : [data]) {
        const fields = parentFields(record, args[0]);
        if (fields.length) found.push({ file, fields });
      }
    }
    console.log(JSON.stringify(found, null, 2));
  } else if (command === 'assemble') {
    const out = args[0] ?? 'docs/specs/notes/2026-11-24-desktop-probe.md';
    fs.writeFileSync(out, notesFor(readFindings()));
    console.log(`note written: ${out}`);
  } else {
    console.error('usage: run.js prepare|report|note|scan|assemble');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
