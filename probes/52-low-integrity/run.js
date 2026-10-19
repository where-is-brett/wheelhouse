// probes/52-low-integrity/run.js
// Check 52: the low-integrity runner. On Windows, as a standard user, this finds out
// what a copy of node.exe labelled low can and cannot do, in a scratch repository with
// a linked worktree under the temporary folder. It follows
// docs/research/windows-build-commands-2026-10.md section 8.4, items 1 to 7.
//
// Each trial prints one line: `PASS <name>: <detail>`, `FAIL <name>: ...` or
// `SEEN <name>: ...`. PASS means the protective thing held (a write was refused, a
// lock held, git worked) and FAIL that it did not; SEEN is a plain observation. After the
// trials the script prints `LOCK_READS_ROUTE <icacls|powershell|ffi|none>` and, for the
// route that held, `LOCK_READS_CALL <the exact call>`.
//
// What it makes: everything is under the temporary folder, removed at the end or on Ctrl+C,
// except three uniquely named entries it asks Windows to make to see whether the low process
// is refused: a .txt file in the Startup folder, a value under HKCU Run, and a scheduled task.
// A medium-level step removes each of them at the end, whatever happened.
// It never reads your own secrets: the "secret folders" are markers in a scratch folder, and
// `git credential fill` runs only against an empty scratch configuration.
//
// Usage: node probes/52-low-integrity/run.js
// Log (the trial lines and the exact scripts it used): <home>/.wheelhouse-probes/52-low-integrity/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { appendJsonl, probeLogDir } from '../lib/log.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';
import {
  encodePowerShell, integrityOf, judgeAccess, labelResult, labelScript, mxcBuildReached, NO_READ_UP_SDDL,
  parseBuild, parseTry, parseUbr, reportLine, seconds,
} from '../lib/windows.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// icacls spellings tried for a "no read up" label (the documentation shows a Level:policy form but not the read flag).
export const ICACLS_LOCK_FORMS = ['(OI)(CI)M:NR', '(OI)(CI)M:NWNR', '(OI)(CI)M:(NR)', '(OI)(CI)M:NW,NR'];
export const LOCK_ROUTES = ['icacls', 'powershell', 'ffi'];

// ------------------------------------------------------------------ running things

async function exec(file, args = [], { cwd, env, timeoutMs = 120000, input } = {}) {
  try {
    return await run(file, args, { cwd, env, input, timeoutMs, baseEnv: withoutGitVars(process.env) });
  } catch (error) {
    return { code: null, stdout: '', stderr: error.message, error, failedToStart: true };
  }
}

const tail = (text, n = 300) => String(text ?? '').trim().slice(-n);

// The state of one run: where its scratch things are and what it has reported.
function makeContext() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `wheelhouse-probe-52-${process.pid}-${Date.now().toString(36)}`;
  const log = path.join(probeLogDir('52-low-integrity'), `run-${stamp}.jsonl`);
  return { id, log, lines: [], counts: { PASS: 0, FAIL: 0, SEEN: 0 }, cleanups: [], extraDirs: [] };
}

async function say(ctx, status, name, detail = '', extra = {}) {
  const line = reportLine(status, name, detail);
  console.log(line);
  ctx.lines.push(line);
  ctx.counts[status] += 1;
  await appendJsonl(ctx.log, { at: new Date().toISOString(), status, name, detail, ...extra }).catch(() => {});
}

// Runs the helper through the low (or a normal) copy of node and returns what it printed.
async function through(ctx, node, operation, args = [], { cwd = ctx.root, env = ctx.lowEnv } = {}) {
  const result = await exec(node, [ctx.helper, operation, ...args], { cwd, env, timeoutMs: 6 * 60 * 1000 });
  if (result.failedToStart) return { ok: false, code: result.error.code ?? 'SPAWN', message: result.error.message, started: false };
  const parsed = parseTry(result.stdout);
  if (parsed) return { ...parsed, started: true };
  return { ok: false, code: 'NOJSON', message: tail(result.stderr) || `exit ${result.code}, nothing printed`, started: result.code !== null };
}

const low = (ctx, operation, args, options) => through(ctx, ctx.lowNode, operation, args, options);
const medium = (ctx, operation, args, options) => through(ctx, ctx.mediumNode, operation, args, options);

