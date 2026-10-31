// scripts/lib/output-tail.js
import { scanContent, scanText } from '../state/secret-scan.js';

// The end of a command's output, at most `most` characters, with any line that matched the secret scan hidden. The end
// is cut at a line first, so a long line is never scanned whole and a secret is never cut in half.
export function tailOf(text, most) {
  let t = String(text).trim();
  if (t.length > 2 * most) {
    t = t.slice(-2 * most);
    const cut = t.indexOf('\n');
    if (cut >= 0) t = t.slice(cut + 1);
  }
  const lines = t.split(/\r\n|\r|\n/);
  for (const hit of scanText(t)) lines[hit.line - 1] = `[hidden: this line matched ${hit.pattern}]`;
  t = lines.join('\n');
  if (scanContent(t).length > 0) t = '[hidden: the output looked as if it held a secret]';
  return t.length > most ? t.slice(-most) : t;
}
