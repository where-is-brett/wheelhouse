// scripts/state/secret-scan.js
// Finds likely secrets in text or files. Returns pattern names and line numbers only, never the matched text.
import fs from 'node:fs';

// Prefix patterns start where no letter or digit comes before, so a key glued
// on after an underscore or other punctuation is still found.
const START = '(?<![A-Za-z0-9])';
const PATTERNS = [
  { name: 'github-token', re: new RegExp(`${START}(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})`) },
  { name: 'gitlab-token', re: new RegExp(`${START}(?:glpat|gloas|gldt|glrt)-[A-Za-z0-9_-]{20,}`) },
  { name: 'anthropic-key', re: new RegExp(`${START}sk-ant-[A-Za-z0-9_-]{20,}`) },
  { name: 'openai-key', re: new RegExp(`${START}sk-(?!ant-)[A-Za-z0-9_-]{32,}`) },
  { name: 'aws-access-key', re: new RegExp(`${START}(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])`) },
  { name: 'slack-token', re: new RegExp(`${START}xox[abprs]-[A-Za-z0-9-]{10,}`) },
  { name: 'stripe-live-key', re: new RegExp(`${START}[sr]k_live_[A-Za-z0-9]{16,}`) },
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'database-url', re: /[a-z+]+:\/\/[^:\s/]+:[^@\s]+@/ },
  { name: 'jwt', re: new RegExp(`${START}eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`) },
];

export function scanText(text) {
  const hits = [];
  String(text).split(/\r\n|\r|\n/).forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) hits.push({ pattern: name, line: i + 1 });
    }
  });
  return hits.sort((a, b) => a.line - b.line || (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0));
}

// The strings inside a JSON value, keys included, decoded. A file holds a
// newline in a string as the two characters \n, which can hide what follows
// from a pattern; the decoded string has the real newline.
function jsonStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => jsonStrings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      jsonStrings(v, out);
    }
  }
  return out;
}

// The pattern names found in a file's text and, when it is JSON, in every
// decoded string inside it. Sorted, each once; never the matched text.
export function scanContent(text) {
  const names = new Set(scanText(text).map((h) => h.pattern));
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch {
    parsed = undefined;
  }
  for (const s of jsonStrings(parsed)) {
    for (const h of scanText(s)) names.add(h.pattern);
  }
  return [...names].sort();
}

export function scanFiles(paths) {
  const hits = [];
  for (const file of paths) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      hits.push({ file, pattern: 'unreadable', line: 0 });
      continue;
    }
    for (const h of scanText(text)) hits.push({ file, ...h });
  }
  return hits;
}
