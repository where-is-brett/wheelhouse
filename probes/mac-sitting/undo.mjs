// probes/mac-sitting/undo.mjs
// Removes everything prepare.mjs and the sitting made. Without --really it only lists what it
// would remove, and removes nothing.
//
//   node undo.mjs                     the list (a dry run)
//   node undo.mjs --really            stops the helper, removes the plugin copies from the scratch
//                                     session's mods folder, and the scratch folder; in real-home
//                                     mode, every path the sitting added under ~/.wheelhouse
//   add --transcripts                 the scratch session's transcripts under ~/.claude/projects too
//                                     (after the note that cites them is written)
//   add --clean-real-home             in scratch-home mode, paths that appeared under ~/.wheelhouse
//                                     during the sitting too (only if the bridge missed the
//                                     project's WHEELHOUSE_HOME); never a path that was there before
//
// Not done here: archiving the scratch session in Claude Desktop (the agent does that with the
// app's own session tools), and the empty folder Claude Code made for that session under
// ~/.claude/dev-mods/ (Claude Code makes one for every session that loads the plugin-authoring
// skill; earlier ones are left empty the same way).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BASE, REAL_BEFORE, REAL_HOME, readMade, transcriptFolder } from './layout.mjs';
import { difference, snapshot } from './snapshot.mjs';

const flags = process.argv.slice(2);
const really = flags.includes('--really');
const made = readMade();
const say = (line) => process.stdout.write(`${line}\n`);
const steps = [];
const step = (what, act) => steps.push({ what, act });

if (made === null) {
  say(`Nothing recorded in ${BASE}/made.json; only the scratch folder itself would go.`);
} else {
  const pid = made.helper?.pid;
  if (Number.isInteger(pid)) {
    let command = '';
    try {
      command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    } catch {
      command = '';
    }
    if (command.includes(made.helper.script)) step(`stop the stand-in helper, pid ${pid} (${command})`, () => process.kill(pid, 'SIGTERM'));
    else say(`the helper (pid ${pid}) isn't running${command === '' ? '' : `; pid ${pid} is now another program, left alone`}`);
  }
  for (const copy of [made.devMods?.plugin, made.devMods?.observer]) {
    if (typeof copy === 'string' && fs.existsSync(copy)) step(`remove ${copy}`, () => fs.rmSync(copy, { recursive: true, force: true }));
  }
  const before = fs.existsSync(REAL_BEFORE) ? JSON.parse(fs.readFileSync(REAL_BEFORE, 'utf8')) : null;
  const real = before === null ? null : difference(before, snapshot(REAL_HOME));
  if (real !== null) {
    const added = real.added.sort((a, b) => b.length - a.length);
    const removeAdded = made.mode === 'real-home' || flags.includes('--clean-real-home');
    if (added.length === 0) say('~/.wheelhouse: nothing added since preparation');
    for (const rel of added) {
      const full = path.join(REAL_HOME, rel);
      if (removeAdded) step(`remove ~/.wheelhouse/${rel}`, () => fs.rmSync(full, { recursive: true, force: true }));
      else say(`~/.wheelhouse/${rel} appeared during the sitting (kept; --clean-real-home removes it)`);
    }
    for (const rel of real.changed) say(`~/.wheelhouse/${rel} changed during the sitting (not put back: it was there before)`);
  }
  if (flags.includes('--transcripts')) {
    const dir = transcriptFolder(made.folder);
    if (fs.existsSync(dir)) step(`remove the scratch session's transcripts, ${dir}`, () => fs.rmSync(dir, { recursive: true, force: true }));
  } else {
    const dir = transcriptFolder(made.folder);
    if (fs.existsSync(dir)) say(`kept: ${dir} (--transcripts removes it)`);
  }
}
step(`remove the scratch folder ${BASE} (plugin copy, home, project, stand-in host, logs, these scripts)`, () => fs.rmSync(BASE, { recursive: true, force: true }));

for (const { what, act } of steps) {
  say(`${really ? 'doing' : 'would'}: ${what}`);
  if (really) act();
}
if (!really) say('(a dry run: nothing was removed; run with --really to remove it)');
