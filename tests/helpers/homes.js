// tests/helpers/homes.js
// A test file run by hand (`node --test <file>`) gets a temporary home too, as under `npm test`.
import './test-home.js';
import { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { helperAddress } from '../../scripts/lib/paths.js';
import { removeFolder } from './remove.js';

// Temporary folders made through tempFolder, removed once the test file's tests are done.
const made = [];
after(() => {
  for (const dir of made.splice(0)) removeFolder(dir);
});

// A new temporary folder whose name starts with `prefix`, removed after the file's tests.
export function tempFolder(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// A short temporary home, so a socket inside it stays within the Unix path limit on macOS.
export function shortHome() {
  return tempFolder('wh-');
}

// A helper address for a test: the home's own, as code run with that home reaches it: a socket in
// the home, or on Windows that home's pipe, never the real user's.
export function testAddress(home) {
  return helperAddress({ home });
}

// Runs fn with WHEELHOUSE_HOME set to `home`, putting the old value back afterwards.
export async function as(home, fn) {
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
}

// Runs fn(home) with WHEELHOUSE_HOME set to a new, empty home inside a temporary folder, for
// synchronous or asynchronous work. The old value is put back and the temporary folder is
// removed afterwards, even when fn throws.
export function withHome(fn, { prefix = 'wh-home-' } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(parent, 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  const finish = () => {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    removeFolder(parent);
  };
  let result;
  try {
    result = fn(home);
  } catch (error) {
    finish();
    throw error;
  }
  if (result && typeof result.then === 'function') return result.finally(finish);
  finish();
  return result;
}

// Runs fn with CLAUDE_CONFIG_DIR set to a new Claude Code folder whose list of installed plugins
// names stand-in folders for Superpowers and Matt Pocock's skills, so a scenario's variants load
// those and never the computer's own installs (a CI runner has none). The old value is put back
// afterwards.
export async function withStandInPlugins(fn) {
  const config = tempFolder('wh-claude-config-');
  const plugins = {};
  for (const [name, id] of [['superpowers', 'superpowers@claude-plugins-official'], ['mattpocock-skills', 'mattpocock-skills@market']]) {
    const installed = path.join(config, 'plugins', 'cache', name);
    fs.mkdirSync(path.join(installed, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(installed, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
    plugins[id] = [{ scope: 'user', installPath: installed }];
  }
  fs.writeFileSync(path.join(config, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
  }
}
