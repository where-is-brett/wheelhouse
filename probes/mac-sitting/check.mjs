// probes/mac-sitting/check.mjs
// What the agent reads during the sitting. Every command only reads, except `tick`, which runs
// the bridge as the mod does and then puts the courier's and the pane's files back as they were
// (unless --keep), so a check never counts as a session that ticked; `set-stop`; and
// `courier-watch`, which writes only its own log in the scratch folder.
//
//   node check.mjs tick [--busy] [--keep]  the bridge's answer to a front desk's tick, summarised
//   node check.mjs records [--since ISO]   approvals, confirmations, actions, card answers, settings,
//                                          shown records: each with whether its signature verifies
//   node check.mjs courier                 courier.json: lastWakeAt, what was sent, the sessions
//   node check.mjs courier-watch [--for S] courier.json read every half second for S seconds (300):
//                                          each mark, each mark taken out again (the mod's unsent,
//                                          with the seconds from the mark) and lastWakeAt, printed
//                                          and appended to courier-watch.log
//   node check.mjs unsent                  every mark seen taken out, from courier-watch.log: its
//                                          stamp, the session, and the seconds from mark to unsent
//   node check.mjs stop                    whether STOP is on, since when, set by whom
//   node check.mjs settings                the settings pane's rows (pace among them)
//   node check.mjs usage                   the usage files and allowance.json
//   node check.mjs hold                    whether the lineage hold file is there
//   node check.mjs pending                 records kept in pending/ that the helper hasn't taken
//   node check.mjs real-home               what appeared or changed in ~/.wheelhouse since prepare
//   node check.mjs transcript <id|-> <text>  the scratch session's transcript rows holding <text>
//                                          (- is the session link.mjs linked, as for the next four)
//   node check.mjs calls [pattern] [--since ISO]  tool calls and their results (PushNotification,
//                                          ToolSearch, mcp__ccd_turn__wrap_up, Bash …)
//   node check.mjs refused [--since ISO]   tool results a hook or a safety check refused
//   node check.mjs replies [--since ISO]   the session's text replies; statusOnly marks a reply that
//                                          is only the mod's status-line text
//   node check.mjs users [--since ISO]     the prompts that reached the conversation, with origin
//   node check.mjs last-action             the director's last action the project can see
//   node check.mjs wait record <kind> [--label L] [--since ISO] [--for S]
//   node check.mjs wait row <text> [--since ISO] [--for S]
//   node check.mjs wait stop on|off [--for S]
//                                          waits (default 600 s) until it is there, prints it and
//                                          exits 0; exits 1 if it never came
//   node check.mjs seen                    the briefing's marks: the director's last prompt, the last briefing
//   node check.mjs set-stop                turns STOP on, as the agent (check 33's first step; a write)
//   node check.mjs observer                the observer mod's log, when it was loaded
//   node check.mjs make-hold               a lineage hold and its event, as a session start makes them (a write)
//   node check.mjs received                the mod's `received` lines: origin and via, no text
//   node check.mjs certlines [--since ISO] how many transcript rows carry certificate ERROR lines
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { COURIER_WATCH_LOG, OBSERVER_LOG, OBSERVER_NOTES, PLUGIN, PROJECT, REAL_BEFORE, REAL_HOME, fromPlugin, transcriptFolder, useHome } from './layout.mjs';
import { difference, snapshot } from './snapshot.mjs';
import { undoneIn, watchCourier } from './courier-log.mjs';
import { calls, readRows, refused, replies, users } from './transcript.mjs';
import { lastAction } from './last-action.mjs';

const made = useHome();
const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const print = (value) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

