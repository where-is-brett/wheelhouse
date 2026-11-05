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
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const where = fs.realpathSync.native(file);
    if (where !== path.join(real, ...parts)) throw new Error(`${file} does not lie inside ${root}`);
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}
