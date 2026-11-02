// vscode/versions.cjs
// Records the versions of VS Code and its Copilot runtime, which update every week and can't be pinned, in the file the
// session start reads (scripts/agents/copilot/versions.js, `versionsFile()`), so every pull request's provenance names
// them (design for other agents, section 8.8). The Copilot Chat add-on's version stands for the runtime. A version that
// can't be read, or doesn't look like one, is left out, never guessed.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,64})?$/;
const COPILOT_CHAT = 'GitHub.copilot-chat';

const versionOf = (value) => (typeof value === 'string' && VERSION.test(value.trim()) ? value.trim() : undefined);

function readNow(vscode) {
  const out = {};
  const code = versionOf(vscode.version) ?? versionOf(vscode.env?.version);
  if (code !== undefined) out.vscode = code;
  let runtime;
  try {
    runtime = versionOf(vscode.extensions?.getExtension(COPILOT_CHAT)?.packageJSON?.version);
  } catch {
    runtime = undefined;
  }
  if (runtime !== undefined) out.runtime = runtime;
  return out;
}

// writeVersions({ vscode, file }) -> Promise<boolean>: true when the file was written, false when it already held the
// same or couldn't be written. The file is replaced whole, so a reader never sees half of it. Never throws.
async function writeVersions({ vscode, file }) {
  try {
    const next = readNow(vscode);
    const text = `${JSON.stringify(next)}\n`;
    try {
      if (fs.readFileSync(file, 'utf8') === text) return false;
    } catch {
      // Not there yet.
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, text);
      fs.renameSync(temp, file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    return true;
  } catch {
    return false;
  }
}

// Writes again whenever the installed add-ons change, as Copilot Chat does when it updates. Returns what to dispose.
function watchVersions({ vscode, file }) {
  return vscode.extensions?.onDidChange?.(() => writeVersions({ vscode, file }));
}

module.exports = { writeVersions, watchVersions, readNow };
