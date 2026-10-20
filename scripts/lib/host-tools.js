// scripts/lib/host-tools.js
// Where the helper finds `gh` and `glab`. Setup's step 2 fetches each into Wheelhouse's own tools
// folder (check 38, scripts/setup/tools.js), so it needs no installer and no password, and only
// the helper runs that copy: nothing else needs it on the path. A tool setup did not fetch, such as
// a `gh` the director installed themselves, is run by its bare name, found on the path as before.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';

export const HOST_TOOLS = ['gh', 'glab'];

// The folder setup keeps a fetched tool in: <wheelhouseHome()>/tools/<tool>.
// Wheelhouse's folder of fetched host tools.
export const toolsDir = () => path.join(wheelhouseHome(), 'tools');

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
