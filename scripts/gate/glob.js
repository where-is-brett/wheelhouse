// scripts/gate/glob.js
// The small glob the gate uses to name files. Paths are written with `/`.
//   *   any run of characters within one segment
//   **  any run of whole segments, including none (so `**/X` matches `X`)
//   ?   one character within a segment
// No braces or classes; every other character stands for itself. Case-sensitive unless `ignoreCase` is set.

function segmentPattern(segment, ignoreCase) {
  let source = '';
  for (const ch of segment) {
    if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, ignoreCase ? 'iu' : 'u');
}

function matchSegments(patterns, files, ignoreCase) {
  if (patterns.length === 0) return files.length === 0;
  const [first, ...rest] = patterns;
  if (first === '**') {
    for (let skip = 0; skip <= files.length; skip += 1) {
      if (matchSegments(rest, files.slice(skip), ignoreCase)) return true;
    }
    return false;
  }
  if (files.length === 0) return false;
  return segmentPattern(first, ignoreCase).test(files[0]) && matchSegments(rest, files.slice(1), ignoreCase);
}

export function matchGlob(pattern, file, { ignoreCase = false } = {}) {
  if (typeof pattern !== 'string' || typeof file !== 'string') return false;
  return matchSegments(pattern.split('/'), file.split('/'), ignoreCase);
}
