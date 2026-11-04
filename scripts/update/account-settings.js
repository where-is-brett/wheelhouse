// scripts/update/account-settings.js
// The one line of the account's settings that the update may change (update design, section 6.4, step 2; the director's
// ruling of 4 November 2026). Where `<Claude folder>/settings.json` declares Wheelhouse's catalogue under
// `extraKnownMarketplaces.wheelhouse` at an old `ref`, Claude Code refuses to add the catalogue again at a new tag, so the
// update changes that `ref` and nothing else: the JSON text is edited at that one string, so every other byte stays. It
// refuses, changing nothing, when the source isn't the Wheelhouse repository or the file can't be read. The caller backs the
// file up first and restores it on any failure.
import fs from 'node:fs';
import crypto from 'node:crypto';
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

// Writes `text` over the file's real target so a symlinked settings file stays a link: the real path is resolved, a temporary
// file with a random name is made beside it (opened exclusively, with the original's mode), then renamed onto the target. A
// failure removes the temporary file.
function writeThrough(file, text) {
  const real = fs.realpathSync(file);
  const mode = fs.statSync(real).mode & 0o7777;
  const temp = path.join(path.dirname(real), `.${path.basename(real)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    const fd = fs.openSync(temp, 'wx', mode);
    try { fs.writeFileSync(fd, text); fs.fchmodSync(fd, mode); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, real);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Sets the ref to `tag` by editing the text at that one string, checking by parsing that nothing else changed. Gives the
// problem, or null when written.
function editRef({ claudeHome, tag, marketplace }) {
  const file = settingsFile(claudeHome);
  const text = fs.readFileSync(file, 'utf8');
  let span;
  try { span = spanOf(text, ['extraKnownMarketplaces', marketplace, 'source', 'ref']); } catch { return UNREADABLE; }
  if (span === null) return UNREADABLE;
  const edited = `${text.slice(0, span.start)}${JSON.stringify(tag)}${text.slice(span.end)}`;
  try {
    const want = JSON.parse(text);
    want.extraKnownMarketplaces[marketplace].source.ref = tag;
    if (JSON.stringify(JSON.parse(edited)) !== JSON.stringify(want)) return UNREADABLE;
    writeThrough(file, edited);
  } catch { return UNREADABLE; }
  return null;
}

// Changes `extraKnownMarketplaces.wheelhouse.source.ref` to `tag` in the account's settings, as one edit of the file's text.
// Resolves { ok: true, changed, from? } or { ok: false, why }.
export function moveAccountRef({ claudeHome, tag, marketplace = MARKETPLACE }) {
  if (!NAMED_TAG.test(String(tag))) return { ok: false, why: 'the release must be a tag' };
  const found = accountCatalogue({ claudeHome, marketplace });
  if (found === null || found.ref === tag) return { ok: true, changed: false };
  if (found.refused) return { ok: false, why: found.refused };
  const problem = editRef({ claudeHome, tag, marketplace });
  return problem === null ? { ok: true, changed: true, from: found.ref } : { ok: false, why: problem };
}

// A put-back: sets the ref back to `from`, but only while it is still `to`, the tag the update wrote. Any other change to the
// file since is kept; a ref someone else changed is left alone. Resolves { ok, line? } with a line only when it was left alone.
export function restoreAccountRef({ claudeHome, from, to, marketplace = MARKETPLACE }) {
  if (!NAMED_TAG.test(String(from)) || !NAMED_TAG.test(String(to))) return { ok: true };
  const found = accountCatalogue({ claudeHome, marketplace });
  if (found === null || found.refused || found.ref === from) return { ok: true };
  if (found.ref !== to) return { ok: true, line: `Your account settings name Wheelhouse at ${found.ref}, changed since the update wrote ${to}, so they were left as they are.` };
  const problem = editRef({ claudeHome, tag: from, marketplace });
  return problem === null ? { ok: true } : { ok: false, line: problem };
}
