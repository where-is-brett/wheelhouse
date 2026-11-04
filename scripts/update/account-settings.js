// scripts/update/account-settings.js
// The one line of the account's settings that the update may change (update design, section 6.4, step 2; the director's
// ruling of 4 November 2026). Where `<Claude folder>/settings.json` declares Wheelhouse's catalogue under
// `extraKnownMarketplaces.wheelhouse` at an old `ref`, Claude Code refuses to add the catalogue again at a new tag, so the
// update changes that `ref` and nothing else: the JSON text is edited at that one string, so every other byte stays. It
// refuses, changing nothing, when the source isn't the Wheelhouse repository or the file can't be read. The caller backs the
// file up first and restores it on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { MARKETPLACE, WHEELHOUSE_REPO } from '../lineage/manifest.js';

const NAMED_TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/;
const NOT_WHEELHOUSE = "The account's settings name a catalogue called wheelhouse that is not the Wheelhouse repository, so the update leaves them alone and stops.";
const UNREADABLE = "The account's settings file can't be read, so the update leaves it alone and stops.";
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The string value's span at `keys` in JSON text, found by walking the text as a parser does. Gives { start, end } (quotes
// included) of the last such key, or null. Throws when the text is not JSON.
function spanOf(text, keys) {
  let i = 0;
  const fail = () => { throw new SyntaxError('not JSON'); };
  const space = () => { while (i < text.length && ' \t\r\n'.includes(text[i])) i += 1; };
  const string = () => {
    const start = i;
    if (text[i] !== '"') fail();
    i += 1;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) fail();
    i += 1;
    return { start, end: i, value: JSON.parse(text.slice(start, i)) };
  };
  let found = null;
  const value = (at) => {
    space();
    const c = text[i];
    if (c === '{') {
      i += 1; space();
      if (text[i] === '}') { i += 1; return; }
      for (;;) {
        space();
        const key = string().value;
        space();
        if (text[i] !== ':') fail();
        i += 1;
        const here = at !== null && key === keys[at.length] ? [...at, key] : null;
        if (here !== null && here.length === keys.length) {
          space();
          if (text[i] === '"') found = string(); else value(null);
        } else value(here);
        space();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === '}') { i += 1; return; }
        fail();
      }
    } else if (c === '[') {
      i += 1; space();
      if (text[i] === ']') { i += 1; return; }
      for (;;) {
        value(null); space();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === ']') { i += 1; return; }
        fail();
      }
    } else if (c === '"') string();
    else {
      const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!m) fail();
      i += m[0].length;
    }
  };
  value([]);
  space();
  if (i !== text.length) fail();
  return found === null ? null : { start: found.start, end: found.end };
}

const isWheelhouseSource = (source) => {
  if (!isObject(source)) return false;
  if (source.source === 'github') return source.repo === WHEELHOUSE_REPO;
  if (source.source === 'git' || source.source === 'url') {
    return typeof source.url === 'string' && source.url.replace(/\.git$/, '').toLowerCase() === `https://github.com/${WHEELHOUSE_REPO}`;
  }
  return false;
};

const settingsFile = (claudeHome) => path.join(claudeHome, 'settings.json');

// What the account's settings say about the catalogue: null when they don't declare it (or declare it with no `ref`, so no old
// one), { ref } when they declare it at a ref, { refused } when the update must not touch them.
export function accountCatalogue({ claudeHome, marketplace = MARKETPLACE }) {
  let text;
  try { text = fs.readFileSync(settingsFile(claudeHome), 'utf8'); } catch (error) {
    return error?.code === 'ENOENT' ? null : { refused: UNREADABLE };
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { refused: UNREADABLE }; }
  const known = isObject(parsed) ? parsed.extraKnownMarketplaces : undefined;
  if (!isObject(known) || !Object.hasOwn(known, marketplace)) return null;
  const source = known[marketplace]?.source;
  if (!isWheelhouseSource(source)) return { refused: NOT_WHEELHOUSE };
  if (source.ref === undefined) return null;
  if (typeof source.ref !== 'string') return { refused: NOT_WHEELHOUSE };
  return { ref: source.ref };
}

// Changes `extraKnownMarketplaces.wheelhouse.source.ref` to `tag` in the account's settings, as one edit of the file's text.
// Resolves { ok: true, changed, from? } or { ok: false, why }. The edit is checked by parsing the result: it must be the same
// object with that one string changed, or nothing is written.
export function moveAccountRef({ claudeHome, tag, marketplace = MARKETPLACE }) {
  if (!NAMED_TAG.test(String(tag))) return { ok: false, why: 'the release must be a tag' };
  const found = accountCatalogue({ claudeHome, marketplace });
  if (found === null || found.ref === tag) return { ok: true, changed: false };
  if (found.refused) return { ok: false, why: found.refused };
  const file = settingsFile(claudeHome);
  const text = fs.readFileSync(file, 'utf8');
  let span;
  try { span = spanOf(text, ['extraKnownMarketplaces', marketplace, 'source', 'ref']); } catch { return { ok: false, why: UNREADABLE }; }
  if (span === null) return { ok: false, why: UNREADABLE };
  const edited = `${text.slice(0, span.start)}${JSON.stringify(tag)}${text.slice(span.end)}`;
  const want = JSON.parse(text);
  want.extraKnownMarketplaces[marketplace].source.ref = tag;
  try {
    if (JSON.stringify(JSON.parse(edited)) !== JSON.stringify(want)) return { ok: false, why: UNREADABLE };
  } catch { return { ok: false, why: UNREADABLE }; }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, edited);
  fs.renameSync(temp, file);
  return { ok: true, changed: true, from: found.ref };
}
