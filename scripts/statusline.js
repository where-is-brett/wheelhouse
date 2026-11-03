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
// Read on 4 November 2026 from the same page:
// - `context_window.used_percentage` is the share of the context window in use (input tokens
//   only, 0 to 100), and may be null early in a session. `context_window.context_window_size` is
//   the window in tokens (200000, or 1000000 for models with extended context).
//   `context_window.current_usage` is not used.
//
// The line is the board's glance, then "context 31%" when the input has the share. The context
// part comes from the input alone, so it shows outside a Wheelhouse project too. When a context
// share is the only part, it is the whole line; "Wheelhouse" alone is for when nothing else shows.
//
// Saving soon: the session compacts at COMPACT_PCT_DEFAULT (95) per cent of its compaction
// window unless `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` sets another percentage. The window is
// `autoCompactWindow` (tokens, which Wheelhouse sets to 300,000) when that is smaller than
// `context_window_size`, else the whole window. Both settings are read the way the session reads
// them: the environment first, then this computer's settings for the project, the project's
// settings and the user's own settings. "saving soon" shows once the share is within SOON_POINTS
// of the compaction point (as a share of `context_window_size`). Anything unreadable falls back
// to the defaults.
//
// It exits 0 and prints "Wheelhouse" on any failure, and within LIMIT_MS whatever the disk or
// standard input does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordAllowance } from './usage/store.js';
import { startedAsScript } from './lib/started-as-script.js';

const LIMIT_MS = 450;
const FALLBACK = 'Wheelhouse';
const WINDOWS = ['five_hour', 'seven_day'];
const COMPACT_PCT_DEFAULT = 95;
const SOON_POINTS = 5;

const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

// The compaction settings from one settings file, or {} when it is missing or damaged.
function settingsFrom(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const pct = Number(parsed?.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
    const win = parsed?.autoCompactWindow;
    return {
      pct: Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : undefined,
      window: typeof win === 'number' && Number.isFinite(win) && win > 0 ? win : undefined,
    };
  } catch {
    return {};
  }
}

// The context part ("context 31%", with " · saving soon" near the compaction point), or null
// when the input has no usable share.
export function contextPart(input, { env = process.env, folder = null, claudeHome = null } = {}) {
  const used = input?.context_window?.used_percentage;
  if (!isFraction(used)) return null;
  const part = `context ${Math.round(used)}%`;
  try {
    const size = input.context_window.context_window_size;
    const home = claudeHome ?? env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
    const files = [
      ...(folder ? [path.join(folder, '.claude', 'settings.local.json'), path.join(folder, '.claude', 'settings.json')] : []),
      path.join(home, 'settings.json'),
    ].map(settingsFrom);
    const fromEnv = Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
    const pct = (Number.isFinite(fromEnv) && fromEnv > 0 && fromEnv <= 100 ? fromEnv : undefined) ?? files.find((f) => f.pct)?.pct ?? COMPACT_PCT_DEFAULT;
    const window = files.find((f) => f.window)?.window;
    const share = typeof size === 'number' && size > 0 && window !== undefined ? Math.min(window, size) / size : 1;
    const point = pct * share;
    return used >= point - SOON_POINTS ? `${part} · saving soon` : part;
  } catch {
    return part;
  }
}

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
  const folder = typeof input?.workspace?.current_dir === 'string' ? input.workspace.current_dir : null;
  let glance = FALLBACK;
  try {
    glance = await lineFor(folder, now);
  } catch {
    // The glance is lost; the context part may still show.
  }
  let context = null;
  try {
    context = contextPart(input, { folder });
  } catch {
    // No context part.
  }
  if (context === null) return glance;
  return glance === FALLBACK ? context : `${glance} · ${context}`;
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

if (startedAsScript(import.meta.url)) main();
