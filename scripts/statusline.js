// scripts/statusline.js
// The terminal's status line. Claude Code runs this with its status-line JSON on standard
// input; the script records the account's rate-limit windows and prints one line.
//
// Read on 19 October 2026 from https://code.claude.com/docs/en/statusline:
// - `rate_limits.five_hour` and `rate_limits.seven_day` each hold `used_percentage` (0 to 100)
//   and `resets_at` (Unix epoch seconds).
// - `rate_limits` appears only for claude.ai Pro and Max subscribers, only after the first API
//   response of a session, and each window may be absent on its own. A gateway's `spend_limit`
//   is not an allowance window and is not recorded.
// - `workspace.current_dir` is the folder the session works in.
//
// It exits 0 and prints "Wheelhouse" on any failure, and within LIMIT_MS whatever the disk or
// standard input does.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordAllowance } from './usage/store.js';

const LIMIT_MS = 450;
const FALLBACK = 'Wheelhouse';
const WINDOWS = ['five_hour', 'seven_day'];

// An epoch in seconds (milliseconds if it is that large) as a UTC ISO time, or null.
function isoFromEpoch(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const time = new Date(value < 1e11 ? value * 1000 : value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

// The windows the input names, as the usage store takes them. A window with no usable share
// is left out.
export function windowsFrom(input) {
  const limits = input?.rate_limits;
  if (!limits || typeof limits !== 'object') return [];
  const windows = [];
  for (const kind of WINDOWS) {
    const window = limits[kind];
    if (!window || typeof window.used_percentage !== 'number' || !Number.isFinite(window.used_percentage)
      || window.used_percentage < 0 || window.used_percentage > 100) continue;
    const entry = { kind, percentUsed: window.used_percentage };
    const resetsAt = isoFromEpoch(window.resets_at);
    if (resetsAt) entry.resetsAt = resetsAt;
    windows.push(entry);
  }
  return windows;
}

// The glance for the folder the session works in (`workspace.current_dir`), from files only:
// the board's inputs are read offline, so the helper is never asked. Outside a Wheelhouse
// project the line is the name. The board's scripts are loaded here, not at the top, so a
// failure to load them costs the glance and never the allowance's record.
async function lineFor(folder, now) {
  if (folder === null) return FALLBACK;
  const [{ loadBoardInputs }, { glanceLine }] = await Promise.all([import('./board/inputs.js'), import('./board/render.js')]);
  const inputs = await loadBoardInputs({ cwd: folder, now: () => now, offline: true });
  return inputs?.model ? glanceLine(inputs.model) : FALLBACK;
}

// Records the allowance, then returns the line. Each part fails on its own.
export async function statusLine(raw, now = new Date()) {
  let input = null;
  try {
    input = JSON.parse(raw);
  } catch {
    return FALLBACK;
  }
  try {
    const windows = windowsFrom(input);
    if (windows.length > 0) recordAllowance({ windows, at: now });
  } catch {
    // A slow or unwritable disk costs the record, never the line.
  }
  try {
    const folder = typeof input?.workspace?.current_dir === 'string' ? input.workspace.current_dir : null;
    return await lineFor(folder, now);
  } catch {
    return FALLBACK;
  }
}

function main() {
  let done = false;
  const finish = (line) => {
    if (done) return;
    done = true;
    try {
      fs.writeSync(1, `${line}\n`);
    } catch {
      // Nothing more can be done.
    }
    process.exit(0);
  };
  setTimeout(() => finish(FALLBACK), LIMIT_MS);
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('error', () => finish(FALLBACK));
  process.stdin.on('end', () => {
    statusLine(Buffer.concat(chunks).toString('utf8')).then(finish, () => finish(FALLBACK));
  });
}

let direct = false;
try {
  direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch {
  direct = false;
}
if (direct) main();
