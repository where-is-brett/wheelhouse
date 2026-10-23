// probes/mac-sitting/ready.mjs
// Run by the agent at the start of the sitting, before the opening card: starts the stand-in
// helper again if it isn't running (a restart of the computer stops it), refreshes the host facts
// (the cache holds for a day), and says whether the project is ready. Changes nothing else.
//
//   node ready.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { BASE, LOGS, MADE, PROJECT, WORKTREE, fromPlugin, useHome } from './layout.mjs';

const made = useHome();
const say = (line) => process.stdout.write(`${line}\n`);
const { helperClient } = await fromPlugin('scripts/host/helper-client.js');
const { stateDir } = await fromPlugin('scripts/lib/paths.js');
const client = helperClient({ address: made.helper.address });
const answers = async () => (await client.health().catch(() => null))?.ok === true;

if (await answers()) {
  say(`helper: answering on ${made.helper.address} (pid ${made.helper.pid})`);
} else {
  fs.rmSync(made.helper.address, { force: true });
  const log = fs.openSync(path.join(LOGS, 'helper.log'), 'a');
  const child = spawn(process.execPath, [path.join(BASE, 'helper.mjs')], { cwd: BASE, detached: true, stdio: ['ignore', log, log], env: { ...process.env, WHEELHOUSE_HOME: made.home } });
  child.unref();
  made.helper.pid = child.pid;
  fs.writeFileSync(MADE, `${JSON.stringify(made, null, 2)}\n`);
  const until = Date.now() + 20000;
  while (!(await answers())) {
    if (Date.now() > until) throw new Error(`The helper didn't answer; see ${path.join(LOGS, 'helper.log')}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  say(`helper: started again, pid ${child.pid}`);
}
const factsFile = path.join(stateDir(PROJECT), '..', 'host-facts.json');
fs.writeFileSync(factsFile, `${JSON.stringify({ at: new Date().toISOString(), facts: { protection: 'on', ci: 'present' } })}\n`);
say('host facts: refreshed');
const head = execFileSync('git', ['-C', WORKTREE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
say(head === made.pluginCommit
  ? `plugin copy: at the worktree's HEAD, ${head.slice(0, 12)}`
  : `plugin copy: at ${made.pluginCommit.slice(0, 12)}, the worktree is now at ${head.slice(0, 12)}; run undo.mjs --really and prepare.mjs again to try the newer commit`);
process.exit(0);
