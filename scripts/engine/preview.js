// scripts/engine/preview.js
// The pack's preview step (Archon design, section 9.1), after review and before any approval. It asks the helper, by
// the run's id, whether the work is visible, its pages and the host's preview of the head. It uses the host's preview
// where there is one, else starts the project's own preview command (`preview` in .claude/wheelhouse.json) in the
// worktree, as the step's other commands run. It photographs the order's pages and up to five the change touches, at
// desktop and phone sizes, in a hidden Chrome with a fresh profile, writes the pictures and notes to the run's
// artefacts, and asks the helper to keep them. A change with nothing to look at gets a one-line before-and-after
// summary instead. It prints { folder, pictures, summary } for the pack.
//   node scripts/engine/preview.js --run <run id> --base <ref> --out <folder>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { run as runProgram } from '../lib/run.js';
import { SCREEN_SIZES, SCREEN_TIMEOUT_MS } from '../lib/front-desk.js';
import { runBrowser, removeProfile, findBrowser } from '../screens/shoot.js';
import { publicHttps, isPage } from '../screens/pages.js';
import { readConfig } from '../gate/guardrails.js';
import { runArg } from './done-check.js';
import { changeOf } from './change.js';
import { MOST_TOUCHED, pictureName } from './preview-names.js';

export { MOST_TOUCHED, pictureName } from './preview-names.js';
// How long the project's preview command has to print its ready line.
const READY_MS = 2 * 60 * 1000;
// What Chrome's headless mode writes to stderr when the page failed to load or timed out.
const LOAD_FAILED = /Page load (failed|timed out)/;

// Folders whose files are pages, and the file kinds that are.
const PAGE_ROOTS = [/^(?:src\/)?(?:app|pages|routes)\//, /^public\//];
const PAGE_FILE = /\.(html?|jsx?|tsx?|vue|svelte|astro|mdx?)$/;
// Files that stand for their folder's page: index files, and the app and SvelteKit routers' page files.
const FOLDER_PAGE = /^(index|page|\+page)$/;

// The pages a change touches, from the paths of its routes and templates, in the change's order. A dynamic route
// ([id], :id) has no one page to show, and a page the change takes away has nothing to show.
export function touchedPages(changes) {
  const pages = [];
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change?.status === 'D' || typeof change?.path !== 'string') continue;
    const file = change.path.replace(/\\/g, '/');
    const root = PAGE_ROOTS.map((r) => r.exec(file)).find(Boolean);
    if (!root || !PAGE_FILE.test(file)) continue;
    const parts = file.slice(root[0].length).replace(PAGE_FILE, '').split('/');
    if (FOLDER_PAGE.test(parts.at(-1))) parts.pop();
    // App-router groups, (marketing), are no part of the address.
    const segments = parts.filter((p) => !/^\(.*\)$/.test(p));
    if (segments.some((p) => /[[\]:]/.test(p) || p.startsWith('_'))) continue;
    const page = `/${segments.join('/')}`;
    if (isPage(page) && !pages.includes(page)) pages.push(page);
  }
  return pages;
}

// The project's own preview, on this computer.
export const localAddress = (port) => `http://127.0.0.1:${port}`;

// Photographs `url` at `size` into `out` with Chrome, in a fresh profile removed afterwards. Gives { ok } or
// { ok: false, why }. Only the host's preview (an https address on a public host) or the project's own preview on
// this computer, at `local`, is opened.
export async function takePicture({ browser, url, size, out, local = null, run = runProgram, tmp = os.tmpdir(), timeoutMs = SCREEN_TIMEOUT_MS }) {
  const allowed = publicHttps(url) !== null || (typeof local === 'string' && url.startsWith(`${local}/`));
  if (!allowed) return { ok: false, why: 'not the preview\'s address' };
  let profile;
  try {
    profile = await fs.promises.mkdtemp(path.join(tmp, 'wh-preview-'));
    const result = await runBrowser({ browser, url, size, profile, out, run, timeoutMs });
    if (LOAD_FAILED.test(result.stderr ?? '')) return { ok: false, why: 'the browser says the page did not load' };
    if (result.stopped && result.hash) return { ok: true };
    if (result.timedOut) return { ok: false, why: 'the browser timed out' };
    if (result.code !== 0 || !fs.existsSync(out)) return { ok: false, why: `the browser exited with ${result.code}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, why: `the browser did not run: ${error.message}` };
  } finally {
    if (profile) await removeProfile(profile);
  }
}

// Ends a started command and everything it started: its process group on macOS and Linux, its tree on Windows.
function endTree(child, platform) {
  if (!Number.isInteger(child.pid)) return;
  try {
    if (platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* already ended */ }
}

// Starts the project's preview command in `cwd` and waits for its ready line. Gives { ok, stop() } or
// { ok: false, why }.
export function startCommand({ preview, cwd, platform = process.platform, readyMs = READY_MS }) {
  return new Promise((resolve) => {
    const shell = platform === 'win32'
      ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', preview.command], windowsVerbatimArguments: true }
      : { file: '/bin/sh', args: ['-c', preview.command] };
    let child;
    try {
      child = spawn(shell.file, shell.args, { cwd, detached: platform !== 'win32', windowsHide: true, windowsVerbatimArguments: shell.windowsVerbatimArguments, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, why: `the preview command could not be started: ${error.message}` });
      return;
    }
    let settled = false;
    let seen = '';
    const stop = async () => endTree(child, platform);
    const settle = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!answer.ok) endTree(child, platform);
      resolve(answer);
    };
    const timer = setTimeout(() => settle({ ok: false, why: `the preview command didn't say "${preview.ready}" within ${readyMs / 60000} minutes` }), readyMs);
    const read = (chunk) => {
      seen = (seen + chunk.toString('utf8')).slice(-8192);
      if (seen.includes(preview.ready)) settle({ ok: true, stop });
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => settle({ ok: false, why: `the preview command could not be started: ${error.message}` }));
    child.on('exit', (code) => settle({ ok: false, why: `the preview command ended with ${code} before it was ready` }));
  });
}

