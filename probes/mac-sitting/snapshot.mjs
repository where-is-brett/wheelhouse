// probes/mac-sitting/snapshot.mjs
// What a folder holds, path by path, with each file's size and time, read only; and what
// appeared or changed between two such listings.
import fs from 'node:fs';
import path from 'node:path';

export function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      const rel = path.relative(root, full);
      out[rel] = stat.isDirectory() ? 'dir' : `${stat.size} ${stat.mtime.toISOString()}`;
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out;
}

// { added, changed, removed }: paths relative to the root.
export function difference(before, after) {
  const added = Object.keys(after).filter((p) => !(p in before)).sort();
  const removed = Object.keys(before).filter((p) => !(p in after)).sort();
  const changed = Object.keys(after).filter((p) => p in before && before[p] !== after[p] && after[p] !== 'dir').sort();
  return { added, changed, removed };
}
