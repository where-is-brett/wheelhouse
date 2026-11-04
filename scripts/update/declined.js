// scripts/update/declined.js
// The release the director said "Not now" to, kept in the project's folder under the Wheelhouse
// home, so the board never announces it again and nothing asks about it again
// (design 2026-11-04-update-command-design.md, section 5, "Pinning").
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../lib/paths.js';

const PLAIN_TAG = /^v\d+\.\d+\.\d+$/;

const fileFor = (project) => path.join(stateDir(project), '..', 'declined.json');

// { tag } for the release declined on this project, or null when none is (or the file is damaged).
export function declined(project) {
  try {
    const tag = JSON.parse(fs.readFileSync(fileFor(project), 'utf8'))?.tag;
    return typeof tag === 'string' && PLAIN_TAG.test(tag) ? { tag } : null;
  } catch {
    return null;
  }
}

// Records `tag` as declined on this project, in place of any earlier one. Throws for anything but
// a plain vX.Y.Z tag.
export function decline(project, tag) {
  if (typeof tag !== 'string' || !PLAIN_TAG.test(tag)) throw new Error('Only a plain release tag can be declined');
  const file = fileFor(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ tag })}\n`);
  fs.renameSync(temp, file);
}