async function icacls(ctx, target, spec, { recurse = false } = {}) {
  const args = [target, ...(recurse ? ['/T', '/C', '/Q'] : []), '/setintegritylevel', spec];
  const result = await exec('icacls', args);
  return { ok: result.code === 0, call: `icacls ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, message: tail(`${result.stdout} ${result.stderr}`) };
}

function brief(result) {
  return result.ok ? 'ok' : `${result.code ?? 'error'}${result.message ? ` ${tail(result.message, 120)}` : ''}${result.stderr ? ` ${tail(result.stderr, 120)}` : ''}`;
}

// ------------------------------------------------------------------ the trials

async function environment(ctx) {
  const ver = await exec('cmd.exe', ['/d', '/c', 'ver']);
  const ubrOut = await exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'UBR']);
  const displayOut = await exec('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion', '/v', 'DisplayVersion']);
  const ubr = parseUbr(ubrOut.stdout);
  const build = parseBuild(ver.stdout || os.release(), ubr);
  const display = /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(displayOut.stdout)?.[1] ?? 'unknown';
  await say(ctx, 'SEEN', 'windows-build', `${tail(ver.stdout, 80).replace(/\s+/g, ' ')} (os.release ${os.release()}, update revision ${ubr ?? 'unknown'}, version ${display})`);
  const reached = mxcBuildReached(build);
  await say(ctx, 'SEEN', 'mxc-build-threshold', reached === null ? 'could not tell' : `${reached ? 'at or above' : 'below'} 26100.9278 / 26200.9278`);
  const policy = await exec('reg', ['query', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SrpV2']);
  await say(ctx, 'SEEN', 'applocker-policy-keys', policy.code === 0 ? 'present (AppLocker rules are set on this computer)' : 'absent (no AppLocker rules found)');
  await say(ctx, 'SEEN', 'node-version', `${process.version} at ${process.execPath}`);
  const who = await exec('whoami', ['/groups']);
  const own = integrityOf(who.stdout);
  await say(ctx, 'SEEN', 'probe-own-integrity', own ?? 'unknown');
  return own;
}

async function languageMode(ctx) {
  const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ExecutionContext.SessionState.LanguageMode']);
  const mode = result.code === 0 ? result.stdout.trim() : null;
  await say(ctx, 'SEEN', 'powershell-language-mode', mode ?? `could not run: ${tail(result.stderr, 120)}`);
  return mode;
}

async function makeLowNode(ctx) {
  const bin = path.join(ctx.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  ctx.lowNode = path.join(bin, 'node-low.exe');
  ctx.mediumNode = path.join(bin, 'node-medium.exe');
  fs.copyFileSync(process.execPath, ctx.lowNode);
  fs.copyFileSync(process.execPath, ctx.mediumNode);

  // Control: a copy that is not labelled, so a refusal of the low one can be told from a refusal of any copy.
  const plain = await exec(ctx.mediumNode, ['-e', 'console.log("started")']);
  const plainStarts = plain.code === 0 && plain.stdout.includes('started');
  await say(ctx, plainStarts ? 'PASS' : 'SEEN', 'medium-copy-starts', plainStarts ? 'an unlabelled copy of node.exe in the scratch folder starts' : `an unlabelled copy did not start: ${plain.failedToStart ? plain.error.code : `exit ${plain.code}`} ${tail(plain.stderr, 160)}`);

  const labelled = await icacls(ctx, ctx.lowNode, 'L');
  await say(ctx, labelled.ok ? 'PASS' : 'FAIL', 'low-label-set', labelled.ok ? `${labelled.call}` : `icacls refused: ${labelled.message}`);
  if (!labelled.ok) return false;

  const started = await exec(ctx.lowNode, ['-e', 'console.log("started")']);
  if (started.failedToStart || started.code !== 0 || !started.stdout.includes('started')) {
    const why = started.failedToStart ? `${started.error.code ?? ''} ${started.error.message}` : `exit ${started.code} ${tail(started.stderr, 200)}`;
    await say(ctx, 'SEEN', 'low-node-refused-by-policy', `${plainStarts ? 'the unlabelled copy starts but the low one does not' : 'neither copy starts'}: ${why}`);
    return false;
  }
  const own = await exec(ctx.lowNode, [ctx.helper, 'whoami'], { env: ctx.lowEnv });
  const level = integrityOf(parseTry(own.stdout)?.stdout);
  await say(ctx, level === 'low' ? 'PASS' : 'FAIL', 'low-node-starts-at-low', `whoami /groups from the copy shows ${level ?? 'no Mandatory Label row'} (S-1-16-4096 is Low Mandatory Level)`);
  const child = await low(ctx, 'child-whoami');
  const childLevel = integrityOf(child.stdout);
  await say(ctx, childLevel === 'low' ? 'PASS' : 'FAIL', 'low-child-is-low', `a process the low copy starts shows ${childLevel ?? `no Mandatory Label row (${brief(child)})`}`);
  return level === 'low';
}

async function makeFolders(ctx) {
  const dirs = {
    wheelhouse: path.join(ctx.root, 'medium', 'wheelhouse'),
    ssh: path.join(ctx.root, 'medium', 'ssh'),
    claude: path.join(ctx.root, 'medium', 'claude'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dirs.wheelhouse, 'keys-marker.txt'), 'marker standing in for the helper keys folder\n');
  fs.writeFileSync(path.join(dirs.ssh, 'id-marker.txt'), 'marker standing in for ~/.ssh\n');
  fs.writeFileSync(path.join(dirs.claude, 'settings.json'), '{}\n');
  ctx.dirs = dirs;
  ctx.lowWork = path.join(ctx.root, 'low-work');
  fs.mkdirSync(ctx.lowWork, { recursive: true });
}

async function labelLowWork(ctx) {
  const labelled = await icacls(ctx, ctx.lowWork, '(OI)(CI)L');
  if (!labelled.ok) {
    await say(ctx, 'FAIL', 'label-low-work-folder', labelled.message);
    return;
  }
  for (const dir of ['tmp', 'npm-cache']) fs.mkdirSync(path.join(ctx.lowWork, dir), { recursive: true });
  ctx.lowEnv = { TEMP: path.join(ctx.lowWork, 'tmp'), TMP: path.join(ctx.lowWork, 'tmp'), npm_config_cache: path.join(ctx.lowWork, 'npm-cache'), npm_config_update_notifier: 'false' };
}

// The scratch repository and its linked worktree, with the files Wheelhouse protects.
async function makeRepository(ctx) {
  const project = await makeScratchProject({
    name: '52-repo',
    files: {
      'README.md': 'scratch\n',
      'notes.txt': 'tracked file\n',
      'package.json': `${JSON.stringify({ name: 'probe', version: '1.0.0', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
      'test/probe.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('adds', () => assert.equal(1 + 1, 2));\n",
      '.claude/settings.json': '{}\n',
      '.mcp.json': '{}\n',
      '.vscode/settings.json': '{}\n',
    },
  });
  ctx.repo = project;
  ctx.cleanups.push(() => project.cleanup());
  ctx.worktree = path.join(os.tmpdir(), `${ctx.id}-wt`);
  ctx.extraDirs.push(ctx.worktree);
  const add = await exec('git', ['worktree', 'add', '-q', '-b', 'feature/probe-one', ctx.worktree], { cwd: project.dir });
  if (add.code !== 0) throw new Error(`git worktree add failed: ${tail(add.stderr)}`);
  const common = await exec('git', ['rev-parse', '--git-common-dir'], { cwd: ctx.worktree });
  const gitDir = await exec('git', ['rev-parse', '--git-dir'], { cwd: ctx.worktree });
  ctx.commonDir = path.resolve(ctx.worktree, common.stdout.trim());
  ctx.adminDir = path.resolve(ctx.worktree, gitDir.stdout.trim());
  // The folder the runner keeps its temporary files in; git must not see it as new work.
  fs.appendFileSync(path.join(ctx.commonDir, 'info', 'exclude'), '.wheelhouse/\n');
}

// The labelling the plan's labelWorktree describes (task 6): the worktree low with inheritance,
// its .git file, .claude, .mcp.json and .vscode back to medium, and low on the folders git writes to.
async function labelWorktree(ctx, { recurse }) {
  const wt = ctx.worktree;
  const exists = (p) => fs.existsSync(p);
  const steps = [
    [wt, '(OI)(CI)L'],
    [path.join(wt, '.git'), 'M'],
    [path.join(wt, '.claude'), '(OI)(CI)M'],
    [path.join(wt, '.mcp.json'), 'M'],
    [path.join(wt, '.vscode'), '(OI)(CI)M'],
    [ctx.adminDir, '(OI)(CI)L'],
    [path.join(ctx.commonDir, 'objects'), '(OI)(CI)L'],
    [path.join(ctx.commonDir, 'refs', 'heads', 'feature'), '(OI)(CI)L'],
    [path.join(ctx.commonDir, 'logs', 'refs', 'heads', 'feature'), '(OI)(CI)L'],
  ];
  const failures = [];
  const calls = [];
  for (const [target, spec] of steps) {
    if (!exists(target)) {
      failures.push(`${target} is not there`);
      continue;
    }
    const result = await icacls(ctx, target, spec, { recurse });
    calls.push(result.call);
    if (!result.ok) failures.push(`${result.call}: ${result.message}`);
  }
  return { failures, calls };
}

async function worktreeLabelling(ctx) {
  let recurse = false;
  let labelled = await labelWorktree(ctx, { recurse });
  let reaches = judgeAccess(await low(ctx, 'append', [path.join(ctx.worktree, 'notes.txt'), 'x']));
  if (reaches !== 'allowed' && !labelled.failures.length) {
    recurse = true;
    labelled = await labelWorktree(ctx, { recurse });
    const again = judgeAccess(await low(ctx, 'append', [path.join(ctx.worktree, 'notes.txt'), 'x']));
    await say(ctx, 'SEEN', 'label-reaches-existing-files', again === 'allowed' ? 'no: files already in the worktree stay unwritable until icacls is given /T; with /T they are writable' : `no: an existing file is still ${again === 'refused' ? 'refused' : 'unusable'} even with /T`);
    reaches = again;
  } else {
    await say(ctx, 'SEEN', 'label-reaches-existing-files', reaches === 'allowed' ? 'yes: a file that was in the worktree before it was labelled is writable from low without /T' : 'unclear: the write failed for another reason');
  }
  ctx.recurse = recurse;
  await say(ctx, labelled.failures.length ? 'FAIL' : 'PASS', 'git-label-worktree', labelled.failures.length ? labelled.failures.join(' | ') : `${labelled.calls.length} icacls calls, all accepted${recurse ? ' (each with /T /C /Q)' : ''}: the worktree (OI)(CI)L, then .git M, .claude (OI)(CI)M, .mcp.json M, .vscode (OI)(CI)M, then (OI)(CI)L on the worktree's admin folder, objects, refs/heads/feature and logs/refs/heads/feature; the exact calls are in the log`, { calls: labelled.calls });
  ctx.wtTmp = path.join(ctx.worktree, '.wheelhouse', 'tmp');
  fs.mkdirSync(ctx.wtTmp, { recursive: true });
  ctx.wtEnv = { TEMP: ctx.wtTmp, TMP: ctx.wtTmp, npm_config_cache: path.join(ctx.wtTmp, 'npm-cache'), npm_config_update_notifier: 'false' };
  fs.mkdirSync(ctx.wtEnv.npm_config_cache, { recursive: true });
}

async function writes(ctx) {
  const wt = ctx.worktree;
  const refusal = async (name, what, result, detailIfRefused) => {
    const verdict = judgeAccess(result);
    if (verdict === 'refused') await say(ctx, 'PASS', name, detailIfRefused ?? `refused (${what})`);
    else if (verdict === 'allowed') await say(ctx, 'FAIL', name, `the low process wrote it (${what})`);
    else await say(ctx, 'SEEN', name, `inconclusive, failed another way: ${brief(result)}`);
  };

  const control = await low(ctx, 'append', [path.join(wt, 'control.txt'), 'ok']);
  await say(ctx, judgeAccess(control) === 'allowed' ? 'PASS' : 'FAIL', 'write-inside-worktree', judgeAccess(control) === 'allowed' ? 'a new file in the labelled worktree is written' : `the low process can't write in the worktree it was labelled for: ${brief(control)}`);

  // Outside the worktree.
  await refusal('write-medium-folder', 'a new file in an unlabelled scratch folder', await low(ctx, 'append', [path.join(ctx.root, 'medium', 'new.txt'), 'x']));
  await refusal('write-claude-settings-standin', 'an existing settings.json in a scratch .claude folder, standing in for ~/.claude/settings.json', await low(ctx, 'append', [path.join(ctx.dirs.claude, 'settings.json'), ' ']));

  const appdata = process.env.APPDATA;
  if (appdata) {
    ctx.startupFile = path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', `${ctx.id}.txt`);
    await refusal('write-startup-folder', 'a .txt file named for this probe in the Startup folder', await low(ctx, 'append', [ctx.startupFile, 'probe 52, safe to delete']));
  } else {
    await say(ctx, 'SEEN', 'write-startup-folder', 'skipped: APPDATA is not set');
  }

  ctx.runValue = ctx.id;
  const reg = await low(ctx, 'exec', ['reg', 'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', ctx.runValue, '/t', 'REG_SZ', '/d', 'cmd.exe /c rem', '/f']);
  await refusal('write-hkcu-run', 'a value under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run, removed afterwards', reg);

  // Inside the worktree, where Wheelhouse keeps things at the normal level.
  await refusal('write-git-hooks', 'a new hooks/pre-commit in the repository\'s common folder', await low(ctx, 'append', [path.join(ctx.commonDir, 'hooks', 'pre-commit'), '#!/bin/sh\n']));
  await refusal('write-git-config', 'the common folder\'s config', await low(ctx, 'append', [path.join(ctx.commonDir, 'config'), '\n']));
  await refusal('write-worktree-git-file', 'the worktree\'s .git file', await low(ctx, 'append', [path.join(wt, '.git'), '\n']));
  await refusal('write-worktree-claude-existing', '.claude/settings.json, a file already there', await low(ctx, 'append', [path.join(wt, '.claude', 'settings.json'), ' ']));
  await refusal('write-worktree-claude-new', 'a new file in .claude', await low(ctx, 'append', [path.join(wt, '.claude', 'probe.txt'), 'x']));
  await refusal('write-worktree-mcp-json', '.mcp.json', await low(ctx, 'append', [path.join(wt, '.mcp.json'), ' ']));
  await refusal('write-worktree-vscode', 'a new file in .vscode', await low(ctx, 'append', [path.join(wt, '.vscode', 'probe.txt'), 'x']));
}

async function reads(ctx) {
  const seen = async (name, file, what) => {
    const result = await low(ctx, 'read', [file]);
    const verdict = judgeAccess(result);
    await say(ctx, 'SEEN', name, verdict === 'allowed' ? `readable from low (${what})` : verdict === 'refused' ? `refused (${what})` : `inconclusive: ${brief(result)}`);
  };
  await seen('read-wheelhouse-standin', path.join(ctx.dirs.wheelhouse, 'keys-marker.txt'), 'a marker in a scratch folder standing in for ~/.wheelhouse');
  await seen('read-ssh-standin', path.join(ctx.dirs.ssh, 'id-marker.txt'), 'a marker in a scratch folder standing in for ~/.ssh');
  await seen('read-claude-settings-standin', path.join(ctx.dirs.claude, 'settings.json'), 'a scratch settings.json standing in for ~/.claude/settings.json');

  // git credential fill, against an empty scratch configuration only: it shows that git runs at low, not what a real store holds.
  const config = path.join(ctx.root, 'empty-gitconfig');
  fs.writeFileSync(config, '');
  const fill = await low(ctx, 'exec-stdin', ['protocol=https\\nhost=probe.invalid\\n\\n', 'git', 'credential', 'fill'], {
    env: { ...ctx.lowEnv, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', HOME: ctx.root, USERPROFILE: ctx.root },
  });
  await say(ctx, 'SEEN', 'git-credential-fill-scratch', `run at low against an empty scratch configuration, never against real credentials; git ${fill.started ? 'ran' : 'did not start'} (${tail(fill.stderr ?? fill.message ?? '', 120)}). What a real credential store gives a low process was not asked`);
}

// Sets a no-read-up label on a fresh scratch folder by `apply`, then tries to read it from low and from here.
async function tryLock(ctx, route, label, apply) {
  const dir = path.join(ctx.root, 'lock', `${route}-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'before.txt'), 'there before the label\n');
  const applied = await apply(dir);
  if (!applied.ok) return { held: false, applied, why: applied.why };
  fs.writeFileSync(path.join(dir, 'after.txt'), 'made after the label\n');
  const list = judgeAccess(await low(ctx, 'list', [dir]));
  const before = judgeAccess(await low(ctx, 'read', [path.join(dir, 'before.txt')]));
  const after = judgeAccess(await low(ctx, 'read', [path.join(dir, 'after.txt')]));
  let own = false;
  try { own = fs.readFileSync(path.join(dir, 'before.txt'), 'utf8').length > 0; } catch { /* medium can't read it either */ }
  const held = list === 'refused' && before === 'refused' && after === 'refused' && own;
  return { held, applied, why: `from low: listing ${list}, file from before the label ${before}, file made after ${after}; from the probe itself: ${own ? 'still readable' : 'NOT readable'}` };
}

async function lockReads(ctx, mode) {
  const results = {};
  let n = 0;

  // icacls
  results.icacls = { held: false, call: null };
  for (const form of ICACLS_LOCK_FORMS) {
    for (const recurse of [false, true]) {
      if (results.icacls.held) break;
      n += 1;
      const attempt = await tryLock(ctx, 'icacls', String(n), async (dir) => {
        const set = await icacls(ctx, dir, form, { recurse });
        return { ok: set.ok, call: set.call, why: set.message };
      });
      await say(ctx, 'SEEN', 'lock-reads-icacls', `${form}${recurse ? ' with /T' : ''}: ${attempt.applied.ok ? attempt.why : `icacls refused it: ${attempt.why}`}`);
      if (attempt.applied.ok && attempt.held) results.icacls = { held: true, call: `icacls <folder> ${recurse ? '/T /C /Q ' : ''}/setintegritylevel ${form}` };
      if (!attempt.applied.ok && !recurse) break; // the spelling is refused; /T would not change that
    }
    if (results.icacls.held) break;
  }
  await say(ctx, 'SEEN', 'lock-reads-icacls-summary', results.icacls.held ? `held with: ${results.icacls.call}` : 'no spelling of /setintegritylevel set a label that held');

  // PowerShell
  results.powershell = { held: false, call: null };
  if (mode === 'FullLanguage') {
    const attempt = await tryLock(ctx, 'powershell', '1', async (dir) => {
      const script = labelScript(dir);
      const out = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(script)], { timeoutMs: 120000 });
      const code = labelResult(out.stdout);
      ctx.psScript = script;
      return { ok: code === 0, why: code === null ? `no result: ${tail(out.stderr || out.stdout, 300)}` : `SetNamedSecurityInfoW returned ${code}` };
    });
    await say(ctx, 'SEEN', 'lock-reads-powershell', attempt.applied.ok ? attempt.why : `Add-Type or the call failed: ${attempt.why}`, { script: ctx.psScript });
    if (attempt.applied.ok && attempt.held) results.powershell = { held: true, call: `powershell -NoProfile -EncodedCommand <Add-Type of SetNamedSecurityInfoW with SDDL ${NO_READ_UP_SDDL}; the script is in the log>` };
  } else {
    await say(ctx, 'SEEN', 'lock-reads-powershell', `not tried: the language mode is ${mode ?? 'unknown'}, not FullLanguage`);
  }

  // node:ffi
  results.ffi = { held: false, call: null };
  const present = await exec(process.execPath, ['-e', "require('node:ffi')"]);
  if (present.code !== 0) {
    await say(ctx, 'SEEN', 'lock-reads-ffi', `node:ffi is not available in ${process.version}: ${/(\w*Error[^\n]*)/.exec(present.stderr)?.[1] ?? 'refused'}`);
  } else {
    const attempt = await tryLock(ctx, 'ffi', '1', async (dir) => {
      const out = await exec(process.execPath, [path.join(HERE, 'lock-reads-ffi.js'), dir]);
      const parsed = parseTry(out.stdout);
      return { ok: parsed?.ok === true, why: parsed ? `${parsed.step}${parsed.code !== undefined ? ` code ${parsed.code}` : ''} ${parsed.message ?? ''}`.trim() : tail(out.stderr, 300) };
    });
    await say(ctx, 'SEEN', 'lock-reads-ffi', attempt.applied.ok ? attempt.why : `node:ffi loads but the call failed: ${attempt.why}`);
    if (attempt.applied.ok && attempt.held) results.ffi = { held: true, call: `node:ffi dlopen('advapi32.dll') SetNamedSecurityInfoW(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, ..., SACL from SDDL ${NO_READ_UP_SDDL}); see probes/52-low-integrity/lock-reads-ffi.js` };
  }

  const winner = LOCK_ROUTES.find((route) => results[route].held) ?? 'none';
  console.log(`LOCK_READS_ROUTE ${winner}`);
  if (winner !== 'none') console.log(`LOCK_READS_CALL ${results[winner].call}`);
  await appendJsonl(ctx.log, { at: new Date().toISOString(), lockReadsRoute: winner, call: results[winner]?.call ?? null, routes: results });
  ctx.lines.push(`LOCK_READS_ROUTE ${winner}`);
  return winner;
}

async function gitAndNpm(ctx) {
  const wt = ctx.worktree;
  const env = ctx.wtEnv;
  const options = { cwd: wt, env };
  const change = await low(ctx, 'append', [path.join(wt, 'change.txt'), 'a change made from low\n'], options);
  const status = await low(ctx, 'exec', ['git', 'status', '--porcelain'], options);
  await say(ctx, status.ok ? 'PASS' : 'FAIL', 'git-status-low', status.ok ? `git status runs at low (${seconds(status.ms)})` : brief(status));

  const added = await low(ctx, 'exec', ['git', 'add', 'change.txt'], options);
  await say(ctx, added.ok ? 'PASS' : 'FAIL', 'git-add-low', added.ok ? `git add works at low (${seconds(added.ms)})` : `git add failed: ${tail(added.stderr, 300)}`);

  const commit = await low(ctx, 'exec', ['git', '-c', 'user.name=Wheelhouse probe', '-c', 'user.email=probe@wheelhouse.invalid', 'commit', '-q', '-m', 'A commit made from the low process'], options);
  await say(ctx, commit.ok ? 'PASS' : 'FAIL', 'git-commit-low', commit.ok ? `git commit works at low with the folders labelled as the plan says (${seconds(commit.ms)})` : `git commit failed: ${tail(commit.stderr, 400)}`);
  if (change.ok && commit.ok) {
    const log = await exec('git', ['log', '--format=%s', '-1'], { cwd: wt });
    await say(ctx, log.stdout.includes('made from the low process') ? 'PASS' : 'FAIL', 'git-commit-visible-from-medium', `the probe itself reads the new commit: ${tail(log.stdout, 80)}`);
  }
  const hooks = judgeAccess(await low(ctx, 'append', [path.join(ctx.commonDir, 'hooks', 'post-commit'), '#!/bin/sh\n']));
  await say(ctx, hooks === 'refused' ? 'PASS' : 'FAIL', 'git-hooks-still-refused-after-commit', hooks === 'refused' ? 'the common hooks folder is still unwritable after git has run at low' : `hooks folder result: ${hooks}`);

  // npm test, low against normal: twice each; the first warms the caches.
  const timings = [];
  for (const [name, node, cwd] of [['normal', ctx.mediumNode, ctx.repo.dir], ['low', ctx.lowNode, wt], ['normal', ctx.mediumNode, ctx.repo.dir], ['low', ctx.lowNode, wt]]) {
    const result = await through(ctx, node, 'shell', ['npm', 'test'], { cwd, env });
    timings.push({ name, ok: result.ok, ms: result.ms, message: result.ok ? '' : `${brief(result)} ${tail(result.stdout ?? '', 200)}` });
  }
  const lowRuns = timings.filter((t) => t.name === 'low');
  await say(ctx, lowRuns.every((t) => t.ok) ? 'PASS' : 'FAIL', 'npm-test-low', lowRuns.every((t) => t.ok) ? 'npm test passes at low in the labelled worktree with npm\'s cache and TEMP inside it' : lowRuns.find((t) => !t.ok).message);
  await say(ctx, 'SEEN', 'npm-test-time', `normal ${timings.filter((t) => t.name === 'normal').map((t) => seconds(t.ms)).join(', ')}; low ${lowRuns.map((t) => seconds(t.ms)).join(', ')} (first and second run of each; the first warms caches)`, { timings });
}

async function startMedium(ctx) {
  ctx.taskName = ctx.id;
  const out = path.join(ctx.root, 'task-out.txt');
  const cmdFile = path.join(ctx.root, 'task-probe.cmd');
  fs.writeFileSync(cmdFile, `@echo off\r\nwhoami /groups > "${out}"\r\n`);
  const created = await low(ctx, 'exec', ['schtasks', '/create', '/tn', ctx.taskName, '/tr', `"${cmdFile}"`, '/sc', 'once', '/st', '23:59', '/f']);
  const verdict = judgeAccess(created);
  if (verdict === 'refused') {
    await say(ctx, 'PASS', 'low-cannot-schedule-task', 'schtasks /create from the low process was refused');
  } else if (verdict === 'other') {
    await say(ctx, 'SEEN', 'low-cannot-schedule-task', `inconclusive: ${brief(created)}`);
  } else {
    // It could create a task: see whether running it gives a normal-level process (a way out of low).
    const ran = await exec('schtasks', ['/run', '/tn', ctx.taskName]);
    let text = '';
    for (let i = 0; i < 30 && !text; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try { text = fs.readFileSync(out, 'utf8'); } catch { /* not yet */ }
    }
    const level = integrityOf(text);
    await say(ctx, level && level !== 'low' ? 'FAIL' : 'SEEN', 'low-starts-medium-through-task-scheduler', `the low process created a scheduled task, and running it gave a process at ${level ?? `no answer (schtasks /run exit ${ran.code})`}`);
  }
  await say(ctx, 'SEEN', 'low-starts-medium-through-explorer', 'not tried: explorer.exe would open a window; the scheduled-task route above is the one that could start a normal-level process without one');
}

// ------------------------------------------------------------------ cleanup

async function cleanup(ctx) {
  if (ctx.cleaned) return;
  ctx.cleaned = true;
  const problems = [];
  const attempt = async (what, fn) => { try { await fn(); } catch (error) { problems.push(`${what}: ${error.message}`); } };
  if (ctx.runValue) await attempt('registry value', () => exec('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', ctx.runValue, '/f']));
  if (ctx.taskName) await attempt('scheduled task', () => exec('schtasks', ['/delete', '/tn', ctx.taskName, '/f']));
  if (ctx.startupFile) await attempt('startup file', () => fs.rmSync(ctx.startupFile, { force: true }));
  for (const fn of ctx.cleanups) await attempt('scratch repository', fn);
  for (const dir of [ctx.root, ...ctx.extraDirs].filter(Boolean)) {
    await attempt(`folder ${dir}`, async () => {
      assertUnderTmp(dir);
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        if (process.platform === 'win32') await exec('cmd.exe', ['/d', '/c', 'rd', '/s', '/q', dir]);
      }
      if (fs.existsSync(dir)) throw new Error('still there');
    });
  }
  if (problems.length) console.error(`Cleanup left something behind: ${problems.join('; ')}`);
}

// ------------------------------------------------------------------ main

export function parseOptions(argv) {
  const options = { offWindows: false };
  for (const arg of argv) {
    if (arg === '--allow-off-windows') options.offWindows = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (process.platform !== 'win32' && !options.offWindows) {
    console.error('Check 52 runs on Windows only (it tests integrity levels): nothing was done.');
    return 2;
  }
  const ctx = makeContext();
  console.log(`Check 52, the low-integrity runner, on ${process.platform} ${os.release()} with Node.js ${process.version}`);
  const interrupt = () => {
    console.error('\nInterrupted: removing what the probe made first');
    cleanup(ctx).finally(() => process.exit(130));
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), `${ctx.id}-`));
    assertUnderTmp(ctx.root);
    ctx.helper = path.join(ctx.root, 'low-try.js');
    fs.copyFileSync(path.join(HERE, 'low-try.js'), ctx.helper);
    ctx.lowEnv = {};

    const own = await environment(ctx);
    if (own === 'high' || own === 'system') {
      console.error(`This shell is running at ${own} integrity (elevated). Run the probe as a standard user in an ordinary terminal.`);
      return 2;
    }
    const mode = await languageMode(ctx);
    await makeFolders(ctx);
    const lowStarts = await makeLowNode(ctx).catch(async (error) => { await say(ctx, 'FAIL', 'low-node-setup', error.message); return false; });
    if (lowStarts) {
      await labelLowWork(ctx);
      await makeRepository(ctx);
      await worktreeLabelling(ctx);
      await writes(ctx);
      await reads(ctx);
    } else {
      await say(ctx, 'SEEN', 'low-trials-skipped', 'the writes, reads and git trials need a low copy that starts; they were not run');
    }
    // The label route needs only a medium process and the low copy for checking; without the copy it can only report what is available.
    if (lowStarts) {
      await lockReads(ctx, mode);
      await gitAndNpm(ctx);
      await startMedium(ctx);
    } else {
      console.log('LOCK_READS_ROUTE none');
      console.log('SEEN lock-reads: not tried, because there is no low copy to check a label against');
    }
  } finally {
    await cleanup(ctx);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  console.log(`Check 52 on ${process.platform}: ${ctx.counts.PASS} PASS, ${ctx.counts.FAIL} FAIL, ${ctx.counts.SEEN} SEEN`);
  console.log(`Log: ${ctx.log}`);
  return ctx.counts.FAIL ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(`Check 52 on ${process.platform}: FAIL (${error.message})`); process.exitCode = 2; },
  );
}
