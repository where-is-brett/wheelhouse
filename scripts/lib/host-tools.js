// scripts/lib/host-tools.js
// Where the helper finds `gh` and `glab`. Setup's step 2 fetches each into Wheelhouse's own tools
// folder (check 38, scripts/setup/tools.js), so it needs no installer and no password, and only
// the helper runs that copy: nothing else needs it on the path. A tool setup did not fetch, such as
// a `gh` the director installed themselves, is run by its bare name, found on the path as before.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';
import { run as realRun } from './run.js';

export const HOST_TOOLS = ['gh', 'glab'];

// Wheelhouse's folder of fetched host tools.
export const toolsDir = () => path.join(wheelhouseHome(), 'tools');

// The folder setup keeps a fetched tool in: <wheelhouseHome()>/tools/<tool>.
export function toolFolder(tool) {
  if (!HOST_TOOLS.includes(tool)) throw new Error(`There is no host tool named ${tool}`);
  return path.join(toolsDir(), tool);
}

// The fetched tool's program: <toolFolder(tool)>/bin/<tool>, with .exe on Windows.
export function fetchedPath(tool, { platform = process.platform } = {}) {
  return path.join(toolFolder(tool), 'bin', `${tool}${platform === 'win32' ? '.exe' : ''}`);
}

// What to run for `gh` or `glab`: the copy in Wheelhouse's tools folder when it is there, else the
// bare name.
export function toolPath(tool, { platform = process.platform } = {}) {
  const fetched = fetchedPath(tool, { platform });
  try {
    if (fs.statSync(fetched).isFile()) return fetched;
  } catch { /* not fetched */ }
  return tool;
}

// Whether a failure is the tool not starting at all, as against a tool that ran and said no. `outcome` is what
// `run` threw (a program that cannot be started: not there, not allowed to run) or what it gave back (a tool
// that starts and prints a policy message, such as "blocked by group policy"). A signed-out tool, a request the
// host refused and a plain success are not start failures: they are the tool working.
const START_CODES = new Set(['ENOENT', 'EACCES', 'EPERM']);
const POLICY = /blocked by (?:group |company |security )?polic|this program is blocked|has been blocked by|blocked by (?:your )?administrator|applocker|software restriction polic/i;
export function startFailure(outcome) {
  if (outcome === null || typeof outcome !== 'object') return false;
  if (outcome instanceof Error) return START_CODES.has(outcome.code);
  if (typeof outcome.code === 'number' && outcome.code !== 0) return POLICY.test(`${outcome.stderr ?? ''}\n${outcome.stdout ?? ''}`);
  return false;
}

// Whether `<tool> version` starts here, within ten seconds: 'works', 'missing' (not found) or 'blocked' (found but
// it won't start: not allowed, a policy message, a failure, or no answer in time). Setup's step 2 and the helper's
// choice of backend read it; it makes no request of the host.
export async function toolState(tool, { run = realRun, platform = process.platform, timeoutMs = 10000 } = {}) {
  if (!HOST_TOOLS.includes(tool)) throw new Error(`There is no host tool named ${tool}`);
  let got;
  try {
    got = await run(toolPath(tool, { platform }), ['version'], { timeoutMs });
  } catch (error) {
    return error?.code === 'ENOENT' ? 'missing' : 'blocked';
  }
  return got?.code === 0 && got.timedOut !== true ? 'works' : 'blocked';
}
