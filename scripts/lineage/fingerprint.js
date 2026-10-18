// scripts/lineage/fingerprint.js
// Fingerprints of upstream folders, the same on macOS and Windows. A file is
// read as text unless its first 8 KB holds a NUL byte; text has CRLF and lone
// CR evened to LF, so a checkout with Windows line endings agrees with one with
// Unix line endings. A link is never followed: it is hashed as the text of its
// target. Paths are relative to the folder, joined with "/" and sorted by code
// point (the byte order of their UTF-8 spelling).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SNIFF_BYTES = 8 * 1024;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function evenLineEndings(buffer) {
  if (buffer.subarray(0, SNIFF_BYTES).includes(0)) return buffer;
  return Buffer.from(buffer.toString('latin1').replace(/\r\n?/g, '\n'), 'latin1');
}

// The hash of what a file or link holds, as it is compared across systems.
function contentHash(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) return sha256(Buffer.from(fs.readlinkSync(file), 'utf8'));
  return sha256(evenLineEndings(fs.readFileSync(file)));
}

// Every file and link under `dir` as relative paths with "/" separators.
function listEntries(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listEntries(dir, relative));
    else found.push(relative);
  }
  return found;
}

function combine(entries) {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  const whole = crypto.createHash('sha256');
  for (const { path: relative, hash } of sorted) whole.update(`${relative}\0${hash}\n`);
  return { hash: whole.digest('hex'), files: sorted.length };
}

// { hash, files } for every file under `dir`.
export function fingerprintTree(dir) {
  return combine(listEntries(dir).map((relative) => ({ path: relative, hash: contentHash(path.join(dir, ...relative.split('/'))) })));
}

// The same for one file, under its own name.
export function fingerprintFile(file) {
  return combine([{ path: path.basename(file), hash: contentHash(file) }]);
}
