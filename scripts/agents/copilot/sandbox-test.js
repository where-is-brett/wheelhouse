// scripts/agents/copilot/sandbox-test.js
// The sandbox test (design section 6.4, level 1; plan choice 3): a probe session tries each way out, in a scratch home
// that holds the settings, never the clean home, so the test comes before the home has them. Its result is the
// computer's, kept outside any project in `<wheelhouseHome>/agents/copilot-sandbox.json`, with the CLI version and the
// settings' digest it was run for. `run` is always given: nothing here starts `copilot`; the real `run` lives in the
// probe (probes/57-copilot-sandbox/run.js), and only sitting S3 calls it.
import fs from 'node:fs';
import path from 'node:path';
import { COPILOT_VERSION } from '../../lib/copilot-numbers.js';
import { helperAddress, wheelhouseHome } from '../../lib/paths.js';
import { SETTINGS_FILE, RESULT_FILE, sandboxLevel, sandboxSettings, sandboxState, settingsDigest } from '../../../adapters/copilot/sandbox.js';

// The tries, in order. `network` ones are reported, not failed, on Windows, where only programs that honour the proxy
// are held (design section 6.4).
export const TRIES = Object.freeze([
  { name: 'read the keys folder', network: false },
  { name: 'gh auth token', network: false },
  { name: 'git credential fill', network: false },
  { name: 'a token in the environment', network: false },
  { name: 'write outside the working folder', network: false },
  { name: 'reach an unlisted host', network: true },
  { name: 'reach the local network other than the helper', network: true },
  { name: 'a tool call the guard must refuse', network: false },
]);

export const resultFile = () => path.join(wheelhouseHome(), 'agents', RESULT_FILE);

// runSandboxTest({ run, version, settings, home, platform, keep }) -> { passed, version, digest, results }
// `run({ name, home })` tries one way out in the scratch home and answers `{ refused: boolean }`; a try that throws or
// answers anything else counts as let through. `home` is the folder the scratch home is made in (default: the
// Wheelhouse home's `tmp`). The result is written by writeResult, not here.
export async function runSandboxTest({ run, version = COPILOT_VERSION, settings, home, platform = process.platform } = {}) {
  if (typeof run !== 'function') throw new Error('The sandbox test needs a run that tries each way out');
  if (!settings?.sandbox) throw new Error('The sandbox test needs the settings it tests');
  const parent = home ?? path.join(wheelhouseHome(), 'tmp');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const scratch = fs.mkdtempSync(path.join(parent, 'copilot-sandbox-'));
  try {
    fs.writeFileSync(path.join(scratch, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    const results = [];
    for (const attempt of TRIES) {
      let refused = false;
      try {
        refused = (await run({ name: attempt.name, home: scratch }))?.refused === true;
      } catch {
        refused = false;
      }
      results.push({ name: attempt.name, refused, ...(attempt.network && platform === 'win32' ? { reported: true } : {}) });
    }
    const passed = results.every((r) => r.refused || r.reported === true);
    return { passed, version, digest: settingsDigest(settings), results };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// Keeps the computer's result, outside any project.
export function writeResult(result, file = resultFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return file;
}

// The kept result, or null when there is none or it can't be read.
export function readResult(file = resultFile()) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    return kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? kept : null;
  } catch {
    return null;
  }
}

// What the sandbox settings for this computer are now, from the engine's worktree folders, the registered Copilot
// projects' domains and the helper's address.
export function currentSettings({ worktreeBases = [], domains = [], helper = helperAddress(), platform = process.platform } = {}) {
  return sandboxSettings({ worktreeBases, domains, helper, platform });
}

// The sandbox as it stands for this computer: { level, state, settings } where `level` is sandboxLevel's answer for
// the kept result against `settings` and the pinned CLI. Used by the clean home, the level check and the board.
export function sandboxNow({ settingsArgs = {}, result = readResult(), version = COPILOT_VERSION, checked } = {}) {
  const settings = currentSettings(settingsArgs);
  const digest = settingsDigest(settings);
  const args = { result, version, digest, ...(checked === undefined ? {} : { checked }) };
  return { level: sandboxLevel(args), state: sandboxState(args), settings };
}
