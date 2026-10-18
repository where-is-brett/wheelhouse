// probes/12-locked/user-remove.js
// Undoes user-install.js: takes the probe's hook out of the director's user
// settings and leaves everything else as it is.
import fs from 'node:fs';
import { settingsFile, hookTarget } from './user-install.js';

if (fs.existsSync(settingsFile)) {
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const kept = (settings.hooks?.PreToolUse ?? []).filter((entry) => !JSON.stringify(entry).includes('locked-hook.js'));
  if (kept.length) settings.hooks.PreToolUse = kept;
  else if (settings.hooks) delete settings.hooks.PreToolUse;
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
}
fs.rmSync(hookTarget, { force: true });
console.log('Removed.');
