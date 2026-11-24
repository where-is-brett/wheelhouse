// scripts/lib/setup-title.js
// The prompt-bar title of a session that began as setup. The session start titles it "Wheelhouse · Setup" and keeps a mark here; the
// first message after setup has finished takes the mark away and gives the title the project's own session carries, so the bar
// stops saying Setup. A title the director gave the session is never replaced: only a session the mark was made for is retitled.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
// In the system's temporary folder, not Wheelhouse's home: a mark outlives nothing that matters, and uninstall has nothing of it to remove.
const folder = () => path.join(os.tmpdir(), 'wheelhouse-setup-titles');

// Marks a session as titled Setup.
export function markSetupTitled(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE.test(sessionId)) return false;
  try {
    fs.mkdirSync(folder(), { recursive: true });
    fs.writeFileSync(path.join(folder(), sessionId), '');
    return true;
  } catch {
    return false;
  }
}

// Whether the session was titled Setup; takes the mark away when it was.
export function takeSetupTitled(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE.test(sessionId)) return false;
  const file = path.join(folder(), sessionId);
  try {
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}
