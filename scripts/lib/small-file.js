// scripts/lib/small-file.js
// Reading a small file in a folder an agent controls, safely: what the hooks (scripts/hooks/kit.js
// re-exports it) and the setup engine read Claude Code's project settings with.
import fs from 'node:fs';

// A small regular file's text, or null. The file is opened without waiting (O_NONBLOCK where
// the platform has it; Windows has no FIFOs and no such flag) and read only when it is a
// regular file of at most `max` bytes, so a FIFO, a device or a huge file planted in a folder
// an agent controls can't hang or swamp a hook.
const NONBLOCK = fs.constants.O_NONBLOCK ?? 0;
export const SMALL_FILE_BYTES = 64 * 1024;
export function readSmallText(file, max = SMALL_FILE_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return null;
    const buffer = Buffer.alloc(stat.size);
    let got = 0;
    while (got < stat.size) {
      const n = fs.readSync(fd, buffer, got, stat.size - got, got);
      if (n === 0) break;
      got += n;
    }
    return buffer.subarray(0, got).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}
