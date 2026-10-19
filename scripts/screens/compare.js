// scripts/screens/compare.js
// Whether two commits' previews look the same: every listed page, at every size, photographed at
// both commits with equal pixel hashes. Anything missing, failed or different answers false, and so
// does any error: a director's approval only carries over when there is no doubt.
//
// Each commit's pictures are cached in `<dir>/<sha>.json` as { address, shots: { "<page>
// <width>x<height>": hash } }, `address` being the preview they were taken on. An address shown for
// both commits (a branch's, say, which shows whatever is newest) is no one commit's own, so a
// comparison finds both addresses before any picture is taken, and answers false when the head's
// is one the approved commit's pictures came from, or would come from.
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

// A commit's cache file as { address, shots }; with no address, an empty one, when it is missing,
// unreadable, or not that shape (a file from before addresses were kept is no picture).
function readCache(file) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const shots = saved?.shots;
    if (typeof saved?.address !== 'string' || !shots || typeof shots !== 'object' || Array.isArray(shots)) return { address: null, shots: {} };
    return { address: saved.address, shots };
  } catch {
    return { address: null, shots: {} };
  }
}

// Writes the file whole: a temporary file of its own in the same folder, then a rename. The cache
// only saves work, so a write that fails is let go.
function writeCache(file, saved) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(saved, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch {
    /* not cached: the picture is taken again next time */
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch { /* already gone */ }
  }
}

// Keeps one picture's hash under the address it was taken on. A file holding another address's
// pictures is started afresh, so every hash in a file came from its address.
function keepShot(file, address, key, hash) {
  const saved = readCache(file);
  writeCache(file, { address, shots: { ...(saved.address === address ? saved.shots : {}), [key]: hash } });
}

// Whether `page` is a plain path: one leading slash, and no `.` or `..` segment before any query
// or fragment.
export function isPage(page) {
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

// A commit's preview address from `previewUrl`, or null when there is none or the lookup fails.
async function addressOf(previewUrl, sha) {
  try {
    const address = await previewUrl(sha);
    return typeof address === 'string' && address !== '' ? address : null;
  } catch {
    return null;
  }
}

const sizeOk = (size) => Number.isInteger(size?.width) && Number.isInteger(size?.height);

// One picture of `page` at `size` for `sha`: its cached hash when `cached(address)` accepts the
// address the commit's cache file was taken on, or else photographed at `address` with `shoot` and
// kept under it. { ok: true, hash } or { ok: false, why }.
async function pictureOf({ dir, sha, page, size, address, cached, shoot, browser, run, fetch, tmp }) {
  try {
    if (typeof sha !== 'string' || !COMMIT.test(sha)) return { ok: false, why: 'not a commit' };
    if (!isPage(page)) return { ok: false, why: 'not a page' };
    if (!sizeOk(size)) return { ok: false, why: 'not a size' };
    const file = path.join(dir, `${sha.toLowerCase()}.json`);
    const key = `${page} ${size.width}x${size.height}`;
    const saved = readCache(file);
    const hash = saved.shots[key];
    if (saved.address !== null && cached(saved.address) && typeof hash === 'string' && HASH.test(hash)) return { ok: true, hash };

    if (!browser) return { ok: false, why: 'no browser' };
    if (!address) return { ok: false, why: 'no preview' };
    const url = pageAddress(address, page);
    if (!url) return { ok: false, why: 'the page leaves the preview' };
    const shot = await shoot({ browser, url, size, run, fetch, tmp });
    if (!isHash(shot)) return { ok: false, why: shot?.why ?? 'no picture' };
    keepShot(file, address, key, shot.hash);
    return { ok: true, hash: shot.hash };
  } catch (error) {
    return { ok: false, why: error?.message ?? 'failed' };
  }
}

// Whether `before` (the approved commit) and `after` (the head) look the same on every page at
// every size, through the cache in `dir` and the previews `previewUrl(sha)` gives (null for none).
// Both addresses are found first, and before any picture is taken it answers false when the head
// has no preview, or its address is the approved commit's now or the one its cached pictures came
// from. The approved commit's cached pictures count whatever address they came from (they may
// predate its preview being taken down); the head's only from the address it has now.
export async function compareCommits({
  before, after, pages, sizes = SCREEN_SIZES, dir, previewUrl, shoot = shootPage, browser, run, fetch, tmp,
} = {}) {
  try {
    if (typeof before !== 'string' || !COMMIT.test(before) || typeof after !== 'string' || !COMMIT.test(after)) return false;
    if (before.toLowerCase() === after.toLowerCase() || typeof previewUrl !== 'function') return false;
    const now = { before: await addressOf(previewUrl, before), after: await addressOf(previewUrl, after) };
    if (now.after === null) return false;
    const kept = readCache(path.join(dir, `${before.toLowerCase()}.json`)).address;
    if (now.after === now.before || now.after === kept) return false;
    const common = { dir, shoot, browser, run, fetch, tmp };
    const shootAt = (sha, page, size) => (sha === before
      ? pictureOf({ ...common, sha, page, size, address: now.before, cached: (address) => address !== now.after })
      : pictureOf({ ...common, sha, page, size, address: now.after, cached: (address) => address === now.after }));
    return await screenshotsMatch({ before, after, pages, sizes, shootAt });
  } catch {
    return false;
  }
}

// Photographs every page at every size of `sha` on its preview now, into the cache in `dir`,
// skipping pictures already kept from that address, and asking `keepGoing()` before each.
// Resolves with how many pictures were taken and kept; never rejects.
export async function photographCommit({
  sha, pages, sizes = SCREEN_SIZES, dir, previewUrl, shoot = shootPage, browser, run, fetch, tmp, keepGoing = () => true,
} = {}) {
  let taken = 0;
  try {
    if (typeof sha !== 'string' || !COMMIT.test(sha) || !Array.isArray(pages) || !Array.isArray(sizes)) return 0;
    const address = await addressOf(previewUrl, sha);
    if (address === null) return 0;
    const counting = async (options) => {
      const shot = await shoot(options);
      if (isHash(shot)) taken += 1;
      return shot;
    };
    for (const page of pages) {
      for (const size of sizes) {
        if (!keepGoing()) return taken;
        await pictureOf({ dir, sha, page, size, address, cached: (kept) => kept === address, shoot: counting, browser, run, fetch, tmp });
      }
    }
  } catch { /* what was taken is kept */ }
  return taken;
}
