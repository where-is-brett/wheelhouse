// scripts/lineage/provenance-block.js
// The markers of the provenance block, taking the block out of a body and the Claude Code version a transcript names, in a module of their own so what only needs to drop a
// block (scripts/feature/files.js) doesn't load what reads the manifest (scripts/lineage/provenance.js).
export const BEGIN = '<!-- wheelhouse-provenance -->';
export const END = '<!-- /wheelhouse-provenance -->';

export const BLOCK = () => new RegExp(`${BEGIN}[\\s\\S]*?${END}`, 'g');

// `body` with every block, and any marker left on its own, taken out, again and again until
// nothing changes: a marker split around another (`<!-- wheel<!-- /wheelhouse-provenance -->house-provenance -->`)
// is whole once the inner one is gone.
export function removeProvenance(body) {
  let text = typeof body === 'string' ? body : '';
  for (;;) {
    const next = text.replace(BLOCK(), '').replaceAll(BEGIN, '').replaceAll(END, '');
    if (next === text) return text.trimEnd();
    text = next;
  }
}

// Claude Code's version as the newest transcript entry that carries one gives it ('2.1.300'), or
// null when none does or that one can't be read.
export function claudeCodeOf(entries) {
  const list = Array.isArray(entries) ? entries : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const version = list[i]?.version;
    if (typeof version !== 'string') continue;
    const m = /^(\d+)\.(\d+)\.(\d+)(?![0-9])/.exec(version);
    return m ? m.slice(1, 4).join('.') : null;
  }
  return null;
}
