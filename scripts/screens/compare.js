// scripts/screens/compare.js
// Whether two commits' previews look the same: every listed page, at every size, photographed at
// both commits with equal pixel hashes. Anything missing, failed or different answers false, and so
// does any error: a director's approval only carries over when there is no doubt.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { SCREEN_SIZES } from '../lib/front-desk.js';
import { shoot as shootPage } from './shoot.js';

const COMMIT = /^[0-9a-f]{7,64}$/i;
const HASH = /^[0-9a-f]{64}$/;
// A page is a path on the preview: one leading slash, no backslash, no spaces or control characters.
const PAGE = /^\/(?![/\\])[^\s\\]*$/;
// A `.` or `..` path segment, plain or percent-encoded, in any case.
const DOTS = /^(?:\.|%2e){1,2}$/i;

const isHash = (shot) => shot?.ok === true && typeof shot.hash === 'string' && HASH.test(shot.hash);

// True only when both commits are named, there are pages and sizes, and for every page at every size
// both commits gave a picture with the same hash. Stops at the first failure or difference.
export async function screenshotsMatch({ before, after, pages, sizes = SCREEN_SIZES, shootAt } = {}) {
  try {
    if (typeof before !== 'string' || !before || typeof after !== 'string' || !after) return false;
    if (!Array.isArray(pages) || pages.length === 0 || !Array.isArray(sizes) || sizes.length === 0) return false;
    if (typeof shootAt !== 'function') return false;
    for (const page of pages) {
      for (const size of sizes) {
        const old = await shootAt(before, page, size);
        if (!isHash(old)) return false;
        const now = await shootAt(after, page, size);
        if (!isHash(now) || now.hash !== old.hash) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

// The cache file's hashes, or none when it is missing, unreadable or not an object.
function readCache(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

// Writes the file whole: a temporary file of its own in the same folder, then a rename. The cache
// only saves work, so a write that fails is let go.
function writeCache(file, hashes) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(hashes, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch {
    /* not cached: the picture is taken again next time */
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch { /* already gone */ }
  }
}

// Whether `page` is a plain path: one leading slash, and no `.` or `..` segment before any query
// or fragment.
function isPage(page) {
  if (typeof page !== 'string' || !PAGE.test(page)) return false;
  return !page.split(/[?#]/, 1)[0].split('/').some((segment) => DOTS.test(segment));
}

// `page` joined onto the preview's address (keeping any path the preview has), or null when the page
// is not a plain path or the result would leave the preview's origin or path.
function pageAddress(preview, page) {
  if (!isPage(page)) return null;
  const base = new URL(preview);
  const root = base.pathname.replace(/\/+$/, '');
  const joined = new URL(`${base.origin}${root}${page}`);
  if (joined.origin !== base.origin) return null;
  return joined.pathname === root || joined.pathname.startsWith(`${root}/`) ? joined.href : null;
}

// A shootAt(sha, page, size) for screenshotsMatch that answers from a cache file per commit under
// `dir` (`<sha>.json`, holding { "<page> <width>x<height>": hash }) and otherwise photographs the
// page on the commit's preview (`previewUrl(sha)`, null when there is none) with `shoot`. Only
// pictures taken are cached, and a picture whose cache can't be written is still answered; a cache
// file that can't be read is a miss.
export function cachedShooter({ dir, previewUrl, shoot = shootPage, browser, run, fetch, tmp } = {}) {
  return async (sha, page, size) => {
    try {
      if (typeof sha !== 'string' || !COMMIT.test(sha)) return { ok: false, why: 'not a commit' };
      if (!isPage(page)) return { ok: false, why: 'not a page' };
      if (!Number.isInteger(size?.width) || !Number.isInteger(size?.height)) return { ok: false, why: 'not a size' };
      const file = path.join(dir, `${sha.toLowerCase()}.json`);
      const key = `${page} ${size.width}x${size.height}`;
      const cached = readCache(file)[key];
      if (typeof cached === 'string' && HASH.test(cached)) return { ok: true, hash: cached };

      if (!browser) return { ok: false, why: 'no browser' };
      const preview = await previewUrl(sha);
      if (!preview) return { ok: false, why: 'no preview' };
      const url = pageAddress(preview, page);
      if (!url) return { ok: false, why: 'the page leaves the preview' };
      const shot = await shoot({ browser, url, size, run, fetch, tmp });
      if (!isHash(shot)) return { ok: false, why: shot?.why ?? 'no picture' };
      writeCache(file, { ...readCache(file), [key]: shot.hash });
      return { ok: true, hash: shot.hash };
    } catch (error) {
      return { ok: false, why: error?.message ?? 'failed' };
    }
  };
}
