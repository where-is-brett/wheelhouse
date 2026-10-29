// scripts/feature/approved.js
// The approved document in a feature's worktree (build-loop design, section 13: the feature
// lane's "what was asked for" is the design document). The front desk writes a work's document
// into the main checkout's git-ignored .wheelhouse/, so it never reaches a worktree by git: the
// foreman's start copies it into the worktree's feature folder, and the watcher copies it before
// a wake of a feature started without it. It is copied only when it is the one approved: its
// hash is the approval's, or for work that starts with no approval, the one its work event
// recorded (ruling R97).
import path from 'node:path';
import { FEATURE_DIR, briefHash, featurePaths } from './files.js';
import { readCapped, safeFeatureFolder, writeWhole } from './status.js';

// The copy's name in the feature folder, and its path from the worktree's root as the brief names it.
export const APPROVED_FILE = 'approved.md';
export const APPROVED_PATH = `${FEATURE_DIR}/${APPROVED_FILE}`;
const DOCUMENT_BYTES = 1024 * 1024;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function approvedPath(worktree) {
  return path.join(featurePaths(worktree).dir, APPROVED_FILE);
}

// The approved document of `work` in `views`: `{ text, hash }` when the file in the main checkout
// `checkout` is the one approved, `{ problem }` when the work names one that isn't (changed since,
// gone, or outside the checkout), and null when the work names no document.
export function approvedDocument({ checkout, views, work }) {
  const entry = views?.work?.[work];
  const doc = entry?.work?.data?.doc;
  if (!isPlain(doc) || typeof doc.path !== 'string' || doc.path.trim() === '') return null;
  const root = path.resolve(checkout);
  const full = path.resolve(root, doc.path);
  if (full !== root && !full.startsWith(root + path.sep)) return { problem: 'is outside the main checkout' };
  const approved = typeof entry.approval?.hash === 'string' ? entry.approval.hash : doc.hash;
  const text = readCapped(full, DOCUMENT_BYTES);
  if (text === null) return { problem: "can't be read" };
  const hash = briefHash(text);
  if (hash !== approved) return { problem: 'is not the one approved: it has changed since' };
  return { text, hash };
}

// Writes `text` as the worktree's approved document when the copy there differs or is missing.
// Returns whether it was written. Throws when the feature folder isn't a real folder inside the
// worktree, so nothing lands anywhere else.
export function placeApproved(worktree, text) {
  if (!safeFeatureFolder(worktree)) throw new Error("The worktree's feature folder isn't a real folder inside it");
  const file = approvedPath(worktree);
  if (readCapped(file, DOCUMENT_BYTES) === text) return false;
  writeWhole(file, text);
  return true;
}
