// probes/12-locked/remove.js
// Check 12: removes the probe's computer-wide settings file and hook,
// through the operating system's own administrator prompt.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { managedDir } from './paths.js';

const dir = managedDir();
const files = ['managed-settings.json', 'locked-hook.js'].map((name) => path.join(dir, name));
const settings = files[0];
if (fs.existsSync(settings) && !fs.readFileSync(settings, 'utf8').includes('locked-hook.js')) {
  console.error(`${settings} isn't the probe's file. Leaving it alone.`);
  process.exit(1);
}

if (process.platform === 'darwin') {
  const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  const shell = `rm -f ${files.map(q).join(' ')}`;
  spawnSync('osascript', ['-e', 'on run argv', '-e', 'do shell script (item 1 of argv) with administrator privileges', '-e', 'end run', '--', shell], { stdio: 'inherit' });
} else {
  const script = files.map((file) => `Remove-Item -Force -ErrorAction SilentlyContinue -Path '${file}'`).join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  spawnSync('powershell', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -EncodedCommand ${encoded}'`], { stdio: 'inherit' });
}
const left = files.filter((file) => fs.existsSync(file));
console.log(left.length === 0 ? 'Removed. Nothing of the probe is left.' : `Still there: ${left.join(', ')}`);
