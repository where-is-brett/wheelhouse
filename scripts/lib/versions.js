// scripts/lib/versions.js
// Comparing Wheelhouse versions by semantic versioning precedence. A small file with no imports, so
// the session-start hook can read it without loading anything else.
const SEMVER = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return { nums: match[1].split('.').map(Number), pre: match[2] === undefined ? null : match[2].split('.') };
}

// Semantic versioning precedence of two versions (a leading `v` allowed; build metadata ignored; a
// short version such as 0.2 is read as 0.2.0; a pre-release is below its release): -1, 0 or 1, or
// null when either can't be read.
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i += 1) {
    const p = x.nums[i] ?? 0;
    const q = y.nums[i] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  if (x.pre === null && y.pre === null) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn) return -1;
    if (qn) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
