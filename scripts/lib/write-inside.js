// scripts/lib/write-inside.js
// Writes a file under a folder without ever following a link: each folder on the way must be a real one (made when it is
// missing), the file itself may not be a link, and it is opened with O_NOFOLLOW where the system has it. The helper uses it
// for the text it writes into a project's folder, where an agent may have planted a link at a path it can predict.
import fs from 'node:fs';
import path from 'node:path';

const lstatOf = (file) => {
  try { return fs.lstatSync(file); } catch { return null; }
};

// writeInside(root, rel, text) writes `text` at `rel` (slash-separated, relative) under `root`; throws when anything on the
// way is a link or not what it should be.
export function writeInside(root, rel, text) {
  const real = fs.realpathSync.native(root);
  const parts = String(rel).split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`${rel} is not a path inside the folder`);
  let dir = real;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const stat = lstatOf(dir);
    if (stat !== null && !stat.isDirectory()) throw new Error(`${dir} is not a real folder`);
    if (stat === null) fs.mkdirSync(dir);
  }
  const file = path.join(dir, parts.at(-1));
  const stat = lstatOf(file);
  if (stat !== null && !stat.isFile()) throw new Error(`${file} is not a plain file`);
  // A fresh file each time: one that is there is taken away first, and the new one is created exclusively, never truncated,
  // so a folder swapped for a link after the looks above cannot make this open an existing file of someone else's.
  if (stat !== null) fs.unlinkSync(file);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  let ok = false;
  try {
    // What was opened must be the file at the expected path, and each folder on the way must still be a real one there.
    let at = real;
    for (const part of parts.slice(0, -1)) {
      at = path.join(at, part);
      const one = lstatOf(at);
      if (one === null || !one.isDirectory() || fs.realpathSync.native(at) !== at) throw new Error(`${at} is not a real folder`);
    }
    const here = lstatOf(file);
    const opened = fs.fstatSync(fd);
    if (here === null || !here.isFile() || here.ino !== opened.ino || here.dev !== opened.dev) throw new Error(`${file} is not the file that was opened`);
    fs.writeSync(fd, text);
    ok = true;
  } finally {
    fs.closeSync(fd);
    if (!ok) {
      try { fs.unlinkSync(file); } catch { /* nothing of ours is left there */ }
    }
  }
  return file;
}
