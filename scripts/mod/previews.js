// scripts/mod/previews.js
// The preview address of an open pull request's head, for the pane's Show me link. It is kept as
// projects/<project>/previews.json, keyed by pull request and commit, for ten minutes, and an
// answer of none is kept too, so a pull request with no preview isn't asked about on every tick.
// The helper is asked at most once a tick, within a limit of 1.5 seconds (`/pr/preview` is
// read-only, so it is answered under STOP); a call that is slow or fails counts as none until the
// next tick and is not kept. Only an `https:` address is kept: anything else is none.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

// How long an answer is kept, and how long the helper is waited for.
export const PREVIEW_KEPT_MS = 10 * 60 * 1000;
export const PREVIEW_WAIT_MS = 1500;

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// projects/<project>/previews.json; stateDir refuses a name that is not a folder name.
export function previewsFile(project) {
  return path.join(stateDir(project), '..', 'previews.json');
}

// The address when it is an https: address, else null.
function secure(address) {
  try {
    return typeof address === 'string' && new URL(address).protocol === 'https:' ? address : null;
  } catch {
    return null;
  }
}

function readKept(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(previewsFile(project), 'utf8'));
    return isRecord(kept) ? kept : {};
  } catch {
    return {};
  }
}

// Keeps the answers still in date, written whole through a temporary file.
function writeKept(project, kept, nowMs) {
  const fresh = Object.fromEntries(Object.entries(kept).filter(([, e]) => isRecord(e) && nowMs - Date.parse(e.at) < PREVIEW_KEPT_MS));
  const file = previewsFile(project);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(fresh)}\n`);
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true });
  }
}

// previewFor({ project, pr, sha, client, now, tick }) -> Promise<string | null>. `client` is the
// helper's client (its `preview`); with none, only what is kept is read. `tick` is one object per
// tick ({ asked: false }): once it has asked the helper it asks no more, so a tick makes at most
// one call. Never throws.
export async function previewFor({ project, pr, sha, client, now = () => new Date(), tick = { asked: false } } = {}) {
  try {
    const nowMs = new Date(typeof now === 'function' ? now() : now).getTime();
    if (!Number.isInteger(pr) || pr < 1 || typeof sha !== 'string' || sha === '' || Number.isNaN(nowMs)) return null;
    const key = `${pr}:${sha}`;
    const kept = readKept(project);
    const held = kept[key];
    if (isRecord(held) && Number.isFinite(Date.parse(held.at)) && nowMs - Date.parse(held.at) < PREVIEW_KEPT_MS && nowMs >= Date.parse(held.at)) {
      return secure(held.url);
    }
    if (typeof client?.preview !== 'function' || tick.asked === true) return null;
    tick.asked = true;
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), PREVIEW_WAIT_MS); });
    let got;
    try {
      got = await Promise.race([Promise.resolve().then(() => client.preview({ project, number: pr })).catch(() => null), late]);
    } finally {
      clearTimeout(timer);
    }
    if (!isRecord(got) || got.ok !== true) return null;
    const url = secure(got.url);
    writeKept(project, { ...kept, [key]: { url, at: new Date(nowMs).toISOString() } }, nowMs);
    return url;
  } catch {
    return null;
  }
}
