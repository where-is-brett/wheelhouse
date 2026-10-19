// probes/34-screens/run.js
// Check 34: can the helper photograph a web page with an installed Chrome or Edge, headless, with
// no npm install; do two photographs of the same unchanged page give the same pixels; and how
// long does one take? The probe serves its own test pages from 127.0.0.1 (these are its own static
// pages, not a project's code), photographs each twice at both screen sizes, each run in a fresh
// profile folder under a new scratch folder in the temporary folder, and removes the folder at the
// end. It runs the browser as `shoot` does (`runBrowser`: the arguments of `browserArgs`, and Chrome
// stopped once its picture is whole) and reads the pictures with `pixelHash`, so what it finds is true
// of the real method. Written for Node.js 22 or later, no installs, on macOS and Windows.
//   node run.js [--browser <path>] [--stop-at-picture]
//     --browser           the Chrome or Edge program to use (default: the first one `findBrowser` finds)
//     --stop-at-picture   stop the browser once its picture is whole even where `shoot` would not
//                         (Edge), to see its pictures without waiting for each run's time limit
// Prints a JSON summary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { run } from '../../scripts/lib/run.js';
import { SCREEN_SIZES, SCREEN_TIMEOUT_MS, SCREEN_SETTLE_MS } from '../../scripts/lib/front-desk.js';
import { findBrowser, runBrowser, stopsAtPicture } from '../../scripts/screens/shoot.js';
import { pixelHash } from '../../scripts/screens/png.js';

const SELF = fileURLToPath(import.meta.url);

