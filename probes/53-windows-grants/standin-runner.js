// probes/53-windows-grants/standin-runner.js
// A stand-in for the Guarded runner that Task 6 builds, for check 53's third trial: it takes
// a command line as its arguments, notes in runner-ran.txt (in the folder it was started in)
// which integrity level it runs at, and runs the command in a shell with npm's cache and the
// temporary folders pointed inside that folder. It is not the runner: it refuses nothing.
// Usage: node standin-runner.js <command words...>
// Self-contained on purpose: the probe copies this one file into its scratch folder.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const who = spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true });
const level = /S-1-16-4096(?!\d)/.test(who.stdout ?? '') ? 'low'
  : /S-1-16-8192(?!\d)/.test(who.stdout ?? '') ? 'medium'
    : /S-1-16-12288(?!\d)/.test(who.stdout ?? '') ? 'high' : 'unknown';
const tmp = path.join(cwd, '.tmp');
try { fs.mkdirSync(tmp, { recursive: true }); } catch { /* the run will say so */ }
try { fs.writeFileSync(path.join(cwd, 'runner-ran.txt'), `integrity=${level}\nargs=${process.argv.slice(2).join(' ')}\n`); } catch (error) { console.error(`stand-in runner: ${error.message}`); }
const result = spawnSync(process.argv.slice(2).join(' '), {
  cwd,
  shell: true,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, TEMP: tmp, TMP: tmp, npm_config_cache: path.join(tmp, 'npm-cache'), npm_config_update_notifier: 'false' },
});
process.exitCode = result.status ?? 1;
