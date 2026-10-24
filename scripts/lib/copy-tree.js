// scripts/lib/copy-tree.js
// Copies a folder and everything in it, with links copied as links (their target text as it is).
// Node's fs.cpSync stops the whole process on Windows when a path holds a letter outside ASCII (an
// accented user name, as in C:\Users\Zoë), so Wheelhouse copies with these plainer calls instead.
import fs from 'node:fs';
import path from 'node:path';

// Copies `from` to `to`. With `overwrite` false, a file or link already at its place in `to` throws
// (EEXIST) rather than being replaced; folders already there are copied into.
export function copyTree(from, to, { overwrite = true } = {}) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    if (fs.lstatSync(to, { throwIfNoEntry: false })) {
      if (!overwrite) throw Object.assign(new Error(`EEXIST: ${to} is already there`), { code: 'EEXIST' });
      fs.rmSync(to, { force: true });
    }
    let type;
    try { type = fs.statSync(from).isDirectory() ? 'dir' : 'file'; } catch { type = 'file'; }
    fs.symlinkSync(fs.readlinkSync(from), to, type);
  } else if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name), { overwrite });
  } else {
    fs.copyFileSync(from, to, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
  }
}
