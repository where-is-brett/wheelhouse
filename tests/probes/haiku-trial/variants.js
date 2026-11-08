// tests/probes/haiku-trial/variants.js
// Copies of the reference product with one marked line swapped out, so a check can be shown to fail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REFERENCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference-app');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// Copies the reference product to a temp folder and replaces the line marked `// variant: <name>`.
export function makeVariant(name, replacement) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-variant-')), 'app');
  fs.cpSync(REFERENCE, dir, { recursive: true });
  const marker = `// variant: ${name}`;
  for (const file of sources(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((line) => line.includes(marker));
    if (at < 0) continue;
    lines[at] = replacement;
    fs.writeFileSync(file, lines.join('\n'));
    return dir;
  }
  throw new Error(`no line marked ${marker}`);
}

export const VARIANTS = {
  bracket: "  const negative = t.startsWith('-');",
  duplicates: '    const dup = undefined;',
  bom: "  const src = raw.startsWith('\\uFEFF') ? raw.slice(1).replace(/^([^\\r\\n]*\\r?\\n)[^\\r\\n]*\\r?\\n/, '$1') : raw;",
  utc: '  return new Date(Date.parse(parseDate(text)) + 86400000).toISOString().slice(0, 7);',
  'export-hangs': '  const hang = true;',
  labels: '  const importField = \'<input type="file" id="statement" name="statement" accept=".csv" required>\';',
  titles: "  const heading = 'Spending tracker';",
  'export-name': "  const filename = 'export.csv';",
};

export function variant(name) {
  return makeVariant(name, VARIANTS[name]);
}
