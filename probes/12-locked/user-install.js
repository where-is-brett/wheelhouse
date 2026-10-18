// probes/12-locked/user-install.js
// Check 12 without admin rights: adds the Locked probe's hook to the
// director's user settings, so its behaviour can be seen on a computer where
// the computer-wide file can't be written. This isn't Locked itself, because
// agents can edit user settings. Undo with user-remove.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeLogDir } from '../lib/log.js';

export const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
export const hookTarget = path.join(probeLogDir('12-locked'), 'locked-hook.js');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  const preToolUse = settings.hooks?.PreToolUse ?? [];
  if (JSON.stringify(preToolUse).includes('locked-hook.js')) {
    console.log('Already installed.');
    process.exit(0);
  }
  if (fs.existsSync(settingsFile)) fs.copyFileSync(settingsFile, path.join(path.dirname(hookTarget), 'settings.before.json'));
  fs.copyFileSync(fileURLToPath(new URL('./locked-hook.js', import.meta.url)), hookTarget);
  settings.hooks = {
    ...settings.hooks,
    PreToolUse: [...preToolUse, { matcher: 'Bash', hooks: [{ type: 'command', command: `"${process.execPath}" "${hookTarget}"` }] }],
  };
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Installed in ${settingsFile}`);
}
