// tests/helpers/copilot-plugin-stand-in.js
// What Copilot does with a plugin folder, as far as check 56 saw it and no further (no stand-in knows what real Copilot loads,
// so this one fails closed on what check 56 did not try). `install(path, home)` copies the folder into
// `<home>/installed-plugins/<name>/`, the name read from that folder's `plugin.json`. `hookFilesLoaded(installed)` lists every
// file that check 56 showed, or could not rule out, as a source of hooks. `runWithPlugin` is a `run` for the code under test:
// it sends every call through the PATH stand-in (tests/helpers/host-stand-ins.js), which logs it, and on a
// `plugin install <path>` the stand-in took, installs the folder as above.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Copies the plugin folder into the home's installed plugins; returns the installed folder.
export function install(folder, home) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || manifest.name === '') throw new Error(`${folder}/plugin.json names no plugin`);
  const target = path.join(home, 'installed-plugins', manifest.name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(folder, target, { recursive: true });
  return target;
}

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

// The installed folder's files Copilot loads hooks from, or might: the manifest's `hooks` key (as `plugin.json#hooks`),
// `com.github.copilot/hooks/**` (seen running), `hooks/hooks.json` and `hooks.json` at the root (not ruled out in Claude's
// form), and `.github/hooks/**` inside the plugin.
export function hookFilesLoaded(installed) {
  const found = [];
  const manifest = path.join(installed, 'plugin.json');
  if (fs.existsSync(manifest) && Object.hasOwn(JSON.parse(fs.readFileSync(manifest, 'utf8')), 'hooks')) found.push('plugin.json#hooks');
  for (const file of filesUnder(installed)) {
    if (file.startsWith('com.github.copilot/hooks/') || file === 'hooks/hooks.json' || file === 'hooks.json' || file.startsWith('.github/hooks/')) found.push(file);
  }
  return found;
}

// A `run` that starts the program the PATH finds (the stand-in), and installs the folder when it took `copilot plugin install <folder>`.
export function runWithPlugin(home, installed = []) {
  return (file, args = []) => new Promise((resolve) => {
    const child = spawn(file, args, { env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => resolve({ code: 127, stdout, stderr: String(error.message) }));
    child.on('close', (code) => {
      if (code === 0 && file === 'copilot' && args[0] === 'plugin' && args[1] === 'install') installed.push(install(args[2], home));
      resolve({ code, stdout, stderr });
    });
  });
}