const page = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>check 34</title>
<style>html,body{margin:0;background:#fff;font:32px sans-serif}.block{width:240px;height:120px;background:#2a6fdb;margin:20px}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

const CONTENT = '<p>Wheelhouse check 34</p><div class="block"></div>';

// The probe's pages, by path. `lateFinal` has the content of `late` from the start.
export const PAGES = {
  still: page(CONTENT),
  clock: page('<p id="t"></p>', 'const t=document.getElementById("t");const tick=()=>{t.textContent=new Date().toISOString()};tick();setInterval(tick,1000)'),
  animation: page('<div id="a" style="position:absolute;left:0;top:200px;width:60px;height:60px;background:#d33"></div>',
    'const a=document.getElementById("a");a.animate([{left:"0px"},{left:"300px"}],{duration:2000,iterations:Infinity,direction:"alternate"})'),
  late: page('', `setTimeout(()=>{document.body.innerHTML=${JSON.stringify(CONTENT)}},1500)`),
  lateFinal: page(CONTENT),
};

// Pages whose answer is the browser's own failure, not a page.
const FAILS = ['failsDrop', 'failsClosed'];

export function startServer() {
  const server = http.createServer((req, res) => {
    const name = req.url.replace(/^\//, '').split('?')[0];
    if (name === 'failsDrop') { req.socket.destroy(); return; }
    if (!Object.hasOwn(PAGES, name)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGES[name]);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// A port nothing listens on: bound, read, and released.
function closedPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// How a run ended: stopped once its picture was whole, timed out, or exited by itself with a code.
const ending = (result) => (result.stopped ? 'stopped' : result.timedOut ? 'timed out' : `exited ${result.code}`);

// One photograph: a fresh profile under `scratch`, timed, with the browser's own words kept short.
async function photograph({ browser, url, size, scratch, stopAtPicture }) {
  const profile = fs.mkdtempSync(path.join(scratch, 'profile-'));
  const out = path.join(profile, 'screen.png');
  const started = performance.now();
  const result = await runBrowser({ browser, url, size, profile, out, stopAtPicture, timeoutMs: SCREEN_TIMEOUT_MS });
  const ms = Math.round(performance.now() - started);
  const entry = { ms, code: result.code, ended: ending(result), saysLoadFailed: /Page load (failed|timed out)/.test(result.stderr) };
  let png = null;
  try { png = fs.readFileSync(out); } catch { /* no picture */ }
  entry.png = png !== null;
  if (png) {
    try { entry.hash = pixelHash(png); } catch (error) { entry.hashError = error.message; }
  }
  if (!entry.png) entry.stderr = result.stderr.trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300);
  // A stopped browser's helpers may still be writing to the profile for a moment; whatever is left
  // goes with the scratch folder at the end.
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10 }); } catch { /* removed at the end */ }
  return entry;
}

// The summary of the runs: `runs[page][size] = [first, second]`, as `photograph` gives them. The
// time limit is checked against the runs that gave a picture: one that gives none runs to the limit.
export function summarise(runs, timeoutMs = SCREEN_TIMEOUT_MS) {
  const pages = {};
  const pictureMs = [];
  for (const [name, sizes] of Object.entries(runs)) {
    pages[name] = {};
    for (const [size, shots] of Object.entries(sizes)) {
      shots.filter((s) => s.png).forEach((s) => pictureMs.push(s.ms));
      const [a, b] = shots;
      pages[name][size] = { hashes: shots.map((s) => s.hash ?? null), matched: Boolean(a.hash && b && b.hash === a.hash), ms: shots.map((s) => s.ms), ended: shots.map((s) => s.ended), pictures: shots.map((s) => s.png), saysLoadFailed: shots.map((s) => s.saysLoadFailed === true) };
    }
  }
  const sizesOf = (name) => Object.keys(runs[name] ?? {});
  const late = sizesOf('late').map((size) => [size, runs.late[size][0].hash, runs.lateFinal?.[size]?.[0]?.hash]);
  return {
    pages,
    lateShowsDrawnContent: late.length > 0 && late.every(([, drawn, final]) => Boolean(drawn) && drawn === final),
    failsGivePicture: Object.fromEntries(FAILS.filter((n) => runs[n]).map((n) => [n, Object.values(runs[n]).some((shots) => shots.some((s) => s.png))])),
    slowestPictureMs: pictureMs.length ? Math.max(...pictureMs) : null,
    timeoutMs,
    slowestFitsTimeout: pictureMs.length ? Math.max(...pictureMs) < timeoutMs : null,
  };
}

function option(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export async function main(args) {
  const browser = option(args, '--browser') ?? findBrowser();
  if (!browser) { console.error('No Chrome or Edge found; name one with --browser <path>.'); process.exitCode = 1; return; }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check34-'));
  const stopAtPicture = args.includes('--stop-at-picture') || stopsAtPicture(browser);
  const report = { node: process.version, platform: process.platform, arch: process.arch, os: os.release(), browser: path.basename(browser), settleMs: SCREEN_SETTLE_MS, sizes: SCREEN_SIZES, stopsAtPicture: stopsAtPicture(browser), stoppedAtPicture: stopAtPicture };
  let failure = null;
  const started = performance.now();
  let served = null;
  try {
    const version = await run(browser, ['--version'], { timeoutMs: SCREEN_TIMEOUT_MS });
    report.browserVersion = version.stdout.trim();
    served = await startServer();
    const closed = await closedPort();
    const address = {
      failsClosed: `http://127.0.0.1:${closed}/`,
    };
    const runs = {};
    for (const name of [...Object.keys(PAGES), ...FAILS]) {
      runs[name] = {};
      const url = address[name] ?? `http://127.0.0.1:${served.port}/${name}`;
      for (const size of SCREEN_SIZES) {
        const shots = [];
        for (let i = 0; i < 2; i++) shots.push(await photograph({ browser, url, size, scratch, stopAtPicture }));
        runs[name][`${size.width}x${size.height}`] = shots;
      }
    }
    Object.assign(report, summarise(runs));
  } catch (error) {
    failure = error;
  } finally {
    if (served) await new Promise((resolve) => { served.server.close(resolve); served.server.closeAllConnections?.(); });
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 10 });
  }
  report.totalMs = Math.round(performance.now() - started);
  report.scratchRemoved = !fs.existsSync(scratch);
  console.log(JSON.stringify(report, null, 2));
  if (failure) { console.error(`Failed: ${failure.message}`); process.exitCode = 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  await main(process.argv.slice(2));
}
