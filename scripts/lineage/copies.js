// scripts/lineage/copies.js
// The skill copies in Wheelhouse's own plugin that the build steps use (Archon design, section 7.1): each is a folder
// under skills/ with a SOURCE.md naming its upstream, the version and commit it was taken at, and a fingerprint of
// each source file. The copies are adapted, so an upgrade never writes them: it lists the copies whose sources
// changed (changedCopies), for the changes to be carried over by hand and the counted evaluation to run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintFile } from './fingerprint.js';

const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The skill's description from its front matter, without quotes.
function descriptionOf(text) {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
  const line = /^description:\s*(.*)$/m.exec(front)?.[1]?.trim() ?? '';
  return line.replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
}

// One SOURCE.md as [{ upstream, repo, version, commit, files: [{ path, hash }] }].
export function parseSource(text) {
  const sources = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const top = /^- Upstream:\s*(\S+)\s*$/.exec(line);
    if (top) {
      current = { upstream: top[1], repo: '', version: '', commit: '', files: [] };
      sources.push(current);
      continue;
    }
    if (!current) continue;
    if (/^- /.test(line)) { current = null; continue; }
    const field = /^ {2}- (Repository|Version|Commit):\s*(\S+)\s*$/.exec(line);
    if (field) current[{ Repository: 'repo', Version: 'version', Commit: 'commit' }[field[1]]] = field[2];
    const file = /^ {2}- Source:\s*(\S+)\s+\(fingerprint ([0-9a-f]{64})\)\s*$/.exec(line);
    if (file) current.files.push({ path: file[1], hash: file[2] });
  }
  return sources;
}

// The copies under `root`'s skills folder: [{ name, description, sources }], by name; none when there is no such folder.
export function readCopies(root = repoRoot()) {
  const skills = path.join(root, 'skills');
  if (!fs.existsSync(skills)) return [];
  return fs.readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skills, entry.name, 'SOURCE.md')))
    .map((entry) => ({
      name: entry.name,
      description: descriptionOf(fs.readFileSync(path.join(skills, entry.name, 'SKILL.md'), 'utf8')),
      sources: parseSource(fs.readFileSync(path.join(skills, entry.name, 'SOURCE.md'), 'utf8')),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The copies' names, for the pack check: a step may name only these (as wheelhouse:<name>).
export const SKILL_COPIES = Object.freeze(readCopies().map((copy) => copy.name));

// Each copy source file that differs in a candidate upstream: [{ copy, upstream, path }]. `candidates` maps an
// upstream's name to { dir }, a copy of its new release; a source with no candidate is not looked at.
export function changedCopies({ copies = readCopies(), candidates = {} } = {}) {
  const changed = [];
  for (const copy of copies) {
    for (const source of copy.sources) {
      const candidate = candidates[source.upstream];
      if (!candidate?.dir) continue;
      for (const file of source.files) {
        let hash = null;
        const parts = file.path.split('/');
        if (!parts.includes('..') && !path.isAbsolute(file.path)) {
          try { hash = fingerprintFile(path.join(candidate.dir, ...parts)).hash; } catch { hash = null; }
        }
        if (hash !== file.hash) changed.push({ copy: copy.name, upstream: source.upstream, path: file.path });
      }
    }
  }
  return changed;
}
