// scripts/update/release.js
// Finding a Wheelhouse release for the update: comparing versions, listing the tags in Wheelhouse's
// repository, picking the latest plain release, and reading what a fetched tag says about itself
// (design 2026-11-04-update-command-design.md, sections 5 and 7). Git goes through the fence; the
// repository is public, so no sign-in and no host tool is used.
import os from 'node:os';
import { run as defaultRun } from '../lib/run.js';
import { compareVersions } from '../lib/versions.js';
import { reachFor, safeGit } from '../lib/safe-git.js';
import { RELEASE_FILE, RELEASE_WHY, fetchTag, tagRefFor } from '../lineage/release.js';
import { MANIFEST_PATH, WHEELHOUSE_URL } from '../lineage/manifest.js';

export { compareVersions, fetchTag, tagRefFor };

export const PLUGIN_FILE = '.claude-plugin/plugin.json';
// A plain release tag, never a pre-release.
const PLAIN_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

// The tags of Wheelhouse's repository at `url`, from `git ls-remote --tags`: [{ tag, sha }], the
// commit a tag points at (an annotated tag's peeled commit is preferred over the tag object).
// Throws when the repository can't be read.
export async function listReleases({ run = defaultRun, url = WHEELHOUSE_URL } = {}) {
  const git = safeGit({ run, cwd: os.tmpdir(), reach: reachFor(url), look: 'never', timeoutMs: 120000 });
  const got = await git(['ls-remote', '--tags', '--end-of-options', url], { input: '' });
  if (got.code !== 0) throw new Error("Wheelhouse's list of releases could not be read");
  const tags = new Map();
  for (const line of String(got.stdout ?? '').split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\trefs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (!match) continue;
    const [, sha, tag, peeled] = match;
    if (peeled !== undefined || !tags.has(tag)) tags.set(tag, sha);
  }
  return [...tags].map(([tag, sha]) => ({ tag, sha }));
}

// The highest plain vX.Y.Z of a list, or null. A pre-release (vX.Y.Z-label) and a short tag are skipped.
export function latestRelease(list) {
  let best = null;
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item?.tag !== 'string' || !PLAIN_TAG.test(item.tag)) continue;
    if (best === null || compareVersions(item.tag, best.tag) === 1) best = { tag: item.tag, sha: item.sha };
  }
  return best;
}

// A file of the fetched tag as text, or null when it isn't there.
async function readAtTag(git, tag, file) {
  const got = await git(['cat-file', 'blob', `${tagRefFor(tag)}:${file}`], { input: '' });
  return got.code === 0 ? got.stdout : null;
}

const gitInMirror = (run, mirror) => safeGit({ run, cwd: mirror, look: 'never', timeoutMs: 120000 });

// What a fetched tag is: its plugin.json's version must be the tag less its `v`. `says` is the release
// file's lines for the card (null when there are none), and the floors come from the manifest
// (null when the manifest doesn't name one). `tag` must have been fetched into `mirror` by fetchTag.
// Never throws.
export async function checkTarget({ tag, sha, run = defaultRun, mirror }) {
  const refuse = (why) => ({ ok: false, why, version: null, says: null, nodeFloor: null, claudeFloor: null });
  if (typeof tag !== 'string' || !PLAIN_TAG.test(tag) || !FULL_SHA.test(sha ?? '') || typeof mirror !== 'string') return refuse(RELEASE_WHY.shape);
  try {
    const git = gitInMirror(run, mirror);
    const tagged = await git(['rev-parse', '--verify', '-q', `${tagRefFor(tag)}^{commit}`], { input: '' });
    if (tagged.code !== 0) return refuse(RELEASE_WHY.fetch);
    if (tagged.stdout.trim() !== sha) return refuse(RELEASE_WHY.commit);
    let version = null;
    try { version = JSON.parse(await readAtTag(git, tag, PLUGIN_FILE))?.version ?? null; } catch { /* unreadable */ }
    if (typeof version !== 'string') return refuse(`the release's ${PLUGIN_FILE} can't be read`);
    if (version !== tag.slice(1)) return { ...refuse(`the tag ${tag} holds a plugin that says it is version ${version}`), version };
    let manifest = null;
    try { manifest = JSON.parse(await readAtTag(git, tag, MANIFEST_PATH)); } catch { /* an old release may have none */ }
    let release = null;
    try { release = JSON.parse(await readAtTag(git, tag, RELEASE_FILE)); } catch { /* none */ }
    const says = typeof release?.says === 'string' && release.says.trim() !== ''
      ? release.says.trim()
      : (Array.isArray(release?.says) && release.says.every((l) => typeof l === 'string') && release.says.length > 0 ? release.says.map((l) => l.trim()).filter((l) => l !== '').join('\n') : null);
    const floor = (value) => (typeof value === 'string' ? value : null);
    return {
      ok: true,
      version,
      says: says === '' ? null : says,
      nodeFloor: floor(manifest?.node?.floor),
      claudeFloor: floor(manifest?.claudeCode?.floor),
    };
  } catch {
    return refuse(RELEASE_WHY.fetch);
  }
}

// Every file of the fetched tag's tree as path -> blob hash, for the own-files look. Throws when the
// tag can't be read.
export async function tagTree({ tag, run = defaultRun, mirror }) {
  const git = gitInMirror(run, mirror);
  const got = await git(['ls-tree', '-r', '-z', '--full-tree', tagRefFor(tag)], { input: '' });
  if (got.code !== 0) throw new Error(`the files of ${tag} could not be read`);
  const tree = new Map();
  for (const entry of String(got.stdout).split('\0')) {
    const match = /^\d+ blob ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(entry);
    if (match) tree.set(match[2], match[1]);
  }
  return tree;
}
