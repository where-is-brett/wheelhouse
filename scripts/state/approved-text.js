// scripts/state/approved-text.js
// The text of a document as the director approved it, kept at their click in
// projects/<project>/approved/<hash>.md, next to the project's record. A copy is
// read back only while its bytes still hash to the name it is kept under, so a
// copy that was changed on disk is never handed back as the approved text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { briefHash } from '../feature/files.js';
import { stateDir } from '../lib/paths.js';

export function approvedDir(project) {
  return path.join(stateDir(project), '..', 'approved');
}

const tempName = (file) => `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;

// Keeps `text` under its hash and gives the hash. An existing copy is left alone.
export function keepApprovedText(project, text) {
  const hash = briefHash(text);
  const dir = approvedDir(project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hash}.md`);
  const temp = tempName(file);
  try {
    fs.writeFileSync(temp, text);
    try {
      fs.linkSync(temp, file);
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return hash;
}

// The kept text for `hash`, or null when there is none or it no longer hashes to `hash`.
export function approvedText(project, hash) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null;
  let text;
  try {
    text = fs.readFileSync(path.join(approvedDir(project), `${hash}.md`), 'utf8');
  } catch {
    return null;
  }
  return briefHash(text) === hash ? text : null;
}

// Replaces `file` with `text` whole: a temp file in the same folder, then a rename.
export function installText(file, text) {
  const temp = tempName(file);
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
