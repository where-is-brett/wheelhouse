// probes/12-locked/install.js
// Check 12: puts a test computer-wide settings file in place through the
// operating system's own administrator prompt. Refuses if one is already
// there, so it never overwrites the director's own. Undo with remove.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managedDir } from './paths.js';

const dir = managedDir();
const target = path.join(dir, 'managed-settings.json');
if (fs.existsSync(target)) {
  console.error(`A computer-wide settings file already exists at ${target}. The probe won't touch it.`);
  process.exit(1);
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-stage-'));
const hookSource = fileURLToPath(new URL('./locked-hook.js', import.meta.url));
const hookTarget = path.join(dir, 'locked-hook.js');
fs.copyFileSync(hookSource, path.join(stage, 'locked-hook.js'));
fs.writeFileSync(path.join(stage, 'managed-settings.json'), JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `"${process.execPath}" "${hookTarget}"` }] }],
  },
}, null, 2));

let result;
if (process.platform === 'darwin') {
  const q = (text) => `'${text.replaceAll("'", "'\\''")}'`;
  const shell = `mkdir -p ${q(dir)} && cp ${q(path.join(stage, 'locked-hook.js'))} ${q(path.join(stage, 'managed-settings.json'))} ${q(dir)}`;
  result = spawnSync('osascript', ['-e', 'on run argv', '-e', 'do shell script (item 1 of argv) with administrator privileges', '-e', 'end run', '--', shell], { stdio: 'inherit' });
} else {
  const script = `New-Item -ItemType Directory -Force -Path '${dir}' | Out-Null; Copy-Item -Path '${path.join(stage, '*')}' -Destination '${dir}' -Force`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  result = spawnSync('powershell', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -EncodedCommand ${encoded}'`], { stdio: 'inherit' });
}
fs.rmSync(stage, { recursive: true, force: true });
console.log(fs.existsSync(target) ? `Installed: ${target}` : 'Not installed (cancelled or refused).');