const { stateDir } = await fromPlugin('scripts/lib/paths.js');
const bridgePath = path.join(PLUGIN, 'scripts', 'mod', 'bridge.js');
// The bridge as the mod runs it: one request on standard input, one JSON line back.
function bridge(request) {
  const out = execFileSync(process.execPath, [bridgePath], {
    cwd: made.folder, env: { ...process.env, WHEELHOUSE_HOME: made.home }, input: JSON.stringify(request), encoding: 'utf8', timeout: 60000,
  });
  return JSON.parse(out.trim().split('\n').at(-1));
}
const firstLine = (text) => String(text ?? '').split('\n', 1)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The scratch session's transcript: `-` or nothing is the session link.mjs linked.
const transcriptOf = (session) => {
  const id = session === undefined || session === '-' ? made.devMods?.session : session;
  if (typeof id !== 'string') throw new Error('No session linked yet (link.mjs): give its id');
  return path.join(transcriptFolder(made.folder), `${id}.jsonl`);
};
// The records as `records` prints them.
async function readRecords(since) {
  const { listEvents } = await fromPlugin('scripts/state/events.js');
  const { verify, readEnrolled } = await fromPlugin('scripts/state/signing.js');
  const enrolled = readEnrolled();
  const kinds = ['approval', 'confirmation', 'action', 'card-answer', 'setting', 'shown', 'asked'];
  return listEvents(stateDir(PROJECT), { report: () => {} })
    .filter((e) => kinds.includes(e.kind) && (since === undefined || Date.parse(e.at ?? e.time ?? 0) >= Date.parse(since)))
    .map((e) => ({
      kind: e.kind, at: e.at ?? e.time, signed: e.sig !== undefined, verifies: e.sig === undefined ? null : verify(e, enrolled),
      data: Object.fromEntries(Object.entries(e.data ?? {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 80 ? `${firstLine(v).slice(0, 80)}…` : v])),
    }));
}
// The observer's notes, oldest first: the first sitting's single file, then one file per note.
function readObserver() {
  const lines = fs.existsSync(OBSERVER_LOG) ? fs.readFileSync(OBSERVER_LOG, 'utf8').split('\n').filter(Boolean) : [];
  if (fs.existsSync(OBSERVER_NOTES)) {
    for (const name of fs.readdirSync(OBSERVER_NOTES).filter((n) => n.endsWith('.json')).sort()) {
      lines.push(fs.readFileSync(path.join(OBSERVER_NOTES, name), 'utf8').trim());
    }
  }
  return lines.flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

if (command === 'tick') {
  const { courierFile } = await fromPlugin('scripts/mod/courier.js');
  const { paneStatusFile } = await fromPlugin('scripts/mod/status.js');
  const files = [courierFile(PROJECT), paneStatusFile(PROJECT)];
  const before = files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  const answer = bridge({ cmd: 'tick', session: 'check-41-agent-read', cwd: made.folder, idle: !flag('--busy'), surface: 'desktop' });
  if (!flag('--keep')) files.forEach((f, i) => (before[i] === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, before[i])));
  const pane = answer.pane ?? {};
  print({
    ok: answer.ok, role: answer.role, every: answer.every, glance: answer.glance, status: answer.status, submit: answer.submit ?? null,
    stop: pane.stop, watcher: pane.watcher, missing: pane.missing, health: pane.health,
    cards: (pane.cards ?? []).map((c) => ({ n: c.n, kind: c.kind, id: c.id, asked: c.asked, blocking: c.blocking, first: firstLine(c.text), buttons: (c.buttons ?? []).map((b) => `${b.label} (${b.does}${b.href ? ` -> ${b.href}` : ""})`), note: c.note ?? null })),
    otherKeys: Object.keys(pane).filter((k) => !['cards', 'stop', 'watcher', 'missing', 'health', 'glance'].includes(k)),
  });
} else if (command === 'records') {
  print(await readRecords(option('--since')));
} else if (command === 'courier') {
  const { courierFile } = await fromPlugin('scripts/mod/courier.js');
  print(fs.existsSync(courierFile(PROJECT)) ? JSON.parse(fs.readFileSync(courierFile(PROJECT), 'utf8')) : 'no courier.json yet');
} else if (command === 'stop') {
  const { stopState } = await fromPlugin('scripts/lib/stop.js');
  print(stopState());
} else if (command === 'settings') {
  const rows = bridge({ cmd: 'settings', cwd: made.folder }).rows ?? [];
  print(rows.map((r) => ({ key: r.key, current: r.current, from: r.from, chosen: (r.choices ?? []).filter((c) => c.chosen).map((c) => c.id) })));
} else if (command === 'usage') {
  const { usageDir } = await fromPlugin('scripts/lib/paths.js');
  const dir = usageDir();
  const list = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }) : [];
  const allowance = path.join(dir, 'allowance.json');
  print({ dir, files: list, allowance: fs.existsSync(allowance) ? JSON.parse(fs.readFileSync(allowance, 'utf8')) : null });
} else if (command === 'hold') {
  const { holdFile } = await fromPlugin('scripts/lineage/check.js');
  print({ file: holdFile(PROJECT), held: fs.existsSync(holdFile(PROJECT)) });
} else if (command === 'pending') {
  const { pendingDir } = await fromPlugin('scripts/hooks/pending.js');
  const dir = pendingDir(PROJECT);
  print(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
} else if (command === 'real-home') {
  const before = JSON.parse(fs.readFileSync(REAL_BEFORE, 'utf8'));
  print({ home: REAL_HOME, ...difference(before, snapshot(REAL_HOME)) });
} else if (command === 'transcript') {
  const [session, text] = rest;
  const file = transcriptOf(session);
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(text)).map((l) => {
    try {
      const row = JSON.parse(l);
      return { type: row.type, origin: row.origin ?? row.message?.origin ?? null, operation: row.operation ?? null, at: row.timestamp ?? null };
    } catch {
      return { unreadable: l.slice(0, 80) };
    }
  });
  print({ file, rows });
} else if (command === 'seen') {
  const { readSeen } = await fromPlugin('scripts/briefing/seen.js');
  print(readSeen(PROJECT));
} else if (command === 'set-stop') {
  // The one write here besides tick: check 33's "the agent turns STOP on", as an agent outside
  // the sandbox can, marked as the runbook's (an agent's route to STOP).
  const { setStop, stopState } = await fromPlugin('scripts/lib/stop.js');
  setStop({ by: 'runbook', now: () => new Date() });
  print(stopState());
} else if (command === 'observer') {
  const notes = readObserver();
  print(notes.length === 0 ? 'no observer log' : notes.map((n) => JSON.stringify(n)).join('\n'));
} else if (command === 'courier-watch') {
  const { courierFile } = await fromPlugin('scripts/mod/courier.js');
  const seconds = Number(option('--for') ?? 300);
  const end = Date.now() + seconds * 1000;
  print(`watching ${courierFile(PROJECT)} for ${seconds} s; log ${COURIER_WATCH_LOG}`);
  await watchCourier({ file: courierFile(PROJECT), logFile: COURIER_WATCH_LOG, until: () => Date.now() > end, onChange: (c) => print(JSON.stringify(c)) });
} else if (command === 'unsent') {
  const undone = undoneIn([COURIER_WATCH_LOG]);
  print(undone.length === 0 ? 'no mark seen taken out (courier-watch.log)' : undone.map(({ id, at, by, byWake, seenAt, seconds }) => ({ id, markedAt: at, by, byWake, goneBy: seenAt, seconds })));
} else if (['calls', 'refused', 'replies', 'users'].includes(command)) {
  const since = option('--since');
  const words = rest.filter((w, i) => w !== '--since' && rest[i - 1] !== '--since');
  const rows = readRows(transcriptOf(command === 'calls' ? undefined : words[0]));
  const answer = {
    calls: () => calls(rows, { pattern: new RegExp(words[0] ?? '.'), since }),
    refused: () => refused(rows, { since }),
    replies: () => replies(rows, { since }),
    users: () => users(rows, { since }),
  }[command]();
  print(answer);
} else if (command === 'last-action') {
  const { readSeen } = await fromPlugin('scripts/briefing/seen.js');
  const last = lastAction({ records: await readRecords(), observer: readObserver(), seen: readSeen(PROJECT) });
  print(last === null ? 'no action of the director seen' : { ...last, ago: `${Math.round((Date.now() - Date.parse(last.at)) / 1000)} s` });
} else if (command === 'wait') {
  const [what, value] = rest;
  const since = option('--since');
  const label = option('--label');
  const end = Date.now() + Number(option('--for') ?? 600) * 1000;
  const { stopState } = await fromPlugin('scripts/lib/stop.js');
  const found = {
    record: async () => (await readRecords(since)).find((r) => r.kind === value && (label === undefined || (r.data?.label ?? r.data?.words) === label)),
    row: async () => readRows(transcriptOf())
      .filter((r) => r.type === 'user' && (since === undefined || Date.parse(r.timestamp ?? 0) >= Date.parse(since)) && JSON.stringify(r.message?.content ?? '').includes(value))
      .map((r) => ({ at: r.timestamp, origin: r.origin ?? null }))[0],
    stop: async () => { const s = stopState(); return s.on === (value === 'on') ? s : undefined; },
  }[what];
  if (found === undefined) {
    print('wait record <kind> [--label L] | wait row <text> | wait stop on|off   [--since ISO] [--for S]');
    process.exit(2);
  }
  for (;;) {
    const got = await found();
    if (got !== undefined && got !== false) {
      print(got);
      break;
    }
    if (Date.now() > end) {
      print(`not seen: ${rest.join(' ')}`);
      process.exit(1);
    }
    await sleep(1000);
  }
} else if (command === 'make-hold') {
  // The third sitting's hold trial (fix 3): a hold file and its event, made as a session start makes
  // them, by running the plugin's session-start hook for a stand-in session against the scratch
  // project (the scratch session's own start doesn't run the hook before the mod is loaded). Kits
  // that aren't installed there are what the hold names. A write, inside the scratch home only.
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'hooks', 'session-start.js')], {
    cwd: made.folder, env: { ...process.env, WHEELHOUSE_HOME: made.home, CLAUDE_PLUGIN_ROOT: PLUGIN },
    input: JSON.stringify({ session_id: 'check-sitting-hold', cwd: made.folder, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nonexistent' }), encoding: 'utf8', timeout: 60000,
  });
  const { holdFile } = await fromPlugin('scripts/lineage/check.js');
  print({ held: fs.existsSync(holdFile(PROJECT)), mentionsHold: out.includes('held until a session starts with matching files') });
} else if (command === 'received') {
  // The mod's `received` lines (fix 41-8): origin and via of each message kept out, never its text.
  const { usageDir } = await fromPlugin('scripts/lib/paths.js');
  const dir = path.join(usageDir(), 'mod');
  const lines = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().flatMap((n) => fs.readFileSync(path.join(dir, n), 'utf8').split('\n').filter((l) => l.includes('received')))
    : [];
  print({ dir, count: lines.length, lines: lines.map((l) => { try { return JSON.parse(l); } catch { return l.slice(0, 120); } }) });
} else if (command === 'certlines') {
  // Fix (certificate lines): how many tool results in the scratch session carry Node.js's start-up
  // certificate ERROR lines. Counts rows, never prints their text.
  const file = transcriptOf(option('--session'));
  const since = option('--since');
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('failed to copy trust settings')).filter((l) => {
    if (since === undefined) return true;
    try { return Date.parse(JSON.parse(l).timestamp) >= Date.parse(since); } catch { return true; }
  });
  print({ file, rowsWithCertificateErrors: rows.length });
} else {
  print('Commands: tick, records, courier, courier-watch, unsent, stop, settings, usage, hold, pending, real-home, transcript, calls, refused, replies, users, last-action, wait, seen, set-stop, observer, make-hold, received, certlines');
  process.exit(2);
}