// The project's configuration in the worktree, or {} when it has none or it can't be read.
function configIn(cwd) {
  try {
    const file = path.join(cwd, '.claude', 'wheelhouse.json');
    return readConfig(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  } catch {
    return {};
  }
}

// The change in one line: what it was before and after, and which files changed.
function changeLine(base, head, changed) {
  const files = changed.map((c) => c.path);
  const named = files.length === 0 ? 'no files changed' : `${files.length} ${files.length === 1 ? 'file' : 'files'} changed (${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''})`;
  return `Before ${base ?? 'the default branch'}, after ${String(head).slice(0, 7)}: ${named}.`;
}

// Makes the run's preview into `out` and has the helper keep it. Gives { folder, pictures, summary }, where `summary`
// is the one line shown when there are no pictures (empty when there are). Throws on a refusal from the helper.
export async function makePreview({
  runId, out, cwd = process.cwd(), base = null, client, browser = findBrowser(), sizes = SCREEN_SIZES,
  picture = takePicture, startCommand: start = startCommand, config = configIn, changes = () => changeOf({ cwd, base }),
}) {
  const found = await client.engine.previewFind({ runId });
  if (found?.ok !== true) throw new Error(found?.refused ?? 'the helper didn\'t answer');
  // A folder left from before (an earlier round, or anything a step wrote there) is moved aside, never mixed in.
  if (fs.existsSync(out)) fs.renameSync(out, `${out}.${Date.now()}.before`);
  fs.mkdirSync(out, { recursive: true });
  let changed = [];
  try { changed = await changes(); } catch { changed = []; }
  const line = changeLine(base, found.head, changed);
  const pages = [...found.pages];
  for (const page of touchedPages(changed).slice(0, MOST_TOUCHED)) if (!pages.includes(page)) pages.push(page);

  let address = found.visible ? publicHttps(found.url ?? '') : null;
  let local = null;
  let started = null;
  let reason = null;
  const preview = found.visible && address === null ? config(cwd)?.preview : undefined;
  if (!found.visible) reason = 'Nothing to look at: the change isn\'t visible.';
  else if (!browser) reason = 'No pictures: there\'s no Chrome on this computer to take them.';
  else if (address === null && !preview) reason = 'No preview to look at: the host has none and the project has no preview command.';
  else if (address === null) {
    started = await start({ preview, cwd });
    if (started?.ok) {
      local = localAddress(preview.port);
      address = local;
    } else {
      reason = `No preview to look at: ${started?.why ?? 'the preview command didn\'t start'}.`;
      started = null;
    }
  }

  let pictures = 0;
  const taken = [];
  const missed = [];
  try {
    if (reason === null) {
      for (const page of pages) {
        for (const size of sizes) {
          const shot = await picture({ browser, url: `${address.replace(/\/$/, '')}${page}`, size, out: path.join(out, pictureName(page, size)), local });
          if (shot?.ok) {
            pictures += 1;
            taken.push(pictureName(page, size));
          }
          else missed.push({ page, size: `${size.width}x${size.height}`, why: shot?.why ?? 'no picture' });
        }
      }
      if (pictures === 0) reason = 'No pictures: no page of the preview could be photographed.';
    }
  } finally {
    if (started) await started.stop();
  }

  const summary = reason === null ? '' : `${reason} ${line}`;
  fs.writeFileSync(path.join(out, 'notes.json'), `${JSON.stringify({ head: found.head, pages: reason === null ? pages : [], taken, address: local ? 'local' : address ? 'host' : null, missed, summary: summary || null }, null, 2)}\n`);
  if (summary) fs.writeFileSync(path.join(out, 'summary.txt'), `${summary}\n`);
  const kept = await client.engine.preview({ runId });
  if (kept?.ok !== true) throw new Error(kept?.refused ?? 'the helper didn\'t keep the preview');
  return { folder: out, pictures, summary };
}

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 60000 }), out = (line) => process.stdout.write(`${line}\n`), ...rest } = {}) {
  const runId = runArg(argv);
  const folder = runArg(argv, '--out');
  if (!runId || !folder) {
    out('usage: node scripts/engine/preview.js --run <run id> --base <ref> --out <folder>');
    return 2;
  }
  try {
    const made = await makePreview({ runId, out: path.resolve(folder), base: runArg(argv, '--base'), client, ...rest });
    out(JSON.stringify(made));
    return 0;
  } catch (error) {
    out(`The preview wasn't made: ${error.message}`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
