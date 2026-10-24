// tests/diag-windows.test.js
// Temporary: what Windows does with a copy into a folder with a non-ASCII name.
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('diag: cpSync into non-ASCII folders', () => {
  for (const name of ['plain x', 'zoë x']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `wh-diag-${name} `));
    const src = path.join(root, 'src', 'skills', 'one');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'SKILL.md'), 'x\n');
    const dst = path.join(root, 'claude config', 'cache', 'kit');
    let error = null;
    try { fs.cpSync(path.join(root, 'src'), dst, { recursive: true }); } catch (e) { error = String(e); }
    console.error('WH_DIAG cp', JSON.stringify({ name, error, there: fs.existsSync(path.join(dst, 'skills', 'one', 'SKILL.md')), list: fs.existsSync(dst) ? fs.readdirSync(dst, { recursive: true }) : null }));
  }
});
