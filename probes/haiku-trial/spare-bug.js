// probes/haiku-trial/spare-bug.js
// Plants the spare bug (a month read through a UTC date, so a day late) for piece P5.
import fs from 'node:fs';
import path from 'node:path';

const DATES = path.join('src', 'lib', 'dates.js');
const MONTH_OF = /export function monthOf\([^)]*\) \{[\s\S]*?\n\}\n/;
const REPLACEMENT = `export function monthOf(text) {
  const date = new Date(\`\${parseDate(text)}T00:00:00Z\`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 7);
}
`;

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

export function applySpareBug(dir) {
  const datesFile = path.join(dir, DATES);
  if (!fs.existsSync(datesFile)) return { applied: false, why: 'src/lib/dates.js is missing' };
  const src = path.join(dir, 'src');
  const used = sourceFiles(src).some(
    (file) => file !== datesFile && /\bmonthOf\b/.test(fs.readFileSync(file, 'utf8')),
  );
  if (!used) return { applied: false, why: 'nothing in src/ uses monthOf' };
  const text = fs.readFileSync(datesFile, 'utf8');
  if (!MONTH_OF.test(text)) return { applied: false, why: 'monthOf in src/lib/dates.js has a shape this does not recognise' };
  fs.writeFileSync(datesFile, text.replace(MONTH_OF, () => REPLACEMENT), 'utf8');
  return { applied: true, file: 'src/lib/dates.js' };
}
